// Small network helpers: JSON GETs with timeouts and STREAMED
// file downloads to tmp (large files are never buffered whole in memory).
const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');

const UA = { 'User-Agent': 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 PRIME-MD' };

async function getJson(url, timeoutMs = 30000) {
  const r = await axios.get(url, { timeout: timeoutMs, headers: UA, validateStatus: () => true });
  if (r.status >= 400) throw new Error(`HTTP ${r.status} from ${new URL(url).hostname}`);
  return r.data;
}

function tmpPath(ext = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prime-dl-'));
  return path.join(dir, `file${ext}`);
}
function cleanup(file) {
  try { fs.rmSync(path.dirname(file), { recursive: true, force: true }); } catch {}
}

// Stream a URL to a tmp file. Aborts and deletes if it grows past maxBytes.
// Resolves { file, size, contentType }.
async function downloadToTmp(url, { maxBytes = 100 * 1024 * 1024, ext = '', timeoutMs = 300000 } = {}) {
  const file = tmpPath(ext);
  try {
    const r = await axios.get(url, {
      responseType: 'stream', timeout: timeoutMs, headers: UA, maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 300,
    });
    const declared = parseInt(r.headers['content-length'] || '0', 10);
    if (declared && declared > maxBytes) { r.data.destroy(); throw new Error('too_large'); }
    let size = 0;
    await new Promise((resolve, reject) => {
      const w = fs.createWriteStream(file);
      r.data.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) { r.data.destroy(); w.destroy(); reject(new Error('too_large')); }
      });
      r.data.on('error', reject);
      w.on('error', reject);
      w.on('finish', resolve);
      r.data.pipe(w);
    });
    if (!size) throw new Error('empty_download');
    return { file, size, contentType: r.headers['content-type'] || '' };
  } catch (e) {
    cleanup(file);
    throw e;
  }
}

const fmtMB = (n) => `${(n / (1024 * 1024)).toFixed(1)} MB`;
const safeName = (s, fallback = 'file') => (String(s || '').replace(/[^\w\s-]/g, '').trim().slice(0, 60) || fallback);

module.exports = { getJson, downloadToTmp, tmpPath, cleanup, fmtMB, safeName, UA };
