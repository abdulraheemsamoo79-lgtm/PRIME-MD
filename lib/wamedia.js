// WhatsApp media helpers: unwrap nested message wrappers (ephemeral,
// view-once V1/V2/extension), find the media node inside a message, and
// download it. The downloader is injectable so the offline harness can stub
// it; in production it is Baileys' downloadContentFromMessage.
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const WRAPPERS = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension'];
const MEDIA_TYPES = { imageMessage: 'image', videoMessage: 'video', audioMessage: 'audio', stickerMessage: 'sticker', documentMessage: 'document' };

// Peel wrappers until we reach a message node holding real content.
function unwrapMessage(message) {
  let node = message || {};
  for (let depth = 0; depth < 6; depth++) {
    const wrapKey = WRAPPERS.find(k => node[k] && node[k].message);
    if (!wrapKey) break;
    node = node[wrapKey].message;
  }
  return node;
}

// Returns { type: 'image'|'video'|'audio'|'sticker'|'document', content } or null.
function findMedia(message) {
  const node = unwrapMessage(message);
  for (const [key, type] of Object.entries(MEDIA_TYPES)) {
    if (node[key]) return { type, content: node[key], node };
  }
  return null;
}

function isViewOnce(message) {
  let node = message || {};
  for (let depth = 0; depth < 6; depth++) {
    if (node.viewOnceMessage || node.viewOnceMessageV2 || node.viewOnceMessageV2Extension) return true;
    const media = findMedia(node);
    if (media && media.content && media.content.viewOnce) return true;
    const wrapKey = WRAPPERS.find(k => node[k] && node[k].message);
    if (!wrapKey) break;
    node = node[wrapKey].message;
  }
  return false;
}

let downloader = async (content, type) => {
  const stream = await downloadContentFromMessage(content, type);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
};
async function downloadMedia(content, type) { return downloader(content, type); }
function _setDownloader(fn) { downloader = fn; }

// Convert an audio file to a proper WhatsApp voice note (ogg/opus, mono).
function toOpusVoice(inFile, outFile) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, ['-y', '-i', inFile, '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '32k', outFile]);
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', code => (code === 0 ? resolve(outFile) : reject(new Error('opus convert failed: ' + err.slice(-200)))));
  });
}

// Read a media file's duration in seconds using ffmpeg's own banner output
// (ffmpeg-static ships no ffprobe). Returns 0 when unknown.
function probeDuration(file) {
  return new Promise((resolve) => {
    const p = spawn(ffmpegPath, ['-hide_banner', '-i', file]);
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('error', () => resolve(0));
    p.on('close', () => {
      const m = err.match(/Duration: (\d+):(\d+):([\d.]+)/);
      resolve(m ? (parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3])) : 0);
    });
  });
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args);
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', code => (code === 0 ? resolve() : reject(new Error('ffmpeg exit ' + code + ': ' + err.slice(-200)))));
  });
}

module.exports = { unwrapMessage, findMedia, isViewOnce, downloadMedia, _setDownloader, toOpusVoice, probeDuration, runFfmpeg, ffmpegPath };
