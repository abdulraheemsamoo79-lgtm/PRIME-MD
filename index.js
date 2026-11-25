// PRIME MD - entry point.
// Express: status page with a working pairing form, /api/status,
// /api/sessions, /api/code. WhatsApp: multi-session message handler with
// prefix commands, public/private modes, per-user rate limiting, and a
// strict rule - users never see a raw error, only one friendly English line.
const path = require('path');
const fs = require('fs');
const express = require('express');
const config = require('./config');
const { loadCommands } = require('./lib/commandLoader');
const sessions = require('./lib/sessionManager');
const settings = require('./lib/settings');
const { normalizeNumber } = require('./lib/normalizeNumber');
const vvcache = require('./lib/vvcache');
const banlist = require('./lib/banlist');
const aiCore = require('./lib/aiCore');
const msgstore = require('./lib/msgstore');
const automation = require('./lib/automation');
const fun2 = require('./commands/fun2');

const BOOTED_AT = Date.now();
const LOGO_PATH = path.join(__dirname, 'assets', 'logo.png');
const commandsApi = loadCommands();
if (commandsApi.duplicates.length) {
  console.error('[commands] DUPLICATES FOUND:', commandsApi.duplicates);
}
console.log(`[commands] loaded ${commandsApi.count} commands, ${commandsApi.duplicates.length} duplicates`);

// ---------- message handling ----------
const lastCommandAt = new Map(); // session:sender -> ts
const RATE_MS = 1500;

function extractText(msg) {
  const m = msg.message || {};
  return (m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption ||
    m.videoMessage?.caption || m.documentMessage?.caption || '').trim();
}
function extractContext(msg) {
  const m = msg.message || {};
  const ctxInfo = m.extendedTextMessage?.contextInfo || m.imageMessage?.contextInfo || m.videoMessage?.contextInfo || null;
  return {
    quoted: ctxInfo?.quotedMessage ? { message: ctxInfo.quotedMessage, participant: ctxInfo.participant, stanzaId: ctxInfo.stanzaId } : null,
    mentionedJids: ctxInfo?.mentionedJid || [],
  };
}

// Non-command traffic: a bare number can be a pending .moviedl
// pick, and users with AI Mode on get AI answers to normal messages.
const aimodeLastAt = new Map();
async function handleNonCommand(sessionNumber, sock, msg, jid, text) {
  const fromMe = !!msg.key.fromMe;
  const senderJid = fromMe ? `${sessionNumber}@s.whatsapp.net` : (msg.key.participant || jid);
  const senderNumber = senderJid.split('@')[0].split(':')[0];
  const { quoted, mentionedJids } = extractContext(msg);
  const ctx = {
    sock, msg, jid, sessionNumber, senderJid, senderNumber,
    pushName: msg.pushName || '',
    isGroup: jid.endsWith('@g.us'), isOwner: senderNumber === config.OWNER_NUMBER,
    isSessionOwner: senderNumber === sessionNumber, fromMe,
    args: text.split(/\s+/), argText: text, quoted, mentionedJids, targetJid: senderJid,
    config, commandsApi, sessions, settings,
    mode: await settings.getMode(sessionNumber), bootedAt: BOOTED_AT, logoPath: LOGO_PATH,
    reply: (t) => sock.sendMessage(jid, { text: String(t) }, { quoted: msg }),
  };
  if (/^[12]$/.test(text.trim())) {
    try {
      const d2 = require('./commands/download2');
      if (typeof d2.handleDramaPick === 'function' && await d2.handleDramaPick(ctx)) return;
    } catch (e) { console.error('[drama pick] error:', e.message); }
  }
  if (/^\d{1,2}$/.test(text.trim())) {
    try {
      const dl = require('./commands/download');
      if (typeof dl.handleMoviePick === 'function' && await dl.handleMoviePick(ctx)) return;
    } catch (e) { console.error('[moviedl pick] error:', e.message); }
  }
  if (fromMe || !text.trim()) return;
  // a message may be the answer to a pending quiz, and
  // ordinary chat earns XP (cooldown-limited inside the economy helper).
  try { if (await fun2.tryQuizAnswer(ctx)) return; } catch (e) { console.error('[quiz answer] error:', e.message); }
  fun2.awardMessageXp(settings, sessionNumber, senderNumber).catch(() => {});
  try {
    const s = await settings.getSettings(sessionNumber);
    if (!s.aimodeUsers || !s.aimodeUsers[senderNumber]) return;
    const key = `${sessionNumber}:${senderNumber}`;
    const now = Date.now();
    if (now - (aimodeLastAt.get(key) || 0) < 3000) return;
    aimodeLastAt.set(key, now);
    const answer = await aiCore.askAi(text, { mode: true });
    if (answer) await sock.sendMessage(jid, { text: answer.slice(0, 3500) }, { quoted: msg });
  } catch (e) { console.error('[aimode] error:', e.message); }
}

