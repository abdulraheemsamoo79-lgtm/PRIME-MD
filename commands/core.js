// PRIME MD - Core commands (menu, help, pairing, owner controls)
const fs = require('fs');

const BOLD = {}; // A-Z a-z 0-9 -> mathematical bold
'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((c, i) => { BOLD[c] = String.fromCodePoint(0x1D400 + i); });
'abcdefghijklmnopqrstuvwxyz'.split('').forEach((c, i) => { BOLD[c] = String.fromCodePoint(0x1D41A + i); });
'0123456789'.split('').forEach((c, i) => { BOLD[c] = String.fromCodePoint(0x1D7CE + i); });
const boldCaps = (s) => String(s).toUpperCase().split('').map(c => BOLD[c] || c).join('');

function uptimeText(startedAt) {
  let s = Math.floor((Date.now() - startedAt) / 1000);
  const d = Math.floor(s / 86400); s %= 86400;
  const h = Math.floor(s / 3600); s %= 3600;
  const m = Math.floor(s / 60); const sec = s % 60;
  return [d ? `${d}d` : null, h ? `${h}h` : null, m ? `${m}m` : null, `${sec}s`].filter(Boolean).join(' ');
}

function menuText(ctx) {
  const cats = ctx.commandsApi.byCategory();
  const order = ['Core', 'Owner', 'Utility', 'Fun'];
  const names = [...order.filter(c => cats[c]), ...Object.keys(cats).filter(c => !order.includes(c))];
  let out = '';
  out += '╔══════════════════════╗\n';
  out += '   👑 𝐏𝐑𝐈𝐌𝐄 𝐌𝐃 👑\n';
  out += ' ⚡ Fast • Secure • Stable • Premium ⚡\n';
  out += '╚══════════════════════╝\n\n';
  out += '┌─ 👤 𝐔𝐒𝐄𝐑 𝐈𝐍𝐅𝐎 ─────────────\n';
  out += `├ 👤 User : ${ctx.pushName || 'User'}\n`;
  out += `├ 📱 Session : ${ctx.sessionNumber}\n`;
  out += `├ 🖥️ Server : ${ctx.config.SERVER_NAME}\n`;
  out += `├ 🔌 Mode : ${String(ctx.mode || 'public').toUpperCase()}\n`;
  out += `├ ⚡ Prefix : ${ctx.config.PREFIX}\n`;
  out += '└────────────────────────\n';
  for (const cat of names) {
    out += `\n┌─ 📂 ${boldCaps(cat)} ─────────────\n`;
    cats[cat].forEach((cmd, i) => {
      const branch = i === cats[cat].length - 1 ? '└' : '├';
      out += `${branch} ${ctx.config.PREFIX}${cmd.name}\n`;
    });
    out += '─────────────────────────\n';
  }
  out += `\n© POWERED BY ${ctx.config.BOT_NAME}`;
  return out;
}

async function sendWithLogo(ctx, caption) {
  try {
    const img = fs.readFileSync(ctx.logoPath);
    await ctx.sock.sendMessage(ctx.jid, { image: img, caption }, { quoted: ctx.msg });
  } catch { await ctx.reply(caption); }
}

function levenshtein(a, b) {
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return m[a.length][b.length];
}

