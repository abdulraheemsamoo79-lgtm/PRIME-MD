// PRIME MD - Status tools: .groupstatus and .4kstatus/.hdstatus.
//
// Every status send passes a statusJidList audience (see
// lib/statusAudience.js) - without it WhatsApp accepts the send but the
// status is visible to nobody. And we only ever say "posted" AFTER the
// send call has actually succeeded.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const config = require('../config');
const { getStatusAudience } = require('../lib/statusAudience');
const { findMedia, downloadMedia, probeDuration, runFfmpeg } = require('../lib/wamedia');
const { tmpPath, cleanup, fmtMB } = require('../lib/net');

async function quotedMedia(ctx) {
  if (!ctx.quoted?.message) return null;
  const media = findMedia(ctx.quoted.message);
  if (!media) return null;
  const buffer = await downloadMedia(media.content, media.type);
  return { ...media, buffer };
}

async function postToStatus(ctx, payload) {
  const audience = await getStatusAudience(ctx.sock, ctx.sessionNumber, [ctx.senderJid]);
  await ctx.sock.sendMessage('status@broadcast', payload, { statusJidList: audience });
}

module.exports = [
  {
    name: 'groupstatus', aliases: ['gcstatus'], category: 'Status',
    description: 'Post text or a quoted photo, video, audio or sticker to your own WhatsApp status.',
    use: '.groupstatus <text> / reply to media with .groupstatus',
    run: async (ctx) => {
      try {
        const media = await quotedMedia(ctx).catch(() => null);
        if (media && media.buffer?.length) {
          const payload =
            media.type === 'image' ? { image: media.buffer, caption: ctx.argText || undefined } :
            media.type === 'video' ? { video: media.buffer, caption: ctx.argText || undefined, mimetype: 'video/mp4' } :
            media.type === 'audio' ? { audio: media.buffer, mimetype: media.content.mimetype || 'audio/mp4' } :
            media.type === 'sticker' ? { sticker: media.buffer } : null;
          if (!payload) { await ctx.reply('⚠️ That kind of message cannot be posted to a status.'); return; }
          await postToStatus(ctx, payload);
          await ctx.reply('✅ Posted to your status.');
          return;
        }
        if (ctx.argText) {
          await postToStatus(ctx, { text: ctx.argText });
          await ctx.reply('✅ Posted to your status.');
          return;
        }
        // The quoted message may be plain text.
        const quotedText = ctx.quoted?.message?.conversation || ctx.quoted?.message?.extendedTextMessage?.text;
        if (quotedText) {
          await postToStatus(ctx, { text: quotedText });
          await ctx.reply('✅ Posted to your status.');
          return;
        }
        await ctx.reply('⚠️ Please write some text or reply to a photo, video, audio or sticker, for example *.groupstatus Hello everyone*.');
      } catch {
        await ctx.reply('⚠️ Sorry, the status could not be posted right now. Please try again.');
      }
    },
  },
  {
    name: '4kstatus', aliases: ['hdstatus'], category: 'Status',
    description: 'Post a quoted photo or video to your status in HD (1080x1920). Videos are split into 90-second parts, max 4.',
    use: '.4kstatus (reply to a photo or video)',
    run: async (ctx) => {
      let media;
      try { media = await quotedMedia(ctx); } catch { media = null; }
      if (!media || !['image', 'video'].includes(media.type)) {
        await ctx.reply('⚠️ Please reply to a photo or video with *.4kstatus* to post it in HD.');
        return;
      }
      if (media.buffer.length > (media.type === 'image' ? config.STATUS_PHOTO_MAX : config.STATUS_VIDEO_MAX)) {
        await ctx.reply(`⚠️ That ${media.type} is too large (max ${fmtMB(media.type === 'image' ? config.STATUS_PHOTO_MAX : config.STATUS_VIDEO_MAX)}).`);
        return;
      }
      await ctx.reply('⏳ Preparing your HD status, please wait...');
      try {
        if (media.type === 'image') {
          const out = await sharp(media.buffer)
            .rotate()
            .resize(1080, 1920, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 1 } })
            .sharpen()
            .jpeg({ quality: 92 })
            .toBuffer();
          await postToStatus(ctx, { image: out, caption: ctx.argText || undefined });
          await ctx.reply('✅ HD photo posted to your status.');
          return;
        }
        // Video: convert into the 1080 box, split at 90s, max 4 parts.
        const inFile = tmpPath('.mp4');
        fs.writeFileSync(inFile, media.buffer);
        try {
          const duration = await probeDuration(inFile);
          const totalParts = Math.max(1, Math.min(4, Math.ceil((duration || 90) / 90)));
          let posted = 0;
          for (let i = 0; i < totalParts; i++) {
            const outFile = tmpPath('.mp4');
            try {
              await runFfmpeg([
                '-y', '-ss', String(i * 90), '-i', inFile, '-t', '90',
                '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30',
                '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-maxrate', '6M', '-bufsize', '12M',
                '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', outFile,
              ]);
              await postToStatus(ctx, { video: fs.readFileSync(outFile), mimetype: 'video/mp4', caption: totalParts > 1 ? `Part ${i + 1}/${totalParts}` : (ctx.argText || undefined) });
              posted++;
            } finally { cleanup(outFile); }
          }
          if (!posted) { await ctx.reply('⚠️ Sorry, the HD video could not be prepared. Please try again.'); return; }
          await ctx.reply(duration > 360
            ? `✅ HD video posted to your status in ${posted} parts (only the first 6 minutes - the 4-part limit).`
            : `✅ HD video posted to your status${posted > 1 ? ` in ${posted} parts` : ''}.`);
        } finally { cleanup(inFile); }
      } catch {
        await ctx.reply('⚠️ Sorry, the HD status could not be posted right now. Please try again.');
      }
    },
  },
];
