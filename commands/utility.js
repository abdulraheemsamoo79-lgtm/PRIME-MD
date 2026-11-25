// PRIME MD - Utility commands
const crypto = require('crypto');

// Safe arithmetic parser (no eval): numbers, + - * / % ( ) and decimals.
function calcExpr(input) {
  const tokens = String(input).replace(/\s+/g, '').match(/(\d+\.?\d*|\.\d+|[+\-*/%()])/g);
  if (!tokens || tokens.join('') !== String(input).replace(/\s+/g, '')) throw new Error('bad expression');
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  function parseExpr() { let v = parseTerm(); while (peek() === '+' || peek() === '-') { const op = next(); const r = parseTerm(); v = op === '+' ? v + r : v - r; } return v; }
  function parseTerm() { let v = parseFactor(); while (peek() === '*' || peek() === '/' || peek() === '%') { const op = next(); const r = parseFactor(); if (op === '*') v *= r; else if (op === '/') { if (r === 0) throw new Error('div0'); v /= r; } else v %= r; } return v; }
  function parseFactor() {
    const t = next();
    if (t === '(') { const v = parseExpr(); if (next() !== ')') throw new Error('paren'); return v; }
    if (t === '-') return -parseFactor();
    if (t === '+') return parseFactor();
    const n = parseFloat(t); if (Number.isNaN(n)) throw new Error('num');
    return n;
  }
  const v = parseExpr();
  if (pos !== tokens.length || !Number.isFinite(v)) throw new Error('bad expression');
  return Math.round(v * 1e10) / 1e10;
}

const MONO = {}, DS = {}, CIRC = {};
'abcdefghijklmnopqrstuvwxyz'.split('').forEach((c, i) => { MONO[c] = String.fromCodePoint(0x1D68A + i); DS[c] = String.fromCodePoint(0x1D552 + i); CIRC[c] = String.fromCodePoint(0x24D0 + i); });
'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((c, i) => { MONO[c] = String.fromCodePoint(0x1D670 + i); DS[c] = String.fromCodePoint(0x1D538 + i); CIRC[c] = String.fromCodePoint(0x24B6 + i); });
'0123456789'.split('').forEach((c, i) => { MONO[c] = String.fromCodePoint(0x1D7F6 + i); DS[c] = String.fromCodePoint(0x1D7D8 + i); CIRC[c] = i === 0 ? '⓪' : String.fromCodePoint(0x2460 + i - 1); });
const mapStyle = (map, s) => s.split('').map(c => map[c] || c).join('');

