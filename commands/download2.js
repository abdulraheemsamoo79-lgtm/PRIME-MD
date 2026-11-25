// PRIME MD - Download commands (continued): .drama with its DOCUMENT /
// VIDEO choice card, .mediafire, .mega and .gdrive. Every failure path
// ends in ONE friendly English reply; nothing here ever fakes a result.
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { downloadToTmp, cleanup, fmtMB, safeName, tmpPath } = require('../lib/net');
const dramaLib = require('../lib/drama');
const mediafireLib = require('../lib/mediafire');
const gdriveLib = require('../lib/gdrive');
const megaLib = require('../lib/mega');
const { runFfmpeg } = require('../lib/wamedia');

const FAIL = '⚠️ Sorry, I could not download that right now. Please check the link and try again in a moment.';
const firstUrl = (s) => (String(s || '').match(/https?:\/\/[^\s]+/) || [])[0] || '';

async function sendDocumentFile(ctx, file, fileName, caption) {
  const stream = () => fs.createReadStream(file);
  await ctx.sock.sendMessage(ctx.jid, {
    document: stream(), mimetype: 'application/octet-stream', fileName, caption,
  }, { quoted: ctx.msg });
}

// ---------------- .drama ----------------
function dramaCardText(video) {
  return `🎬 *${video.title}*\n\n` +
    `⏱️ Duration: ${video.duration || ''}\n` +
    `👁️ Views: ${Number(video.views || 0).toLocaleString()}\n` +
    `📺 Channel: ${video.author || 'Unknown'}\n\n` +
    `📂 (1) DOCUMENT\n` +
    `🎥 (2) VIDEO\n\n` +
    `Reply to *this message* with 1 or 2 within 5 minutes.\n\n© POWERED BY ${config.BOT_NAME}`;
}