async function handleMessage(sessionNumber, sock, msg) {
  try {
    if (!msg.message) return;
    const jid = msg.key.remoteJid;
    if (!jid) return;
    // store every message for antidelete/antiedit and
    // run the automation hooks (status tools, group moderation, AFK,
    // auto-replies, mention alerts...). This also covers status@broadcast,
    // which the command flow below intentionally skips.
    try { msgstore.put(sessionNumber, msg); } catch {}
    // Capture view-once media on ARRIVAL - it cannot be fetched later.
    // (Must run before the automation hooks: autovv reads this cache.)
    try { vvcache.put(sessionNumber, msg); } catch {}
    try { await automation.onMessage(sessionNumber, sock, msg); } catch (e) { console.error('[automation] error:', e.message); }
    if (jid === 'status@broadcast' || jid.endsWith('@newsletter')) return;
    let text = extractText(msg);
    if (/^vv$/i.test(text.trim())) text = config.PREFIX + 'vv'; // bare "vv" reply trigger
    if (!text.startsWith(config.PREFIX)) { await handleNonCommand(sessionNumber, sock, msg, jid, text); return; }

    const isGroup = jid.endsWith('@g.us');
    const fromMe = !!msg.key.fromMe;
    const senderJid = fromMe ? `${sessionNumber}@s.whatsapp.net` : (msg.key.participant || jid);
    const senderNumber = senderJid.split('@')[0].split(':')[0];
    const isOwner = senderNumber === config.OWNER_NUMBER;
    const isSessionOwner = senderNumber === sessionNumber;

    // Banned numbers are ignored entirely. The global owner is exempt
    // (and can never be on the list - the ban store refuses to add him).
    if (!isOwner) {
      try { await banlist.ensureLoaded(); if (banlist.shouldIgnore(senderNumber, isOwner)) return; } catch {}
    }

    const body = text.slice(config.PREFIX.length).trim();
    if (!body) return;
    const [rawName, ...args] = body.split(/\s+/);
    const name = rawName.toLowerCase();
    const cmd = commandsApi.get(name);
    if (!cmd) {
      await sock.sendMessage(jid, { text: `❓ Unknown command "${config.PREFIX}${name}". Send ${config.PREFIX}menu to see all commands.` }, { quoted: msg });
      return;
    }

    const mode = await settings.getMode(sessionNumber);
    if (mode === 'private' && !isOwner && !isSessionOwner) return; // silent in private mode
    if (cmd.ownerOnly && !isOwner && !isSessionOwner) {
      await sock.sendMessage(jid, { text: '🔒 That command is for the bot owner only.' }, { quoted: msg });
      return;
    }
    if (cmd.groupOnly && !isGroup) {
      await sock.sendMessage(jid, { text: '👥 That command only works in groups.' }, { quoted: msg });
      return;
    }

    if (!isOwner) {
      const key = `${sessionNumber}:${senderNumber}`;
      const now = Date.now();
      if (now - (lastCommandAt.get(key) || 0) < RATE_MS) return; // silently drop spam
      lastCommandAt.set(key, now);
    }

    const { quoted, mentionedJids } = extractContext(msg);
    const argNumber = (args[0] || '').replace(/\D/g, '');
    const targetJid = mentionedJids[0] || quoted?.participant ||
      (argNumber.length >= 7 ? `${argNumber}@s.whatsapp.net` : senderJid);

    const ctx = {
      sock, msg, jid, sessionNumber, senderJid, senderNumber,
      pushName: msg.pushName || '',
      isGroup, isOwner, isSessionOwner, fromMe,
      args, argText: args.join(' '), quoted, mentionedJids, targetJid,
      config, commandsApi, sessions, settings,
      mode, bootedAt: BOOTED_AT, logoPath: LOGO_PATH,
      reply: (t) => sock.sendMessage(jid, { text: String(t) }, { quoted: msg }),
    };

    try {
      await cmd.run(ctx);
    } catch (e) {
      console.error(`[command ${name}] failed for session ${sessionNumber}:`, e);
      try { await ctx.reply('⚠️ Sorry, something went wrong while running that command. Please try again.'); } catch {}
    }
  } catch (e) {
    console.error('[handleMessage] error:', e.message);
  }
}
sessions.setMessageHandler(handleMessage);
sessions.setEventHandler((n, sock, event, payload) => automation.handleEvent(n, sock, event, payload));

// ---------- web server ----------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true); // Railway sits behind a proxy - req.ip must be the real client IP for the pairing rate limit

