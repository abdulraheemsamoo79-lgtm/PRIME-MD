// PRIME MD - Media, sticker & audio tools (Phase 3). Everything runs
// locally with sharp + the bundled ffmpeg; the only network features are
// .emojimix (Google's emoji-kitchen CDN) and .tourl (catbox, with a
// litterbox fallback - uploads could not be verified from the build
// sandbox, failures are reported honestly to the user).
const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');
const { findMedia, downloadMedia, runFfmpeg } = require('../lib/wamedia');
const stickerLib = require('../lib/sticker');
const { tmpPath, cleanup } = require('../lib/net');

const NO_MEDIA = '⚠️ Please send an image/audio or reply to one with this command.';
const FAIL = '⚠️ Sorry, that could not be processed right now. Please try again with a smaller file.';

async function mediaOf(ctx, ownAllowed = true) {
  if (ctx.quoted?.message) {
    const m = findMedia(ctx.quoted.message);
    if (m) return { ...m, buffer: await downloadMedia(m.content, m.type) };
  }
  if (ownAllowed && ctx.msg?.message) {
    const m = findMedia(ctx.msg.message);
    if (m) return { ...m, buffer: await downloadMedia(m.content, m.type) };
  }
  return null;
}
async function imageOf(ctx) {
  const m = await mediaOf(ctx).catch(() => null);
  if (!m || !['image', 'sticker'].includes(m.type)) return null;
  return m;
}
function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'prime-media-')); }

function imageFilterCmd(name, description, use, fn, aliases = []) {
  return {
    name, aliases, category: 'Media', description, use,
    run: async (ctx) => {
      const m = await imageOf(ctx);
      if (!m) { await ctx.reply(NO_MEDIA); return; }
      try {
        const out = await fn(sharp(m.buffer));
        await ctx.sock.sendMessage(ctx.jid, { image: out, caption: `✅ Done with ${ctx.config.PREFIX}${name}` }, { quoted: ctx.msg });
      } catch { await ctx.reply(FAIL); }
    },
  };
}

const KITCHEN_DATES = ['20201001', '20220513', '20210521', '20220215', '20230103', '20230301', '20231113'];
function emojiCode(emoji) {
  const cps = [...emoji].map(c => c.codePointAt(0)).filter(cp => cp !== 0xFE0F);
  return cps.map(cp => 'u' + cp.toString(16)).join('_');
}
async function fetchKitchen(a, b) {
  const ca = emojiCode(a), cb = emojiCode(b);
  const pairs = [[ca, cb], [cb, ca]];
  for (const date of KITCHEN_DATES) {
    for (const [x, y] of pairs) {
      const first = x.split('_')[0];
      const url = `https://www.gstatic.com/android/keyboard/emojikitchen/${date}/${first}/${x}_${y}.png`;
      try {
        const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 8000, validateStatus: () => true });
        if (r.status === 200 && r.data?.length) return { buffer: Buffer.from(r.data), url };
      } catch { /* try the next known location */ }
    }
  }
  return null;
}

function audioEffectCmd(name, description, filter) {
  return {
    name, aliases: [], category: 'Media', description,
    use: `.${name} (reply to an audio or voice note)`,
    run: async (ctx) => {
      const m = await mediaOf(ctx).catch(() => null);
      if (!m || m.type !== 'audio') { await ctx.reply('⚠️ Please reply to an audio file or voice note with this command.'); return; }
      const dir = tmpDir();
      try {
        const inp = path.join(dir, 'in.bin');
        const out = path.join(dir, 'out.mp3');
        fs.writeFileSync(inp, m.buffer);
        await runFfmpeg(['-y', '-i', inp, '-af', filter, '-vn', out]);
        await ctx.sock.sendMessage(ctx.jid, { audio: fs.readFileSync(out), mimetype: 'audio/mpeg', fileName: `${name}.mp3` }, { quoted: ctx.msg });
      } catch { await ctx.reply(FAIL); }
      finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
    },
  };
}

