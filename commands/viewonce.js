// PRIME MD - View-once saving: .vv and .vv2, plus the bare "vv"
// reply trigger (wired in index.js by treating a bare "vv" as .vv).
//
// EXACT-ONLY RULE (hard): media is only ever taken from THIS chat - either
// the exact quoted message (its stanza id in the arrival cache, or the
// view-once content inside the quoted message itself) or, when there is no
// quote, the latest cached view-once in this same chat. If none is found we
// reply "not found". Media from another chat can never be substituted,
// because the cache key includes the chat JID.
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../config');
const vvcache = require('../lib/vvcache');
const { findMedia, isViewOnce, downloadMedia, toOpusVoice } = require('../lib/wamedia');

const TYPE_LABEL = { image: 'Photo', video: 'Video', audio: 'Voice Note' };

function box(type, withFooter) {
  let out = '┌─ 📥 VIEW ONCE SAVED ─────────\n';
  out += '├ Status: Saved\n';
  out += `├ Type: ${TYPE_LABEL[type] || 'Media'}\n`;
  out += '└─────────────────────────';
  if (withFooter) out += `\n© POWERED BY ${config.BOT_NAME}`;
  return out;
}

// Resolve the target entry for this command invocation, exact-chat only.
function resolveEntry(ctx) {
  const stanzaId = ctx.quoted?.stanzaId;
  if (stanzaId) {
    const cached = vvcache.get(ctx.sessionNumber, ctx.jid, stanzaId);
    if (cached) return cached;
    // The quoted message itself may carry the view-once content.
    if (ctx.quoted.message && isViewOnce(ctx.quoted.message)) {
      const media = findMedia(ctx.quoted.message);
      if (media && ['image', 'video', 'audio'].includes(media.type)) {
        return { type: media.type, content: media.content, chatJid: ctx.jid, msgId: stanzaId };
      }
    }
    return null; // a specific message was quoted - never fall back to another one
  }
  return vvcache.latest(ctx.sessionNumber, ctx.jid);
}

async function run(ctx, toDm) {
  const entry = resolveEntry(ctx);
  if (!entry) {
    await ctx.reply('⚠️ Sorry, I could not find that view-once message. Please reply to a fresh view-once photo, video or voice note with .vv and try again.');
    return;
  }
  const dest = toDm ? ctx.senderJid : ctx.jid;
  let buffer;
  try { buffer = await downloadMedia(entry.content, entry.type); }
  catch { await ctx.reply('⚠️ Sorry, that view-once media could not be downloaded anymore. It may have expired.'); return; }
  if (!buffer || !buffer.length) { await ctx.reply('⚠️ Sorry, that view-once media could not be downloaded anymore. It may have expired.'); return; }

  const caption = box(entry.type, !toDm);
  try {
    if (entry.type === 'image') {
      await ctx.sock.sendMessage(dest, { image: buffer, caption }, { quoted: ctx.msg });
    } else if (entry.type === 'video') {
      await ctx.sock.sendMessage(dest, { video: buffer, caption, mimetype: 'video/mp4' }, { quoted: ctx.msg });
    } else {
      // Voice notes must go out as real voice notes (ptt, opus).
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prime-vv-'));
      const raw = path.join(dir, 'voice.bin');
      const ogg = path.join(dir, 'voice.ogg');
      fs.writeFileSync(raw, buffer);
      let sent = false;
      try {
        await toOpusVoice(raw, ogg);
        await ctx.sock.sendMessage(dest, { audio: fs.readFileSync(ogg), ptt: true, mimetype: 'audio/ogg; codecs=opus' }, { quoted: ctx.msg });
        sent = true;
      } catch { sent = false; }
      if (!sent) await ctx.sock.sendMessage(dest, { audio: buffer, ptt: true, mimetype: 'audio/ogg; codecs=opus' }, { quoted: ctx.msg });
      await ctx.sock.sendMessage(dest, { text: caption }); // voice notes cannot carry captions
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  } catch {
    await ctx.reply('⚠️ Sorry, the saved media could not be sent right now. Please try again.');
  }
}

module.exports = [
  {
    name: 'vv', aliases: [], category: 'View Once',
    description: 'Save a view-once photo, video or voice note into this same chat.',
    use: '.vv (reply to a view-once message)',
    run: async (ctx) => run(ctx, false),
  },
  {
    name: 'vv2', aliases: [], category: 'View Once',
    description: 'Save a view-once photo, video or voice note into your DM.',
    use: '.vv2 (reply to a view-once message)',
    run: async (ctx) => run(ctx, true),
  },
];
