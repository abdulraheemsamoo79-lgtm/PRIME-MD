// Sticker helpers: convert an image/video buffer to a WhatsApp webp
// sticker and embed the pack exif (pack name + author) directly in the
// RIFF container, so no external service or extra dependency is needed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { runFfmpeg } = require('./wamedia');
const config = require('../config');

const PACK_NAME = config.BOT_NAME;
const PACK_AUTHOR = 'AR PRIME';

// Build the sticker exif payload WhatsApp reads (JSON behind a 22-byte
// little-endian TIFF-style header, as used by sticker makers).
function buildExif(packName = PACK_NAME, author = PACK_AUTHOR) {
  const json = Buffer.from(JSON.stringify({
    'sticker-pack-id': 'prime-md',
    'sticker-pack-name': packName,
    'sticker-pack-publisher': author,
    emojis: [],
  }), 'utf8');
  const header = Buffer.from([
    0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x41, 0x57, 0x07, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
  ]);
  const len = Buffer.alloc(4);
  len.writeUInt32LE(json.length, 0);
  header.writeUInt32LE(json.length, 14);
  return Buffer.concat([header, len.subarray(0, 0), json].filter(b => b.length));
}

// Insert (or replace) an EXIF chunk in a WebP RIFF buffer.
function insertExif(webp, exif) {
  if (webp.subarray(0, 4).toString() !== 'RIFF' || webp.subarray(8, 12).toString() !== 'WEBP') {
    throw new Error('not a webp buffer');
  }
  // Walk chunks; drop any existing EXIF, keep the rest.
  const chunks = [];
  let offset = 12;
  while (offset + 8 <= webp.length) {
    const type = webp.subarray(offset, offset + 4).toString();
    const size = webp.readUInt32LE(offset + 4);
    const total = 8 + size + (size % 2);
    if (type !== 'EXIF') chunks.push(webp.subarray(offset, offset + total));
    offset += total;
  }
  const exifChunk = Buffer.alloc(8 + exif.length + (exif.length % 2));
  exifChunk.write('EXIF', 0);
  exifChunk.writeUInt32LE(exif.length, 4);
  exif.copy(exifChunk, 8);
  const body = Buffer.concat([Buffer.from('WEBP'), ...chunks, exifChunk]);
  const out = Buffer.alloc(8 + body.length);
  out.write('RIFF', 0);
  out.writeUInt32LE(body.length, 4);
  body.copy(out, 8);
  return out;
}

async function imageToSticker(buffer) {
  const webp = await sharp(buffer, { animated: true })
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 90 })
    .toBuffer();
  return insertExif(webp, buildExif());
}

async function videoToSticker(buffer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prime-stk-'));
  try {
    const inp = path.join(dir, 'in.bin');
    const out = path.join(dir, 'out.webp');
    fs.writeFileSync(inp, buffer);
    await runFfmpeg(['-y', '-i', inp, '-t', '8', '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,fps=12,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,format=rgba', '-loop', '0', '-an', '-vsync', '0', out]);
    const webp = fs.readFileSync(out);
    return insertExif(webp, buildExif());
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

// Render text to a sticker via an SVG card (sharp rasterises SVG locally -
// no external attp API involved).
function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
async function textToSticker(text) {
  const clean = String(text || '').trim().slice(0, 60);
  if (!clean) throw new Error('empty text');
  const words = clean.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > 12) { if (line) lines.push(line); line = w; }
    else line = (line + ' ' + w).trim();
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, 4);
  const fontSize = shown.some(l => l.length > 9) ? 64 : 84;
  const tspans = shown.map((l, i) => `<tspan x="256" dy="${i === 0 ? 0 : fontSize * 1.15}">${escapeXml(l)}</tspan>`).join('');
  const startY = 256 - ((shown.length - 1) * fontSize * 1.15) / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
  <rect width="512" height="512" rx="48" fill="#2a0a4a"/>
  <text y="${startY}" font-family="DejaVu Sans, sans-serif" font-size="${fontSize}" font-weight="bold" fill="#ffffff" stroke="#8b2fc9" stroke-width="2" text-anchor="middle">${tspans}</text>
</svg>`;
  const webp = await sharp(Buffer.from(svg)).webp({ quality: 92 }).toBuffer();
  return insertExif(webp, buildExif());
}

module.exports = { buildExif, insertExif, imageToSticker, videoToSticker, textToSticker, PACK_NAME, PACK_AUTHOR };
