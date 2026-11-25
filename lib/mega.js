// Mega download support for .mega, built on the megajs package.
// A Mega file link carries its decryption key in the URL fragment
// (the /file/<id>#<key> shape, or the old #!<id>!<key> shape); megajs
// parses it, loads the file attributes and streams the decrypted file.
// Folder links are rejected - a folder is not a single file.
const fs = require('fs');
const { File } = require('megajs');

const MEGA_HOST = ['mega', 'nz'].join('.');

function isMegaUrl(s) {
  try { const h = new URL(String(s || '')).hostname; return h === MEGA_HOST || h.endsWith('.' + MEGA_HOST); }
  catch { return false; }
}

// Parse + validate a Mega link. Throws Error('not_mega' | 'folder' | 'invalid').
function parseMega(url) {
  const s = String(url || '').trim();
  if (!isMegaUrl(s)) throw new Error('not_mega');
  let file;
  try { file = File.fromURL(s); } catch { throw new Error('invalid'); }
  if (/\/folder\//i.test(s) || file.directory) throw new Error('folder');
  return file;
}

// Load attributes and stream the file to destPath with a hard size cap.
// Returns { name, size }. Throws Error('too_large') past the cap.
async function downloadMega(url, destPath, maxBytes) {
  const file = parseMega(url);
  await file.loadAttributes();
  const name = file.name || 'mega_file';
  const size = Number(file.size || 0);
  if (size && size > maxBytes) throw new Error('too_large');
  await new Promise((resolve, reject) => {
    let seen = 0;
    const src = file.download();
    const out = fs.createWriteStream(destPath);
    src.on('data', (chunk) => {
      seen += chunk.length;
      if (seen > maxBytes) { src.destroy(new Error('too_large')); out.destroy(); reject(new Error('too_large')); }
    });
    src.on('error', reject);
    out.on('error', reject);
    out.on('finish', resolve);
    src.pipe(out);
  });
  return { name, size };
}

module.exports = { parseMega, downloadMega, isMegaUrl };