module.exports = [
  {
    name: 'calc', aliases: [], category: 'Utility',
    description: 'Calculate a math expression.', use: '.calc 12 * (3 + 4)',
    run: async (ctx) => {
      if (!ctx.argText) { await ctx.reply('🧮 Please give me something to calculate, for example *.calc 12 * (3 + 4)*'); return; }
      try { await ctx.reply(`🧮 *${ctx.argText}* = *${calcExpr(ctx.argText)}*`); }
      catch { await ctx.reply('⚠️ That does not look like a valid calculation. Use numbers and + - * / % ( ) only.'); }
    },
  },
  {
    name: 'time', aliases: ['date'], category: 'Utility',
    description: 'Show the current date and time (Pakistan time and UTC).', use: '.time',
    run: async (ctx) => {
      const now = new Date();
      const pkt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', dateStyle: 'full', timeStyle: 'medium' }).format(now);
      const utc = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'medium' }).format(now);
      await ctx.reply(`🕒 *Current time*\n\n🇵🇰 Pakistan: ${pkt}\n🌍 UTC: ${utc}`);
    },
  },
  {
    name: 'device', aliases: [], category: 'Utility',
    description: 'Show which device a user sent their message from (quote their message).', use: '.device (quote a message)',
    run: async (ctx) => {
      const id = ctx.quoted?.stanzaId || ctx.msg.key.id;
      let device = 'Unknown';
      try { const { getDevice } = require('@whiskeysockets/baileys'); if (typeof getDevice === 'function') device = getDevice(id) || 'Unknown'; } catch { /* fallback below */ }
      if (device === 'Unknown' && /^3EB0/.test(id || '')) device = 'Web / Desktop';
      await ctx.reply(`📱 That message was sent from: *${device}*`);
    },
  },
  {
    name: 'getdp', aliases: ['dp'], category: 'Utility',
    description: 'Get the profile photo of the quoted, mentioned or given user.', use: '.getdp / .getdp <number>',
    run: async (ctx) => {
      let url = null;
      try { url = await ctx.sock.profilePictureUrl(ctx.targetJid, 'image'); } catch { url = null; }
      if (!url) { await ctx.reply('⚠️ I could not get that profile photo. It may be hidden by their privacy settings.'); return; }
      await ctx.sock.sendMessage(ctx.jid, { image: { url }, caption: `🖼️ Profile photo of @${ctx.targetJid.split('@')[0]}`, mentions: [ctx.targetJid] }, { quoted: ctx.msg });
    },
  },
  {
    name: 'getbio', aliases: [], category: 'Utility',
    description: 'Get the About/bio of the quoted, mentioned or given user.', use: '.getbio / .getbio <number>',
    run: async (ctx) => {
      let status = null;
      try { const r = await ctx.sock.fetchStatus(ctx.targetJid); status = r?.status; } catch { status = null; }
      const name = ctx.targetJid.split('@')[0];
      await ctx.reply(status ? `📝 *About @${name}:*\n${status}` : `⚠️ No About text found for @${name}, or it is hidden by their privacy settings.`);
    },
  },
  {
    name: 'qrcode', aliases: ['qr'], category: 'Utility',
    description: 'Turn text or a link into a QR code image.', use: '.qr <text or link>',
    run: async (ctx) => {
      if (!ctx.argText) { await ctx.reply('Please give me text or a link, for example *.qr https://example.com*'); return; }
      const QRCode = require('qrcode');
      const buf = await QRCode.toBuffer(ctx.argText, { width: 512, margin: 2 });
      await ctx.sock.sendMessage(ctx.jid, { image: buf, caption: `🔳 QR code for: ${ctx.argText}` }, { quoted: ctx.msg });
    },
  },
  {
    name: 'b64', aliases: [], category: 'Utility',
    description: 'Encode text to Base64.', use: '.b64 <text>',
    run: async (ctx) => {
      if (!ctx.argText) { await ctx.reply('Please give me text to encode, for example *.b64 hello*'); return; }
      await ctx.reply(`🔐 *Base64:*\n${Buffer.from(ctx.argText, 'utf8').toString('base64')}`);
    },
  },
  {
    name: 'b64d', aliases: [], category: 'Utility',
    description: 'Decode Base64 back to text.', use: '.b64d <base64>',
    run: async (ctx) => {
      if (!ctx.argText) { await ctx.reply('Please give me Base64 text to decode, for example *.b64d aGVsbG8=*'); return; }
      try {
        const out = Buffer.from(ctx.argText.trim(), 'base64').toString('utf8');
        if (!out) throw new Error('empty');
        await ctx.reply(`🔓 *Decoded:*\n${out}`);
      } catch { await ctx.reply('⚠️ That is not valid Base64 text.'); }
    },
  },
  {
    name: 'password', aliases: ['pass'], category: 'Utility',
    description: 'Generate a strong random password.', use: '.password / .password 20',
    run: async (ctx) => {
      let len = parseInt(ctx.args[0] || '12', 10);
      if (Number.isNaN(len)) len = 12;
      len = Math.min(64, Math.max(6, len));
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*';
      let out = '';
      for (let i = 0; i < len; i++) out += chars[crypto.randomInt(chars.length)];
      await ctx.reply(`🔑 *Your ${len}-character password:*\n${out}\n\nKeep it somewhere safe and do not share it.`);
    },
  },
  {
    name: 'fancy', aliases: [], category: 'Utility',
    description: 'Turn text into fancy bold styles.', use: '.fancy <text>',
    run: async (ctx) => {
      if (!ctx.argText) { await ctx.reply('Please give me text, for example *.fancy PRIME MD*'); return; }
      const t = ctx.argText.slice(0, 60);
      await ctx.reply(`✨ *Fancy styles:*\n\n${mapStyle(MONO, t)}\n${mapStyle(DS, t)}\n${mapStyle(CIRC, t)}`);
    },
  },
  {
    name: 'id', aliases: [], category: 'Utility',
    description: 'Show your user ID, this chat ID and the session number.', use: '.id',
    run: async (ctx) => {
      await ctx.reply(`🪪 *Your IDs*\n\n👤 You: ${ctx.senderJid}\n💬 Chat: ${ctx.jid}\n📱 Bot session: ${ctx.sessionNumber}@s.whatsapp.net`);
    },
  },
];
