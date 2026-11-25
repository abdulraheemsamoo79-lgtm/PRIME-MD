// PRIME MD - Download commands.
// Backends: Tioo first for YouTube (VEXORA API as fallback), the user's own
// VEXORA API for TikTok / Instagram / Facebook / Twitter / APK / Spotify /
// Pinterest / Lyrics, Invidious search for YouTube search (the API's
// ytsearch endpoint is currently broken upstream), Internet Archive for
// movies. Every failure path ends in ONE friendly English reply.
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getJson, downloadToTmp, cleanup, fmtMB, safeName } = require('../lib/net');
const yt = require('../lib/youtube');
const moviedl = require('../lib/moviedl');
const { runFfmpeg } = require('../lib/wamedia');

const API = () => config.VEXORA_API_BASE;
const firstUrl = (s) => (String(s || '').match(/https?:\/\/[^\s]+/) || [])[0] || '';
const FAIL = '⚠️ Sorry, I could not download that right now. Please check the link and try again in a moment.';

// Download a media URL to tmp and send it; converts nothing, caller picks
// the payload kind. Always cleans the tmp file up.
async function sendMediaFile(ctx, url, { kind, caption, fileName, maxBytes = config.DL_MAX_BYTES }) {
  const { file, size } = await downloadToTmp(url, { maxBytes, ext: path.extname(fileName || '') || '.bin' });
  try {
    const stream = () => fs.createReadStream(file);
    if (kind === 'video') {
      if (size <= config.DL_INLINE_MAX) await ctx.sock.sendMessage(ctx.jid, { video: stream(), caption, mimetype: 'video/mp4' }, { quoted: ctx.msg });
      else await ctx.sock.sendMessage(ctx.jid, { document: stream(), mimetype: 'video/mp4', fileName: fileName || 'video.mp4', caption }, { quoted: ctx.msg });
    } else if (kind === 'audio') {
      if (size <= config.DL_INLINE_MAX) await ctx.sock.sendMessage(ctx.jid, { audio: stream(), mimetype: 'audio/mpeg', fileName: fileName || 'audio.mp3' }, { quoted: ctx.msg });
      else await ctx.sock.sendMessage(ctx.jid, { document: stream(), mimetype: 'audio/mpeg', fileName: fileName || 'audio.mp3', caption }, { quoted: ctx.msg });
    } else if (kind === 'image') {
      await ctx.sock.sendMessage(ctx.jid, { image: stream(), caption }, { quoted: ctx.msg });
    } else {
      await ctx.sock.sendMessage(ctx.jid, { document: stream(), mimetype: 'application/octet-stream', fileName: fileName || 'file', caption }, { quoted: ctx.msg });
    }
  } finally { cleanup(file); }
}

async function ensureMp3(file) {
  if (/\.mp3$/i.test(file)) return file;
  const out = file.replace(/(\.[^.]+)?$/, '.mp3');
  await runFfmpeg(['-y', '-i', file, '-vn', '-codec:a', 'libmp3lame', '-q:a', '2', out]);
  return out;
}

