// PRIME MD - Server control commands for the GLOBAL owner: broadcast,
// ban / unban / banlist and the session health report. These are stricter
// than the per-session owner commands: only the global owner number can
// run them (checked inside each command, not just via the ownerOnly flag,
// which would also let a session owner through).
const config = require('../config');
const banlist = require('../lib/banlist');
const { normalizeNumber } = require('../lib/normalizeNumber');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function fmtSince(startedAt) {
  if (!startedAt) return 'unknown';
  let s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const h = Math.floor(s / 3600); s %= 3600;
  const m = Math.floor(s / 60); const sec = s % 60;
  return [h ? `${h}h` : null, m ? `${m}m` : null, `${sec}s`].filter(Boolean).join(' ');
}

async function globalOwnerOnly(ctx) {
  if (ctx.isOwner) return true;
  await ctx.reply('🔒 That command is for the PRIME MD owner only.');
  return false;
}

const commands = [
  {
    name: 'broadcast', aliases: ['announce'], category: 'Owner', ownerOnly: true,
    description: 'Send an announcement to the own chat of every connected user (owner only).',
    use: '.broadcast <message>',
    run: async (ctx) => {
      if (!await globalOwnerOnly(ctx)) return;
      const text = ctx.argText.trim();
      if (!text) { await ctx.reply(`📢 Please give the announcement text, for example *${config.PREFIX}broadcast Maintenance tonight at 10 PM.*`); return; }
      // SAFE delivery choice: an announcement goes to each session's OWNER
      // in their self-chat - never blasted into every group, which would
      // spam thousands of chats and risk WhatsApp bans. One send per live
      // session, spaced out, with a final sent/failed report.
      const entries = ctx.sessions.list();
      if (!entries.length) { await ctx.reply('📢 No live sessions right now, so the announcement was not sent anywhere.'); return; }
      await ctx.reply(`📢 Sending the announcement to ${entries.length} connected user(s)...`);
      let sent = 0, failed = 0;
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        try {
          const sess = ctx.sessions.getSession(entry.number);
          if (!sess?.sock) throw new Error('no socket');
          await sess.sock.sendMessage(`${entry.number}@s.whatsapp.net`, {
            text: `📢 *${config.BOT_NAME} — Announcement*\n\n${text}\n\n© POWERED BY ${config.BOT_NAME}`,
          });
          sent++;
        } catch { failed++; }
        if (i < entries.length - 1) await sleep(config.BROADCAST_DELAY_MS ?? 1500);
      }
      await ctx.reply(`📢 *Broadcast finished.*\n✅ Sent: ${sent}\n❌ Failed: ${failed}`);
    },
  },
  {
    name: 'ban', aliases: [], category: 'Owner', ownerOnly: true,
    description: 'Ban a number from using PRIME MD and remove its session (owner only).',
    use: '.ban <number>',
    run: async (ctx) => {
      if (!await globalOwnerOnly(ctx)) return;
      const norm = normalizeNumber(ctx.args[0] || '');
      if (!norm.ok) { await ctx.reply(`⚠️ Please give a valid number, for example *${config.PREFIX}ban 923001234567*.`); return; }
      const res = await banlist.ban(norm.number, ctx.senderNumber);
      if (!res.ok && res.reason === 'owner') { await ctx.reply('🛡️ The global owner can never be banned.'); return; }
      if (!res.ok) { await ctx.reply('⚠️ That number could not be banned. Please check it and try again.'); return; }
      let removed = false;
      try {
        if (ctx.sessions.getSession(norm.number)) { await ctx.sessions.cleanupSession(norm.number); removed = true; }
      } catch { /* the ban itself is already stored */ }
      await ctx.reply(`🚫 *${norm.number}* has been banned from ${config.BOT_NAME}.${removed ? '\nIts live session was disconnected and removed.' : ''}\nCommands from this number will now be ignored on every session.`);
    },
  },
  {
    name: 'unban', aliases: [], category: 'Owner', ownerOnly: true,
    description: 'Remove a number from the ban list (owner only).',
    use: '.unban <number>',
    run: async (ctx) => {
      if (!await globalOwnerOnly(ctx)) return;
      const norm = normalizeNumber(ctx.args[0] || '');
      if (!norm.ok) { await ctx.reply(`⚠️ Please give a valid number, for example *${config.PREFIX}unban 923001234567*.`); return; }
      const res = await banlist.unban(norm.number);
      await ctx.reply(res.removed
        ? `✅ *${norm.number}* has been unbanned and can use ${config.BOT_NAME} again.`
        : `ℹ️ ${norm.number} was not on the ban list.`);
    },
  },
  {
    name: 'banlist', aliases: ['banned'], category: 'Owner', ownerOnly: true,
    description: 'Show every banned number (owner only).',
    use: '.banlist',
    run: async (ctx) => {
      if (!await globalOwnerOnly(ctx)) return;
      await banlist.ensureLoaded();
      const list = banlist.list();
      if (!list.length) { await ctx.reply('✅ The ban list is empty. No numbers are banned.'); return; }
      const lines = list.map((b, i) => `${i + 1}. ${b.number}${b.at ? ` - banned ${new Date(b.at).toLocaleString('en-GB')}` : ''}`);
      await ctx.reply(`🚫 *Banned numbers (${list.length})*\n\n${lines.join('\n')}`);
    },
  },
  {
    name: 'health', aliases: [], category: 'Owner', ownerOnly: true,
    description: 'Session health report for this server (owner only).',
    use: '.health',
    run: async (ctx) => {
      if (!await globalOwnerOnly(ctx)) return;
      const entries = ctx.sessions.list();
      const open = entries.filter(e => e.status === 'open').length;
      let out = `🩺 *${config.BOT_NAME} - Session Health*\n\n`;
      out += `🖥️ Server: ${config.SERVER_NAME} (ID ${config.SERVER_ID})\n`;
      out += `📱 Sessions: ${entries.length}/${config.SESSION_LIMIT} - ✅ ${open} connected, ⏳ ${entries.length - open} not open\n`;
      out += `🚫 Banned numbers: ${(await banlist.ensureLoaded().then(() => banlist.list())).length}\n`;
      if (entries.length) {
        out += '\n*Per session:*\n';
        for (const e of entries) {
          let mode = 'public';
          try { mode = await ctx.settings.getMode(e.number); } catch {}
          out += `\n• ${e.number} - ${e.status === 'open' ? '✅ connected' : `⏳ ${e.status}`}${e.status === 'open' ? ` for ${fmtSince(e.startedAt)}` : ''} - mode: ${String(mode).toUpperCase()}`;
        }
      }
      out += `\n\n© POWERED BY ${config.BOT_NAME}`;
      await ctx.reply(out);
    },
  },
];

module.exports = commands;