module.exports = [
  {
    name: 'sticker', aliases: ['s'], category: 'Media',
    description: 'Turn a photo or short video into a sticker (PRIME MD pack).',
    use: '.sticker (send or reply to an image/video)',
    run: async (ctx) => {
      const m = await mediaOf(ctx).catch(() => null);
      if (!m || !['image', 'video'].includes(m.type)) { await ctx.reply('⚠️ Please send a photo or short video, or reply to one, with .sticker'); return; }
      try {
        const sticker = m.type === 'image' ? await stickerLib.imageToSticker(m.buffer) : await stickerLib.videoToSticker(m.buffer);
        await ctx.sock.sendMessage(ctx.jid, { sticker }, { quoted: ctx.msg });
      } catch { await ctx.reply(FAIL); }
    },
  },
  {
    name: 'toimg', aliases: [], category: 'Media',
    description: 'Convert a sticker back into an image.',
    use: '.toimg (reply to a sticker)',
    run: async (ctx) => {
      const m = await mediaOf(ctx).catch(() => null);
      if (!m || m.type !== 'sticker') { await ctx.reply('⚠️ Please reply to a sticker with .toimg'); return; }
      try {
        const png = await sharp(m.buffer).png().toBuffer();
        await ctx.sock.sendMessage(ctx.jid, { image: png, caption: '✅ Sticker converted to image.' }, { quoted: ctx.msg });
      } catch { await ctx.reply(FAIL); }
    },
  },
  {
    name: 'tomp4', aliases: ['tovideo'], category: 'Media',
    description: 'Convert an animated sticker into an MP4 video.',
    use: '.tomp4 (reply to an animated sticker)',
    run: async (ctx) => {
      const m = await mediaOf(ctx).catch(() => null);
      if (!m || m.type !== 'sticker') { await ctx.reply('⚠️ Please reply to an animated sticker with .tomp4'); return; }
      const dir = tmpDir();
      try {
        const inp = path.join(dir, 'in.webp');
        const out = path.join(dir, 'out.mp4');
        fs.writeFileSync(inp, m.buffer);
        await runFfmpeg(['-y', '-i', inp, '-movflags', 'faststart', '-pix_fmt', 'yuv420p', '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=white', out]);
        await ctx.sock.sendMessage(ctx.jid, { video: fs.readFileSync(out), caption: '✅ Sticker converted to video.', mimetype: 'video/mp4' }, { quoted: ctx.msg });
      } catch { await ctx.reply('⚠️ Sorry, this sticker could not be converted to a video. Static stickers have no motion to convert - try an animated sticker.'); }
      finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
    },
  },
  {
    name: 'emojimix', aliases: [], category: 'Media',
    description: 'Mix two emojis into one sticker (Google Emoji Kitchen). Not every pair exists.',
    use: '.emojimix 😀🤩',
    run: async (ctx) => {
      const emojis = [...(ctx.argText || '')].filter(c => /\p{Extended_Pictographic}/u.test(c) || c.codePointAt(0) === 0x2764);
      // Group variation selectors / ZWJ with their base emoji.
      const parts = (ctx.argText.match(/\p{Extended_Pictographic}\uFE0F?/gu) || []).slice(0, 2);
      const [a, b] = parts.length >= 2 ? parts : emojis.slice(0, 2);
      if (!a || !b) { await ctx.reply('Usage: .emojimix 😀🤩 - give me two emojis to mix.'); return; }
      const found = await fetchKitchen(a, b);
      if (!found) { await ctx.reply(`⚠️ Sorry, the mix of ${a} + ${b} does not exist in Emoji Kitchen. Try another pair.`); return; }
      try {
        const sticker = await stickerLib.imageToSticker(found.buffer);
        await ctx.sock.sendMessage(ctx.jid, { sticker }, { quoted: ctx.msg });
      } catch { await ctx.reply(FAIL); }
    },
  },
  {
    name: 'attp', aliases: [], category: 'Media',
    description: 'Turn text into a colourful sticker (rendered locally, no external API).',
    use: '.attp <text>',
    run: async (ctx) => {
      if (!ctx.argText) { await ctx.reply('Usage: .attp <text>'); return; }
      try {
        const sticker = await stickerLib.textToSticker(ctx.argText);
        await ctx.sock.sendMessage(ctx.jid, { sticker }, { quoted: ctx.msg });
      } catch { await ctx.reply(FAIL); }
    },
  },
  {
    name: 'ttp', aliases: [], category: 'Media',
    description: 'Turn text into a plain sticker (rendered locally).',
    use: '.ttp <text>',
    run: async (ctx) => {
      if (!ctx.argText) { await ctx.reply('Usage: .ttp <text>'); return; }
      try {
        const sticker = await stickerLib.textToSticker(ctx.argText);
        await ctx.sock.sendMessage(ctx.jid, { sticker }, { quoted: ctx.msg });
      } catch { await ctx.reply(FAIL); }
    },
  },
  imageFilterCmd('blur', 'Blur a photo.', '.blur (send or reply to a photo)', s => s.blur(8).png().toBuffer()),
  imageFilterCmd('grayscale', 'Make a photo black and white.', '.grayscale (send or reply to a photo)', s => s.grayscale().png().toBuffer(), ['greyscale']),
  imageFilterCmd('invert', 'Invert the colours of a photo.', '.invert (send or reply to a photo)', s => s.negate().png().toBuffer()),
  imageFilterCmd('sepia', 'Give a photo a warm sepia tone.', '.sepia (send or reply to a photo)', s => s.modulate({ saturation: 0.45, brightness: 1.05 }).tint({ r: 112, g: 66, b: 20 }).png().toBuffer()),
  {
    name: 'rotate', aliases: [], category: 'Media',
    description: 'Rotate a photo by 90 degrees, or by a given angle.',
    use: '.rotate [degrees] (send or reply to a photo)',
    run: async (ctx) => {
      const m = await imageOf(ctx);
      if (!m) { await ctx.reply(NO_MEDIA); return; }
      const deg = parseInt(ctx.args[0], 10);
      const angle = Number.isNaN(deg) ? 90 : ((deg % 360) + 360) % 360;
      try {
        const out = await sharp(m.buffer).rotate(angle).png().toBuffer();
        await ctx.sock.sendMessage(ctx.jid, { image: out, caption: `✅ Rotated by ${angle}°.` }, { quoted: ctx.msg });
      } catch { await ctx.reply(FAIL); }
    },
  },
  imageFilterCmd('flipimg', 'Flip a photo upside down.', '.flipimg (send or reply to a photo)', s => s.flip().png().toBuffer()),
  imageFilterCmd('crop', 'Crop a photo into a centred square.', '.crop (send or reply to a photo)', async (s) => {
    const meta = await s.metadata();
    const side = Math.min(meta.width || 0, meta.height || 0);
    return s.extract({ left: Math.floor(((meta.width || side) - side) / 2), top: Math.floor(((meta.height || side) - side) / 2), width: side, height: side }).png().toBuffer();
  }),
  {
    name: 'enlarge', aliases: ['hdimg'], category: 'Media',
    description: 'Upscale a photo to 2x its size.',
    use: '.enlarge (send or reply to a photo)',
    run: async (ctx) => {
      const m = await imageOf(ctx);
      if (!m) { await ctx.reply(NO_MEDIA); return; }
      try {
        const meta = await sharp(m.buffer).metadata();
        const out = await sharp(m.buffer).resize(Math.min((meta.width || 512) * 2, 4096)).png().toBuffer();
        await ctx.sock.sendMessage(ctx.jid, { image: out, caption: '✅ Photo enlarged to 2x.' }, { quoted: ctx.msg });
      } catch { await ctx.reply(FAIL); }
    },
  },
  {
    name: 'compress', aliases: [], category: 'Media',
    description: 'Compress a photo to a much smaller file size.',
    use: '.compress (send or reply to a photo)',
    run: async (ctx) => {
      const m = await imageOf(ctx);
      if (!m) { await ctx.reply(NO_MEDIA); return; }
      try {
        const out = await sharp(m.buffer).jpeg({ quality: 45 }).toBuffer();
        await ctx.sock.sendMessage(ctx.jid, {
          image: out,
          caption: `✅ Compressed: ${(m.buffer.length / 1024).toFixed(0)} KB → ${(out.length / 1024).toFixed(0)} KB`,
        }, { quoted: ctx.msg });
      } catch { await ctx.reply(FAIL); }
    },
  },
  {
    name: 'tourl', aliases: [], category: 'Media',
    description: 'Upload a photo and get a public link for it.',
    use: '.tourl (send or reply to a photo)',
    run: async (ctx) => {
      const m = await imageOf(ctx);
      if (!m) { await ctx.reply(NO_MEDIA); return; }
      const file = tmpPath('.png');
      try {
        fs.writeFileSync(file, m.buffer);
        const FormData = require('form-data');
        // Catbox first, then its temporary sister service Litterbox.
        for (const endpoint of ['https://catbox.moe/user/api.php', 'https://litterbox.catbox.moe/resources/internals/api.php']) {
          try {
            const form = new FormData();
            form.append('reqtype', 'fileupload');
            if (endpoint.includes('litterbox')) form.append('time', '72h');
            form.append('fileToUpload', fs.createReadStream(file), { filename: 'prime-md.png' });
            const r = await axios.post(endpoint, form, { headers: form.getHeaders(), timeout: 60000, validateStatus: () => true });
            const url = String(r.data || '').trim();
            if (/^https:\/\/\S+$/.test(url)) { await ctx.reply(`🔗 Your image link:\n${url}`); return; }
          } catch { /* try the next host */ }
        }
        await ctx.reply('⚠️ Sorry, the upload hosts did not answer right now. Please try again later.');
      } catch { await ctx.reply(FAIL); }
      finally { cleanup(file); }
    },
  },
  audioEffectCmd('bass', 'Boost the bass of an audio file or voice note.', 'bass=g=15'),
  audioEffectCmd('slow', 'Slow an audio file down.', 'atempo=0.65'),
  audioEffectCmd('fast', 'Speed an audio file up.', 'atempo=1.5'),
  audioEffectCmd('reverse', 'Play an audio file in reverse.', 'areverse'),
  audioEffectCmd('nightcore', 'Nightcore effect: faster and higher pitched.', 'asetrate=44100*1.25,aresample=44100,atempo=1.06'),
];

module.exports._fetchKitchen = fetchKitchen;
module.exports._emojiCode = emojiCode;