const commands = [
  {
    name: 'video', aliases: ['ytvideo', 'ytmp4'], category: 'Download',
    description: 'Download a YouTube video (link or search words).',
    use: '.video <youtube link or title>',
    run: async (ctx) => {
      if (!ctx.argText) { await ctx.reply('🎬 Please give a YouTube link or a video title, for example *.video pasoori*.'); return; }
      await ctx.reply('⏳ Downloading your video, please wait...');
      const media = await yt.getYouTubeMedia(ctx.argText, 'video');
      if (!media || media.error === 'too_long') { await ctx.reply(media?.error === 'too_long' ? '⚠️ That video is too long to send on WhatsApp. Please try a shorter one.' : FAIL); return; }
      try {
        await sendMediaFile(ctx, media.downloadUrl, { kind: 'video', fileName: `${safeName(media.title, 'video')}.mp4`, caption: `🎬 *${media.title || 'YouTube Video'}*\n\n© POWERED BY ${config.BOT_NAME}` });
      } catch (e) { if (e.message === 'too_large') await ctx.reply(`⚠️ That video is larger than ${fmtMB(config.DL_MAX_BYTES)} and cannot be sent.`); else await ctx.reply(FAIL); }
    },
  },
  {
    name: 'song', aliases: ['play', 'ytmp3'], category: 'Download',
    description: 'Download a song as MP3 audio (YouTube link or song name).',
    use: '.song <youtube link or song name>',
    run: async (ctx) => {
      if (!ctx.argText) { await ctx.reply('🎵 Please give a YouTube link or a song name, for example *.song pasoori*.'); return; }
      await ctx.reply('⏳ Downloading your song, please wait...');
      const media = await yt.getYouTubeMedia(ctx.argText, 'audio');
      if (!media || media.error === 'too_long') { await ctx.reply(FAIL); return; }
      try {
        const { file } = await downloadToTmp(media.downloadUrl, { maxBytes: config.DL_MAX_BYTES, ext: '.bin' });
        let audioFile = file;
        try {
          audioFile = await ensureMp3(file);
          const size = fs.statSync(audioFile).size;
          const stream = () => fs.createReadStream(audioFile);
          const name = `${safeName(media.title, 'song')}.mp3`;
          if (size <= config.DL_INLINE_MAX) await ctx.sock.sendMessage(ctx.jid, { audio: stream(), mimetype: 'audio/mpeg', fileName: name }, { quoted: ctx.msg });
          else await ctx.sock.sendMessage(ctx.jid, { document: stream(), mimetype: 'audio/mpeg', fileName: name, caption: `🎵 *${media.title || 'Song'}*\n\n© POWERED BY ${config.BOT_NAME}` }, { quoted: ctx.msg });
        } finally { cleanup(file); if (audioFile !== file) cleanup(audioFile); }
      } catch (e) { if (e.message === 'too_large') await ctx.reply(`⚠️ That audio is larger than ${fmtMB(config.DL_MAX_BYTES)} and cannot be sent.`); else await ctx.reply(FAIL); }
    },
  },
  {
    name: 'tiktok', aliases: ['tt', 'ttdl'], category: 'Download',
    description: 'Download a TikTok video without watermark.',
    use: '.tiktok <tiktok link>',
    run: async (ctx) => {
      const url = firstUrl(ctx.argText);
      if (!url) { await ctx.reply('🎵 Please give a TikTok link, for example *.tiktok https://www.tiktok.com/...*'); return; }
      await ctx.reply('⏳ Downloading your TikTok video, please wait...');
      try {
        const j = await getJson(`${API()}/api/tiktok-v2?url=${encodeURIComponent(url)}`, 60000);
        const r = j?.result;
        if (!j?.status || !r?.video_download) { await ctx.reply(FAIL); return; }
        const caption = `🎵 *${(r.title || 'TikTok Video').slice(0, 200)}*\n👤 ${r.author?.nickname || 'Unknown'}\n⏱️ ${r.duration || ''}\n\n© POWERED BY ${config.BOT_NAME}`;
        await sendMediaFile(ctx, r.video_download, { kind: 'video', fileName: 'tiktok.mp4', caption });
      } catch { await ctx.reply(FAIL); }
    },
  },
  {
    name: 'ig', aliases: ['igdl', 'instagram'], category: 'Download',
    description: 'Download an Instagram post or reel.',
    use: '.ig <instagram link>',
    run: async (ctx) => {
      const url = firstUrl(ctx.argText);
      if (!url) { await ctx.reply('📸 Please give an Instagram link, for example *.ig https://www.instagram.com/reel/...*'); return; }
      await ctx.reply('⏳ Downloading from Instagram, please wait...');
      try {
        const j = await getJson(`${API()}/api/instagram?url=${encodeURIComponent(url)}`, 90000);
        const r = j?.result;
        const link = r?.video || r?.image || j?.downloadUrl;
        if (!link) { await ctx.reply('⚠️ Sorry, no downloadable media was found for that Instagram link. It may be private or removed.'); return; }
        const caption = `📸 ${(r?.caption || 'Instagram').slice(0, 300)}\n\n© POWERED BY ${config.BOT_NAME}`;
        if (r?.video) await sendMediaFile(ctx, r.video, { kind: 'video', fileName: 'instagram.mp4', caption });
        else await sendMediaFile(ctx, link, { kind: 'image', caption });
      } catch { await ctx.reply(FAIL); }
    },
  },
  {
    name: 'fb', aliases: ['facebook', 'fbdl'], category: 'Download',
    description: 'Download a Facebook video or reel.',
    use: '.fb <facebook link>',
    run: async (ctx) => {
      const url = firstUrl(ctx.argText);
      if (!url) { await ctx.reply('📘 Please give a Facebook video link, for example *.fb https://www.facebook.com/...*'); return; }
      await ctx.reply('⏳ Downloading your Facebook video, please wait...');
      try {
        const j = await getJson(`${API()}/api/fbdl?url=${encodeURIComponent(url)}`, 90000);
        const link = j?.hd_link || j?.download_url || j?.sd_link || j?.result?.video;
        if (!j?.status || !link) { await ctx.reply(FAIL); return; }
        await sendMediaFile(ctx, link, { kind: 'video', fileName: 'facebook.mp4', caption: `📘 *${(j?.title || 'Facebook Video').slice(0, 200)}*\n\n© POWERED BY ${config.BOT_NAME}` });
      } catch { await ctx.reply(FAIL); }
    },
  },
  {
    name: 'twitter', aliases: ['x', 'twdl'], category: 'Download',
    description: 'Download a video from a Twitter / X post.',
    use: '.twitter <tweet link>',
    run: async (ctx) => {
      const url = firstUrl(ctx.argText);
      if (!url) { await ctx.reply('🐦 Please give a tweet link, for example *.twitter https://x.com/.../status/...*'); return; }
      await ctx.reply('⏳ Downloading your tweet video, please wait...');
      try {
        const j = await getJson(`${API()}/api/twitter?url=${encodeURIComponent(url)}`, 60000);
        const r = j?.result;
        const link = r?.video_hd || r?.video_sd;
        if (!j?.status || !link) { await ctx.reply('⚠️ Sorry, no video was found in that tweet.'); return; }
        await sendMediaFile(ctx, link, { kind: 'video', fileName: 'twitter.mp4', caption: `🐦 *${(r?.desc || 'Twitter Video').slice(0, 200)}*\n\n© POWERED BY ${config.BOT_NAME}` });
      } catch { await ctx.reply(FAIL); }
    },
  },
  {
    name: 'apk', aliases: ['apkdl'], category: 'Download',
    description: 'Search for an Android app and send its APK file.',
    use: '.apk <app name>',
    run: async (ctx) => {
      if (!ctx.argText) { await ctx.reply('📦 Please give an app name, for example *.apk whatsapp*.'); return; }
      await ctx.reply('⏳ Searching for the app, please wait...');
      try {
        const j = await getJson(`${API()}/api/apk-search?q=${encodeURIComponent(ctx.argText)}`, 60000);
        const list = j?.data?.datalist?.list || [];
        const app = list.find(a => a?.file?.path) || list[0];
        if (!app?.file?.path) { await ctx.reply(`⚠️ Sorry, no APK was found for "${ctx.argText}".`); return; }
        const size = Number(app.file.filesize || app.size || 0);
        const info = `📦 *${app.name}*\n👨‍💻 ${app.developer?.name || 'Unknown'}\n🔢 Version: ${app.file.vername || '?'}\n💾 Size: ${size ? fmtMB(size) : 'Unknown'}\n\n⏳ Downloading the APK, please wait...`;
        await ctx.reply(info);
        await sendMediaFile(ctx, app.file.path, { kind: 'document', fileName: `${safeName(app.name, 'app')}.apk`, caption: `📦 *${app.name}* APK\n\n© POWERED BY ${config.BOT_NAME}` });
      } catch (e) { if (e.message === 'too_large') await ctx.reply('⚠️ That APK is too large to send here.'); else await ctx.reply(FAIL); }
    },
  },
  {
    name: 'spotify', aliases: ['spotifydl'], category: 'Download',
    description: 'Download the audio of a Spotify track (matched from YouTube).',
    use: '.spotify <spotify track link>',
    run: async (ctx) => {
      const url = firstUrl(ctx.argText);
      if (!url || !/open\.spotify\.com/.test(url)) { await ctx.reply('🎧 Please give a Spotify track link, for example *.spotify https://open.spotify.com/track/...*'); return; }
      await ctx.reply('⏳ Finding your track, please wait...');
      try {
        const j = await getJson(`${API()}/api/spotifydl?url=${encodeURIComponent(url)}`, 90000);
        const r = j?.result;
        if (!j?.status || !r?.audio_download) { await ctx.reply(FAIL); return; }
        await ctx.reply(`🎧 *${r.title}*${r.artist ? ` - ${r.artist}` : ''}\nAudio matched from YouTube. Downloading...`);
        await sendMediaFile(ctx, r.audio_download, { kind: 'audio', fileName: `${safeName(r.title, 'spotify')}.mp3` });
      } catch { await ctx.reply(FAIL); }
    },
  },
  {
    name: 'pinterest', aliases: ['pin'], category: 'Download',
    description: 'Download a Pinterest pin (photo or video) from its link.',
    use: '.pinterest <pin link>',
    run: async (ctx) => {
      const url = firstUrl(ctx.argText);
      if (!url) { await ctx.reply('📌 Please give a Pinterest pin link, for example *.pinterest https://www.pinterest.com/pin/...*'); return; }
      await ctx.reply('⏳ Downloading your pin, please wait...');
      try {
        const v = await getJson(`${API()}/api/pinterest-video?url=${encodeURIComponent(url)}`, 60000).catch(() => null);
        if (v?.status && v.result) {
          await sendMediaFile(ctx, v.result, { kind: 'video', fileName: 'pinterest.mp4', caption: `📌 Pinterest Video\n\n© POWERED BY ${config.BOT_NAME}` });
          return;
        }
        const p = await getJson(`${API()}/api/pinterest-photo?url=${encodeURIComponent(url)}`, 60000);
        if (p?.status && p.result) {
          await sendMediaFile(ctx, p.result, { kind: 'image', caption: `📌 Pinterest Photo\n\n© POWERED BY ${config.BOT_NAME}` });
          return;
        }
        await ctx.reply('⚠️ Sorry, no downloadable media was found for that pin.');
      } catch { await ctx.reply(FAIL); }
    },
  },
  {
    name: 'lyrics', aliases: ['lyric'], category: 'Download',
    description: 'Find the lyrics of a song.',
    use: '.lyrics <artist - title>',
    run: async (ctx) => {
      if (!ctx.argText) { await ctx.reply('🎤 Please give a song, for example *.lyrics Adele - Hello*.'); return; }
      try {
        const j = await getJson(`${API()}/api/lyrics?q=${encodeURIComponent(ctx.argText)}`, 60000);
        const r = j?.result;
        if (!j?.status || !r?.lyrics) { await ctx.reply(`⚠️ Sorry, no lyrics were found for "${ctx.argText}". Try the format: Artist - Song Title.`); return; }
        const text = `🎤 *${r.title}* - ${r.artist}\n\n${r.lyrics.slice(0, 3500)}${r.lyrics.length > 3500 ? '\n\n...(continued in the next message)' : ''}\n\n© POWERED BY ${config.BOT_NAME}`;
        await ctx.reply(text);
        if (r.lyrics.length > 3500) await ctx.sock.sendMessage(ctx.jid, { text: r.lyrics.slice(3500, 7000) });
      } catch { await ctx.reply(FAIL); }
    },
  },
  {
    name: 'ytsearch', aliases: ['yts'], category: 'Download',
    description: 'Search YouTube and list the top results (links only).',
    use: '.ytsearch <words>',
    run: async (ctx) => {
      if (!ctx.argText) { await ctx.reply('🔎 Please give search words, for example *.ytsearch lofi beats*.'); return; }
      try {
        const hits = await yt.searchYouTube(ctx.argText, 10);
        if (!hits.length) { await ctx.reply(`⚠️ No YouTube results found for "${ctx.argText}".`); return; }
        let out = `🔎 *YouTube results for "${ctx.argText}"*\n`;
        hits.forEach((h, i) => { out += `\n${i + 1}. *${h.title}*\n   👤 ${h.author} • ⏱️ ${h.duration || '?'} • 👁️ ${Number(h.views).toLocaleString()}\n   🔗 ${h.url}\n`; });
        out += `\n© POWERED BY ${config.BOT_NAME}`;
        await ctx.reply(out);
      } catch { await ctx.reply(FAIL); }
    },
  },
  {
    name: 'moviedl', aliases: ['movie'], category: 'Download',
    description: 'Search Internet Archive movies and download one as a document.',
    use: '.moviedl <movie name>',
    run: async (ctx) => {
      if (!ctx.argText) { await ctx.reply('🎬 Please give a movie name, for example *.moviedl Night of the Living Dead*.'); return; }
      await ctx.reply('⏳ Searching Internet Archive, please wait...');
      let results;
      try { results = await moviedl.searchMovies(ctx.argText); } catch { await ctx.reply(FAIL); return; }
      if (!results.length) { await ctx.reply(`⚠️ Sorry, no movie found for "${ctx.argText}" on Internet Archive.`); return; }
      moviedl.setPending(ctx.sessionNumber, ctx.senderJid, results);
      let out = `🎬 *Movies found for "${ctx.argText}"*\n\nReply to this message with a number (1-${results.length}) within 5 minutes to download it.\n`;
      results.forEach((r, i) => { out += `\n${i + 1}. *${String(r.title).slice(0, 80)}*\n   ⬇️ ${Number(r.downloads).toLocaleString()} downloads`; });
      out += `\n\n© POWERED BY ${config.BOT_NAME}`;
      await ctx.reply(out);
    },
  },
];

