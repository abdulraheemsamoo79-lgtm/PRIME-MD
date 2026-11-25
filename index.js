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
const antiSpam = require('./lib/antiSpam');
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

    // Cross-session anti-spam: a sliding window over this sender's
    // command attempts on ALL sessions combined (see lib/antiSpam).
    // Over the limit the command is silently dropped, with at most one
    // slow-down notice per sender per 5 minutes. The owner is exempt
    // (enforced inside the limiter as well).
    const spam = antiSpam.check(senderJid);
    if (!spam.allowed) {
      if (spam.notify) { try { await sock.sendMessage(jid, { text: '⏳ Please slow down — too many commands at once.' }, { quoted: msg }); } catch {} }
      return;
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
<title>${config.BOT_NAME} - Pair Your Number</title>
<style>
 *{box-sizing:border-box}
 body{font-family:system-ui,Arial,sans-serif;margin:0;min-height:100vh;color:#f5efff;text-align:center;padding:26px 14px 40px;background:radial-gradient(900px 500px at 50% -10%,#4b1185 0%,#1b0233 55%,#0d0119 100%)}
 .card{max-width:440px;margin:0 auto;background:linear-gradient(180deg,#26064a,#180230);border:1px solid #9d4dff;border-radius:22px;padding:26px 22px 20px;box-shadow:0 0 44px #8b2fc955,inset 0 0 24px #8b2fc922}
 .logo{width:158px;height:158px;object-fit:cover;border-radius:20px;border:2px solid #c07dff;box-shadow:0 0 26px #a64dff88}
 h1{color:#e3b8ff;margin:12px 0 2px;font-size:32px;letter-spacing:1px;text-shadow:0 0 18px #a64dff}
 .tag{color:#cdb2ef;margin:0 0 12px;font-size:14px}
 .pill{display:inline-block;background:#2e0a52;border:1px solid #8b2fc9;color:#a9f0b2;border-radius:999px;padding:6px 14px;font-size:13.5px;margin-bottom:16px}
 .pill b{color:#fff}
 label{display:block;text-align:left;color:#d9c2f7;font-size:13.5px;margin:2px 0 6px}
 input{width:100%;padding:14px;border-radius:12px;border:1px solid #8b2fc9;background:#12001f;color:#fff;font-size:17.5px;text-align:center;letter-spacing:.5px}
 input:focus{outline:2px solid #c07dff}
 button{width:100%;margin-top:12px;padding:14px;border:0;border-radius:12px;background:linear-gradient(90deg,#8b2fc9,#b45cff);color:#fff;font-size:17.5px;font-weight:800;cursor:pointer;box-shadow:0 4px 18px #8b2fc966}
 button:disabled{opacity:.55;cursor:wait}
 .spin{display:none;margin:18px auto 4px;width:34px;height:34px;border-radius:50%;border:4px solid #4b237a;border-top-color:#ffd94d;animation:sp 0.8s linear infinite}
 @keyframes sp{to{transform:rotate(360deg)}}
 #wait{color:#ffd94d;min-height:20px;font-size:14.5px;margin-top:8px}
 #codebox{display:none;margin:18px 0 4px;background:#12001f;border:2px dashed #ffd94d;border-radius:14px;padding:14px 8px}
 #code{font-size:40px;letter-spacing:4px;font-weight:900;color:#ffd94d}
 #copy{width:auto;margin-top:10px;padding:9px 22px;font-size:15px;background:#2e0a52;border:1px solid #ffd94d;color:#ffd94d;box-shadow:none}
 #msg{color:#efe4ff;min-height:22px;font-size:15px;margin-top:10px}
 #msg.err{color:#ff9d9d}
 .steps{text-align:left;margin:18px 0 4px;padding:0;list-style:none}
 .steps li{display:flex;gap:11px;margin-bottom:12px;color:#ddc9f8;line-height:1.5;font-size:14.8px}
 .n{flex:0 0 26px;height:26px;border-radius:50%;background:#8b2fc9;color:#fff;font-weight:800;text-align:center;line-height:26px;font-size:14px;box-shadow:0 0 10px #8b2fc988}
 .feat{color:#a98fd0;font-size:13px;margin-top:16px;line-height:1.7}
 .foot{color:#8f74b8;font-size:12.5px;margin-top:8px}
</style></head><body>
<div class="card">
 <img class="logo" src="/logo.png" alt="${config.BOT_NAME}">
 <h1>👑 ${config.BOT_NAME} 👑</h1>
 <p class="tag">⚡ Fast • Secure • Stable • Premium ⚡</p>
 <div><span class="pill" id="live">● Loading server status...</span></div>
 <label for="number">Your WhatsApp number (with country code)</label>
 <input id="number" inputmode="tel" autocomplete="tel" placeholder="e.g. 923001234567">
 <button id="btn" onclick="getCode()">Get Pairing Code</button>
 <div class="spin" id="spin"></div>
 <p id="wait"></p>
 <div id="codebox"><div id="code"></div><button id="copy" onclick="copyCode()">Copy Code</button></div>
 <p id="msg"></p>
 <ul class="steps">
  <li><span class="n">1</span><span>Enter your WhatsApp number above and tap <b>Get Pairing Code</b>. The code can take up to 40 seconds - please wait, do not tap again.</span></li>
  <li><span class="n">2</span><span>On that phone open <b>WhatsApp &gt; Settings &gt; Linked devices &gt; Link a device</b>.</span></li>
  <li><span class="n">3</span><span>Tap <b>Link with phone number instead</b> and enter the code. A welcome message will arrive in your chat when you are connected.</span></li>
 </ul>
 <p class="feat">169 commands • Downloads • AI Chat • View-Once Saver<br>HD Status • Group Tools • Islamic • Fun &amp; Economy</p>
 <p class="foot">© POWERED BY ${config.BOT_NAME} • BY AR SAMOON</p>
</div>
<script>
var waitTimer=null;
async function loadStatus(){ try{ var s=await (await fetch('/api/status')).json(); document.getElementById('live').innerHTML='● <b>'+s.serverName+'</b> &nbsp;•&nbsp; '+s.sessions+'/'+s.limit+' users connected'; }catch(e){} }
loadStatus(); setInterval(loadStatus,15000);
function copyCode(){
  var t=document.getElementById('code').textContent;
  if(navigator.clipboard){ navigator.clipboard.writeText(t); }
  document.getElementById('copy').textContent='Copied ✓';
  setTimeout(function(){ document.getElementById('copy').textContent='Copy Code'; },1600);
}
async function getCode(){
  var btn=document.getElementById('btn'), box=document.getElementById('codebox'), codeEl=document.getElementById('code'), msg=document.getElementById('msg'), wait=document.getElementById('wait'), spin=document.getElementById('spin');
  var number=document.getElementById('number').value.trim();
  box.style.display='none'; msg.textContent=''; msg.className='';
  if(!number){ msg.textContent='Please enter your WhatsApp number first.'; msg.className='err'; return; }
  btn.disabled=true; spin.style.display='block';
  var steps=['Connecting to WhatsApp...','Asking WhatsApp for your code...','Still working - pairing can take up to 40 seconds...','Almost there, please keep waiting...'];
  var i=0; wait.textContent=steps[0];
  waitTimer=setInterval(function(){ i=Math.min(i+1,steps.length-1); wait.textContent=steps[i]; },7000);
  try{
    var r=await (await fetch('/api/code?number='+encodeURIComponent(number))).json();
    if(r.ok && r.code){ codeEl.textContent=r.code; box.style.display='block'; msg.textContent='Your code is ready - enter it in WhatsApp now, it expires in a few minutes.'; }
    else { msg.textContent=r.message||'Something went wrong. Please try again.'; if(!r.ok) msg.className='err'; }
  }catch(e){ msg.textContent='Network problem. Please check your connection and try again.'; msg.className='err'; }
  clearInterval(waitTimer); wait.textContent=''; spin.style.display='none'; btn.disabled=false; loadStatus();
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

// ---------- memory guard ----------
// Railway gives this process a hard RAM ceiling; a slow leak would
// otherwise end in an unlogged OOM kill mid-traffic. If RSS stays over
// the configured limit for 3 straight checks, exit cleanly and let
// Railway restart the process - sessions restore from MongoDB.
if (config.MEMORY_LIMIT_MB > 0) {
  let overStreak = 0;
  const memGuard = setInterval(() => {
    const rssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
    if (rssMb > config.MEMORY_LIMIT_MB) {
      overStreak += 1;
      console.log(`[memory] RSS ${rssMb}MB over limit ${config.MEMORY_LIMIT_MB}MB (check ${overStreak}/3)`);
      if (overStreak >= 3) {
        console.error(`[memory] RSS ${rssMb}MB over limit ${config.MEMORY_LIMIT_MB}MB on 3 checks — restarting for a clean process; sessions restore from MongoDB`);
        process.exit(0);
      }
    } else overStreak = 0;
  }, 60000);
  if (memGuard.unref) memGuard.unref();
}

app.listen(config.PORT, () => {
  console.log(`${config.BOT_NAME} web server listening on port ${config.PORT} (${config.SERVER_NAME}, limit ${config.SESSION_LIMIT})`);
  sessions.restoreSessions().catch(e => console.error('[restore]', e.message));
});