app.get('/logo.png', (req, res) => {
  if (fs.existsSync(LOGO_PATH)) res.sendFile(LOGO_PATH);
  else res.status(404).send('logo not found');
});

app.get('/', (req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${config.BOT_NAME} - Pairing</title>
<style>
 body{font-family:system-ui,Arial,sans-serif;background:#12001f;color:#f3eaff;margin:0;padding:24px;text-align:center}
 .card{max-width:430px;margin:0 auto;background:#1e0733;border:2px solid #8b2fc9;border-radius:18px;padding:24px;box-shadow:0 0 32px #8b2fc966}
 img{width:150px;height:150px;object-fit:cover;border-radius:16px;border:2px solid #b45cff}
 h1{color:#d9a5ff;margin:10px 0 2px} .tag{color:#bfa8e0;margin:0 0 14px}
 input{width:100%;box-sizing:border-box;padding:13px;border-radius:10px;border:1px solid #8b2fc9;background:#12001f;color:#fff;font-size:17px;text-align:center}
 button{width:100%;margin-top:12px;padding:13px;border:0;border-radius:10px;background:#8b2fc9;color:#fff;font-size:17px;font-weight:700;cursor:pointer}
 button:disabled{background:#5b3a7a}
 #code{font-size:36px;letter-spacing:3px;font-weight:800;color:#ffd94d;margin:16px 0 4px;display:none}
 #msg{color:#e8d9ff;min-height:22px}
 ol{text-align:left;color:#d9c8f5;line-height:1.55}
 .live{color:#9fe8a9;font-size:14px}
</style></head><body>
<div class="card">
 <img src="/logo.png" alt="${config.BOT_NAME}">
 <h1>👑 ${config.BOT_NAME} 👑</h1>
 <p class="tag">⚡ Fast • Secure • Stable • Premium ⚡</p>
 <p class="live" id="live">Loading server status...</p>
 <input id="number" inputmode="tel" placeholder="Your WhatsApp number, e.g. 923138702477">
 <button id="btn" onclick="getCode()">Get Code</button>
 <div id="code"></div>
 <p id="msg"></p>
 <ol>
  <li>Enter your WhatsApp number above and tap <b>Get Code</b>.</li>
  <li>On that phone open <b>WhatsApp &gt; Settings &gt; Linked devices &gt; Link a device</b>.</li>
  <li>Tap <b>Link with phone number instead</b> and enter the code.</li>
 </ol>
</div>
<script>
async function loadStatus(){ try{ const s=await (await fetch('/api/status')).json(); document.getElementById('live').textContent = s.serverName + ' - ' + s.sessions + '/' + s.limit + ' users connected'; }catch(e){} }
loadStatus();
async function getCode(){
  const btn=document.getElementById('btn'), codeEl=document.getElementById('code'), msg=document.getElementById('msg');
  const number=document.getElementById('number').value.trim();
  codeEl.style.display='none'; msg.textContent='Getting your code, please wait...'; btn.disabled=true;
  try{
    const r=await (await fetch('/api/code?number='+encodeURIComponent(number))).json();
    if(r.ok && r.code){ codeEl.textContent=r.code; codeEl.style.display='block'; }
    msg.textContent=r.message||'Done.';
  }catch(e){ msg.textContent='Something went wrong. Please try again.'; }
  btn.disabled=false; loadStatus();
}
</script></body></html>`);
});

app.get('/api/status', (req, res) => {
  res.json({
    ok: true, bot: config.BOT_NAME, serverId: config.SERVER_ID, serverName: config.SERVER_NAME,
    sessions: sessions.count(), limit: config.SESSION_LIMIT,
    pairingPending: sessions.pairing.pendingCount(),
    commands: commandsApi.count, uptimeSec: Math.floor((Date.now() - BOOTED_AT) / 1000),
  });
});

app.get('/api/sessions', (req, res) => {
  res.json({ ok: true, sessions: sessions.list() });
});

app.get('/api/code', async (req, res) => {
  const norm = normalizeNumber(req.query.number || '');
  if (!norm.ok) return res.json({ ok: false, status: 'invalid_number', message: norm.error });
  const result = await sessions.requestCode(norm.number, req.ip);
  res.json(result);
});

// Password-protected admin panel (disabled unless ADMIN_PASS is set).
require('./lib/admin').registerAdmin(app, { sessions, settings });

process.on('uncaughtException', (e) => console.error('[uncaughtException]', e.message));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e?.message || e));

app.listen(config.PORT, () => {
  console.log(`${config.BOT_NAME} web server listening on port ${config.PORT} (${config.SERVER_NAME}, limit ${config.SESSION_LIMIT})`);
  sessions.restoreSessions().catch(e => console.error('[restore]', e.message));
});