// Called by index.js when a user sends a bare number while a movie pick is
// pending for them. Returns true when the message was handled.
async function handleMoviePick(ctx) {
  const pick = moviedl.getPending(ctx.sessionNumber, ctx.senderJid);
  if (!pick) return false;
  const n = parseInt(String(ctx.argText || '').trim(), 10);
  if (!Number.isInteger(n) || n < 1 || n > pick.items.length) return false;
  moviedl.clearPending(ctx.sessionNumber, ctx.senderJid);
  const chosen = pick.items[n - 1];
  await ctx.reply(`🎬 *${String(chosen.title).slice(0, 80)}*\n⏳ Finding the best file and downloading it - large movies can take a few minutes...`);
  try {
    const best = await moviedl.getBestFile(chosen.identifier);
    if (!best) { await ctx.reply('⚠️ Sorry, no downloadable video file under 1.95 GB was found for that movie.'); return true; }
    const { file } = await moviedl.streamDownload(best.url, { maxBytes: config.MOVIE_MAX_BYTES, ext: path.extname(best.name) || '.mp4' });
    try {
      const stream = () => fs.createReadStream(file);
      await ctx.sock.sendMessage(ctx.jid, {
        document: stream(), mimetype: 'video/mp4',
        fileName: best.name,
        caption: `🎬 *${String(chosen.title).slice(0, 80)}*\n💾 ${fmtMB(best.size)}\n\n© POWERED BY ${config.BOT_NAME}`,
      }, { quoted: ctx.msg });
    } finally { cleanup(file); }
  } catch (e) {
    if (e.message === 'too_large') await ctx.reply('⚠️ That movie file is larger than 1.95 GB and cannot be sent.');
    else await ctx.reply(FAIL);
  }
  return true;
}

module.exports = commands;
module.exports.handleMoviePick = handleMoviePick;