module.exports = [
  {
    name: 'menu', aliases: ['m'], category: 'Core',
    description: 'Show the PRIME MD menu with all commands.',
    use: '.menu',
    run: async (ctx) => { await sendWithLogo(ctx, menuText(ctx)); },
  },
  {
    name: 'list', aliases: [], category: 'Core',
    description: 'Show all commands grouped by category (text only).',
    use: '.list',
    run: async (ctx) => {
      const cats = ctx.commandsApi.byCategory();
      let out = `📋 *${ctx.config.BOT_NAME} - All Commands* (${ctx.commandsApi.count})\n`;
      for (const [cat, cmds] of Object.entries(cats)) {
        out += `\n*${cat}*\n`;
        for (const c of cmds) out += `• ${ctx.config.PREFIX}${c.name} - ${c.description}\n`;
      }
      out += `\n© POWERED BY ${ctx.config.BOT_NAME}`;
      await ctx.reply(out);
    },
  },
  {
    name: 'help', aliases: ['guide'], category: 'Core',
    description: 'Show the help page, or details for one command.',
    use: '.help / .help <command>',
    run: async (ctx) => {
      const q = (ctx.args[0] || '').replace(/^\./, '').toLowerCase();
      if (!q) {
        await ctx.reply(
          `📖 *${ctx.config.BOT_NAME} - Help*\n\n` +
          `• Send *${ctx.config.PREFIX}menu* to see every command.\n` +
          `• Send *${ctx.config.PREFIX}help <command>* for a full guide to one command, for example *${ctx.config.PREFIX}help ping*.\n` +
          `• Pair a new number with *${ctx.config.PREFIX}pair <number>* or from the PRIME MD pairing page.\n` +
          `• Commands only work with the *${ctx.config.PREFIX}* prefix.\n\n© POWERED BY ${ctx.config.BOT_NAME}`);
        return;
      }
      const cmd = ctx.commandsApi.get(q);
      if (!cmd) {
        const scored = ctx.commandsApi.all
          .flatMap(c => [c.name, ...(c.aliases || [])].map(n => ({ n, d: levenshtein(q, n) })))
          .filter(x => x.d <= 3).sort((a, b) => a.d - b.d).slice(0, 3).map(x => x.n);
        const uniq = [...new Set(scored)];
        await ctx.reply(uniq.length
          ? `❓ No command called "${q}". Did you mean: ${uniq.map(n => ctx.config.PREFIX + n).join(', ')}?`
          : `❓ No command called "${q}". Send ${ctx.config.PREFIX}menu to see all commands.`);
        return;
      }
      await ctx.reply(
        `📖 *${ctx.config.PREFIX}${cmd.name}*\n\n` +
        `📂 Category: ${cmd.category}\n` +
        `✏️ Use: ${cmd.use || ctx.config.PREFIX + cmd.name}\n` +
        (cmd.aliases?.length ? `🔀 Aliases: ${cmd.aliases.map(a => ctx.config.PREFIX + a).join(', ')}\n` : '') +
        `📝 About: ${cmd.description}`);
    },
  },
  {
    name: 'ping', aliases: [], category: 'Core',
    description: 'Check that the bot is alive and how fast it answers.',
    use: '.ping',
    run: async (ctx) => {
      const sentAt = Number(ctx.msg.messageTimestamp || 0) * 1000;
      const ms = sentAt ? Math.max(1, Date.now() - sentAt) : 1;
      await ctx.reply(`🏓 *Pong!* ${ctx.config.BOT_NAME} answered in ${ms} ms.`);
    },
  },
  {
    name: 'alive', aliases: [], category: 'Core',
    description: 'Show bot status, uptime and live session count.',
    use: '.alive',
    run: async (ctx) => {
      await ctx.reply(
        `✅ *${ctx.config.BOT_NAME} is alive and running.*\n\n` +
        `🖥️ Server: ${ctx.config.SERVER_NAME}\n` +
        `⏱️ Uptime: ${uptimeText(ctx.bootedAt)}\n` +
        `📱 Live sessions: ${ctx.sessions.count()}/${ctx.config.SESSION_LIMIT}\n` +
        `🔌 Mode: ${String(ctx.mode || 'public').toUpperCase()}`);
    },
  },
  {
    name: 'runtime', aliases: ['uptime'], category: 'Core',
    description: 'Show how long the bot has been running.',
    use: '.runtime',
    run: async (ctx) => { await ctx.reply(`⏱️ ${ctx.config.BOT_NAME} has been running for *${uptimeText(ctx.bootedAt)}*.`); },
  },
  {
    name: 'owner', aliases: [], category: 'Core',
    description: 'Show the bot owner card.',
    use: '.owner',
    run: async (ctx) => {
      await sendWithLogo(ctx,
        `👑 *${ctx.config.BOT_NAME} - Owner*\n\n` +
        `👤 Owner: ${ctx.config.OWNER_NAME}\n` +
        `📱 Number: wa.me/${ctx.config.OWNER_NUMBER}\n` +
        `🤖 Bot: ${ctx.config.BOT_NAME}\n` +
        `🖥️ Server: ${ctx.config.SERVER_NAME}\n\n© POWERED BY ${ctx.config.BOT_NAME}`);
    },
  },
  {
    name: 'pair', aliases: [], category: 'Core',
    description: 'Get a pairing code for a WhatsApp number.',
    use: '.pair <number>',
    run: async (ctx) => {
      const raw = ctx.args[0];
      if (!raw) {
        await ctx.reply(
          `🔗 *Pair your number with ${ctx.config.BOT_NAME}*\n\n` +
          `1. Send *${ctx.config.PREFIX}pair <your number>* here, for example ${ctx.config.PREFIX}pair 923138702477\n` +
          `2. You will get an 8-digit code.\n` +
          `3. On that phone open WhatsApp > Settings > Linked devices > Link a device > *Link with phone number instead*, and enter the code.\n\n` +
          `You can also pair from the PRIME MD pairing web page.`);
        return;
      }
      const { normalizeNumber } = require('../lib/normalizeNumber');
      const norm = normalizeNumber(raw);
      if (!norm.ok) { await ctx.reply(`⚠️ ${norm.error}`); return; }
      const res = await ctx.sessions.requestCode(norm.number, null);
      if (res.status === 'code_ready') {
        await ctx.reply(
          `🔗 *Your ${ctx.config.BOT_NAME} pairing code*\n\n*${res.code}*\n\n` +
          `On the phone for ${norm.number}:\nWhatsApp > Settings > Linked devices > Link a device > *Link with phone number instead* > enter this code.\n` +
          `The code and this pairing session stay valid for a few minutes only.`);
      } else {
        await ctx.reply(res.message || 'Pairing could not be started right now. Please try again in a moment.');
      }
    },
  },
  {
    name: 'mode', aliases: [], category: 'Core',
    description: 'Show the current bot mode (public or private).',
    use: '.mode',
    run: async (ctx) => {
      await ctx.reply(`🔌 This session is in *${String(ctx.mode || 'public').toUpperCase()}* mode.\n` +
        (ctx.mode === 'private' ? 'Only the owner and this session\'s owner can use the bot.' : 'Anyone can use the bot.') +
        `\nThe owner can change it with ${ctx.config.PREFIX}public or ${ctx.config.PREFIX}private.`);
    },
  },
  {
    name: 'server', aliases: ['serverinfo'], category: 'Core',
    description: 'Show server and session information.',
    use: '.server',
    run: async (ctx) => {
      await ctx.reply(
        `🖥️ *${ctx.config.BOT_NAME} - Server Info*\n\n` +
        `Server: ${ctx.config.SERVER_NAME} (ID ${ctx.config.SERVER_ID})\n` +
        `Live sessions: ${ctx.sessions.count()}/${ctx.config.SESSION_LIMIT}\n` +
        `Commands loaded: ${ctx.commandsApi.count}\n` +
        `Uptime: ${uptimeText(ctx.bootedAt)}`);
    },
  },
  {
    name: 'public', aliases: [], category: 'Owner', ownerOnly: true,
    description: 'Switch this session to public mode (owner only).',
    use: '.public',
    run: async (ctx) => { await ctx.settings.setMode(ctx.sessionNumber, 'public'); await ctx.reply('🔓 This session is now in *PUBLIC* mode. Anyone can use the bot.'); },
  },
  {
    name: 'private', aliases: [], category: 'Owner', ownerOnly: true,
    description: 'Switch this session to private mode (owner only).',
    use: '.private',
    run: async (ctx) => { await ctx.settings.setMode(ctx.sessionNumber, 'private'); await ctx.reply('🔒 This session is now in *PRIVATE* mode. Only the owner and this session\'s owner can use the bot.'); },
  },
  {
    name: 'sessions', aliases: ['listsessions'], category: 'Owner', ownerOnly: true,
    description: 'List all live sessions on this server (owner only).',
    use: '.sessions',
    run: async (ctx) => {
      const list = ctx.sessions.list();
      if (!list.length) { await ctx.reply('No live sessions right now.'); return; }
      await ctx.reply(`📱 *Live sessions (${list.length}/${ctx.config.SESSION_LIMIT})*\n\n` + list.map((s, i) => `${i + 1}. ${s.number} - ${s.status}`).join('\n'));
    },
  },
  {
    name: 'delsession', aliases: ['sessiondel'], category: 'Owner', ownerOnly: true,
    description: 'Disconnect and delete a session (owner only).',
    use: '.delsession <number>',
    run: async (ctx) => {
      const { normalizeNumber } = require('../lib/normalizeNumber');
      const norm = normalizeNumber(ctx.args[0] || '');
      if (!norm.ok) { await ctx.reply(`⚠️ Please give a valid number, for example ${ctx.config.PREFIX}delsession 923138702477`); return; }
      await ctx.sessions.cleanupSession(norm.number);
      await ctx.reply(`🗑️ Session for ${norm.number} has been disconnected and deleted.`);
    },
  },
  {
    name: 'restart', aliases: [], category: 'Owner', ownerOnly: true,
    description: 'Restart the bot server (owner only). Sessions are saved and come back automatically.',
    use: '.restart',
    run: async (ctx) => {
      await ctx.reply('♻️ Restarting PRIME MD... sessions are saved in the database and will reconnect on their own.');
      setTimeout(() => process.exit(0), 1000);
    },
  },
];