async function sendDramaFile(ctx, pendingEntry, asDocument, note) {
  const video = pendingEntry.video;
  const resolved = await dramaLib.resolve(video.url);
  if (!resolved) { await ctx.reply(FAIL); return; }
  const fileName = `${safeName(video.title, 'drama')}.mp4`;
  const caption = `🎬 *${String(video.title).slice(0, 120)}*\n\n© POWERED BY ${config.BOT_NAME}`;
  try {
    if (resolved.pair) {
      // Separate video+audio links: mux into one MP4, always a document.
      const v = await dramaLib.streamDownload(resolved.videoUrl, { maxBytes: config.DL_MAX_BYTES, ext: '.mp4' });
      const a = await dramaLib.streamDownload(resolved.audioUrl, { maxBytes: config.DL_MAX_BYTES, ext: '.m4a' });
      try {
        const out = path.join(path.dirname(v.file), 'drama-out.mp4');
        await runFfmpeg(['-y', '-i', v.file, '-i', a.file, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', out]);
        await sendDocumentFile(ctx, out, fileName, caption);
      } finally { cleanup(v.file); cleanup(a.file); }
      return;
    }
    const { file, size } = await dramaLib.streamDownload(resolved.downloadUrl, { maxBytes: config.DL_MAX_BYTES, ext: '.mp4' });
    try {
      if (!asDocument && size <= config.DL_INLINE_MAX) {
        const stream = () => fs.createReadStream(file);
        await ctx.sock.sendMessage(ctx.jid, { video: stream(), mimetype: 'video/mp4', caption }, { quoted: ctx.msg });
      } else {
        if (!asDocument && note !== 'forced') await ctx.reply('ℹ️ That file is too large to play inline, so I am sending it as a document instead.');
        await sendDocumentFile(ctx, file, fileName, caption);
      }
    } finally { cleanup(file); }
  } catch (e) {
    if (e.message === 'too_large') await ctx.reply(`⚠️ That file is larger than ${fmtMB(config.DL_MAX_BYTES)} and cannot be sent.`);
    else await ctx.reply(FAIL);
  }
}

// Called by index.js for non-command messages. A pick counts ONLY when it
// is a quote-reply to the choice card itself, with text "1" or "2".
// A bare number without a quote is never picked up (returns false).
async function handleDramaPick(ctx) {
  const text = String(ctx.argText || '').trim();
  if (text !== '1' && text !== '2') return false;
  const stanzaId = ctx.quoted?.stanzaId;
  if (!stanzaId) return false; // bare number - not a pick
  const entry = dramaLib.getPending(ctx.sessionNumber, ctx.senderJid);
  if (!entry) return false;
  if (entry.stanzaId !== stanzaId || entry.jid !== ctx.jid) return false;
  dramaLib.clearPending(ctx.sessionNumber, ctx.senderJid);
  if (text === '2' && (entry.video.durationSeconds || 0) > dramaLib.MAX_INLINE_SECONDS) {
    // Option (2) as an inline video is refused past 10 minutes - the file
    // is delivered as a document (option 1) instead, never as a fake video.
    await ctx.reply(`🎥 This drama is ${entry.video.duration || 'over 10 minutes'} long - longer than 10 minutes, so it cannot be played as an inline video. Sending it as a *document* (option 1) instead, please wait...`);
    await sendDramaFile(ctx, entry, true, 'forced');
    return true;
  }
  await ctx.reply(text === '1' ? '📂 Preparing your document, please wait...' : '🎥 Preparing your video, please wait...');
  await sendDramaFile(ctx, entry, text === '1');
  return true;
}

const commands = [
  {
    name: 'drama', aliases: ['darama'], category: 'Download',
    description: 'Find a drama episode by name and choose DOCUMENT or VIDEO.',
    use: '.drama <drama name>',
    run: async (ctx) => {
      const name = ctx.argText.trim();
      if (!name) { await ctx.reply('🎬 Please give a drama name, for example *.drama Bano*.'); return; }
      if (/youtu\.?be|youtube\.com/i.test(name)) { await ctx.reply('🎬 Please type the drama *name* only - links are not allowed for this command.'); return; }
      await ctx.reply('⏳ Searching for your drama, please wait...');
      let video = null;
      try { video = await dramaLib.findDrama(name); } catch { /* handled below */ }
      if (!video) { await ctx.reply(`⚠️ Sorry, no drama episode of 15 minutes or longer was found for "${name}". Try the full drama name.`); return; }
      const caption = dramaCardText(video);
      let sent = null;
      try {
        sent = await ctx.sock.sendMessage(ctx.jid, { image: { url: video.thumbnail }, caption }, { quoted: ctx.msg });
      } catch { sent = null; }
      if (!sent?.key?.id) {
        try { sent = await ctx.sock.sendMessage(ctx.jid, { text: caption }, { quoted: ctx.msg }); } catch { sent = null; }
      }
      if (!sent?.key?.id) { await ctx.reply(FAIL); return; }
      dramaLib.setPending(ctx.sessionNumber, ctx.senderJid, { stanzaId: sent.key.id, jid: ctx.jid, video });
    },
  },
  {
    name: 'mediafire', aliases: ['mfdl'], category: 'Download',
    description: 'Download a file from a MediaFire link.',
    use: '.mediafire <mediafire file link>',
    run: async (ctx) => {
      const url = firstUrl(ctx.argText);
      if (!url || !mediafireLib.isMediaFireUrl(url)) { await ctx.reply('📥 Please give a MediaFire file link, for example *.mediafire https://www.mediafire.com/file/...*'); return; }
      await ctx.reply('⏳ Getting your MediaFire file, please wait...');
      let found;
      try { found = await mediafireLib.resolveMediafire(url); }
      catch (e) {
        if (e.message === 'blocked') { await ctx.reply('⚠️ MediaFire is showing a protection check right now, so the file cannot be fetched. Please try again in a little while.'); return; }
        await ctx.reply('⚠️ Sorry, no download link was found on that page. The file may be removed, private, or the link may be wrong.');
        return;
      }
      try {
        const fileName = found.fileName || 'mediafire_file';
        const { file } = await downloadToTmp(found.url, { maxBytes: config.DL_MAX_BYTES, ext: path.extname(fileName) || '.bin' });
        try {
          await sendDocumentFile(ctx, file, fileName, `📥 *${fileName}*\n\n© POWERED BY ${config.BOT_NAME}`);
        } finally { cleanup(file); }
      } catch (e) {
        if (e.message === 'too_large') await ctx.reply(`⚠️ That file is larger than ${fmtMB(config.DL_MAX_BYTES)} and cannot be sent.`);
        else await ctx.reply(FAIL);
      }
    },
  },
  {
    name: 'mega', aliases: ['megadl'], category: 'Download',
    description: 'Download a file from a Mega link.',
    use: '.mega <mega file link>',
    run: async (ctx) => {
      const url = firstUrl(ctx.argText);
      if (!url || !megaLib.isMegaUrl(url)) { await ctx.reply('📥 Please give a Mega file link, for example *.mega https://mega.nz/file/...*'); return; }
      let parsed;
      try { parsed = megaLib.parseMega(url); } catch (e) {
        if (e.message === 'folder') { await ctx.reply('⚠️ That is a Mega *folder* link. Please send the link of a single file instead.'); return; }
        await ctx.reply('⚠️ That Mega link looks invalid. Please check it and try again.');
        return;
      }
      void parsed;
      await ctx.reply('⏳ Downloading your Mega file, please wait...');
      const dest = tmpPath('.bin');
      try {
        const { name } = await megaLib.downloadMega(url, dest, config.DL_MAX_BYTES);
        const fileName = name || 'mega_file';
        try {
          await sendDocumentFile(ctx, dest, fileName, `📥 *${fileName}*\n\n© POWERED BY ${config.BOT_NAME}`);
        } finally { cleanup(dest); }
      } catch (e) {
        cleanup(dest);
        if (e.message === 'too_large') await ctx.reply(`⚠️ That file is larger than ${fmtMB(config.DL_MAX_BYTES)} and cannot be sent.`);
        else await ctx.reply('⚠️ Sorry, that Mega file could not be downloaded. The link may be dead, removed, or over its transfer quota.');
      }
    },
  },
  {
    name: 'gdrive', aliases: ['gd'], category: 'Download',
    description: 'Download a public file from a Google Drive link.',
    use: '.gdrive <google drive file link>',
    run: async (ctx) => {
      const url = firstUrl(ctx.argText);
      if (!url || !/drive\.google\.com|drive\.usercontent\.google\.com/i.test(url)) { await ctx.reply('📥 Please give a Google Drive file link, for example *.gdrive https://drive.google.com/file/d/.../view*'); return; }
      if (/\/folders\//.test(url)) { await ctx.reply('⚠️ That is a Google Drive *folder* link. Please send the link of a single file instead.'); return; }
      const id = gdriveLib.extractId(url);
      if (!id) { await ctx.reply('⚠️ I could not find a file ID in that link. Please check it and try again.'); return; }
      await ctx.reply('⏳ Getting your Drive file, please wait...');
      let resolved;
      try { resolved = await gdriveLib.resolveGdrive(id); }
      catch (e) {
        if (e.message === 'private') { await ctx.reply('⚠️ That file is not public. Please set it to "Anyone with the link" in Google Drive and try again.'); return; }
        if (e.message === 'quota') { await ctx.reply('⚠️ This file has hit Google Drive\'s download quota for now. Please try again later.'); return; }
        await ctx.reply(FAIL);
        return;
      }
      try {
        const fileName = resolved.fileName || 'gdrive_file';
        const { file, contentType } = await downloadToTmp(resolved.downloadUrl, { maxBytes: config.DL_MAX_BYTES, ext: path.extname(fileName) || '.bin' });
        try {
          if (/text\/html/i.test(contentType || '')) { await ctx.reply('⚠️ Google Drive did not hand over the file - it may be private or over its download quota.'); return; }
          await sendDocumentFile(ctx, file, fileName, `📥 *${fileName}*\n\n© POWERED BY ${config.BOT_NAME}`);
        } finally { cleanup(file); }
      } catch (e) {
        if (e.message === 'too_large') await ctx.reply(`⚠️ That file is larger than ${fmtMB(config.DL_MAX_BYTES)} and cannot be sent.`);
        else await ctx.reply(FAIL);
      }
    },
  },
];

module.exports = commands;
module.exports.handleDramaPick = handleDramaPick;
