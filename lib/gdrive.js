// Google Drive direct download support for .gdrive.
// Works for "anyone with the link" files. The classic flow:
//   GET drive.google.com/uc?export=download&id=<ID>
// Small files download straight away. Large files first answer with an
// HTML confirmation page whose download form (or "Download anyway" link)
// points at the real file; this module parses that form and builds the
// confirmed URL. Private files and quota pages are detected and reported
// honestly instead of saving an HTML error page as the "file".
// The raw fetcher is injectable for the offline harness.
const axios = require('axios');
const { UA } = require('./net');

// Extract a Drive file ID from the common link shapes. Folder links are
// rejected (a folder is not a file). Returns null when no ID is found.
function extractId(url) {
  const s = String(url || '');
  if (/\/folders\//.test(s)) return null;
  let m = s.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = s.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  return null;
}

const ucUrl = (id) => `https://drive.google.com/uc?export=download&id=${id}`;
const userContentUrl = (id) => `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;

// Parse the large-file confirmation page. Returns the confirmed download
// URL or null when the page carries no confirmation form/link.
function parseConfirm(html, id) {
  const s = String(html || '');
  // Modern form: <form id="download-form" action="https://drive.usercontent.google.com/download" method="get"> + hidden inputs
  const form = s.match(/<form[^>]*id="download-form"[^>]*action="([^"]+)"[^>]*>([\s\S]*?)<\/form>/i);
  if (form) {
    const action = form[1].replace(/&amp;/g, '&');
    const inputs = {};
    for (const im of form[2].matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"/gi)) inputs[im[1]] = im[2];
    if (inputs.id || id) {
      const qs = new URLSearchParams({ id: inputs.id || id, export: inputs.export || 'download', confirm: inputs.confirm || 't' });
      if (inputs.uuid) qs.set('uuid', inputs.uuid);
      return `${action}?${qs.toString()}`;
    }
  }
  // Legacy link: /uc?export=download&confirm=<token>&id=<ID>
  const link = s.match(/href="(\/uc\?export=download[^"]*confirm=[^"]+)"/i);
  if (link) return 'https://drive.google.com' + link[1].replace(/&amp;/g, '&');
  return null;
}

function pageProblem(html) {
  const s = String(html || '');
  if (/too many users have viewed|download quota|quota exceeded/i.test(s)) return 'quota';
  if (/you need access|request access|sign in|accounts\.google\.com/i.test(s) && !parseConfirm(s, '')) return 'private';
  return null;
}

function nameFromDisposition(disp) {
  const m = String(disp || '').match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  if (!m) return '';
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

// Raw probe fetch: returns { status, contentType, disposition, text }.
async function defaultFetchRaw(url) {
  const r = await axios.get(url, {
    timeout: 30000, headers: UA, maxRedirects: 5, validateStatus: () => true, responseType: 'text',
  });
  return {
    status: r.status,
    contentType: r.headers['content-type'] || '',
    disposition: r.headers['content-disposition'] || '',
    text: typeof r.data === 'string' ? r.data : '',
  };
}
let fetchRawFn = defaultFetchRaw;
function _setFetchRaw(fn) { fetchRawFn = fn; }

// Resolve a file ID to a ready download URL.
// Returns { downloadUrl, fileName } or throws Error('private'|'quota'|'not_found').
async function resolveGdrive(id) {
  const first = await fetchRawFn(ucUrl(id));
  if (first.status >= 400) throw new Error('not_found');
  if (!/text\/html/i.test(first.contentType)) {
    return { downloadUrl: ucUrl(id), fileName: nameFromDisposition(first.disposition) };
  }
  const problem = pageProblem(first.text);
  if (problem) throw new Error(problem);
  const confirmed = parseConfirm(first.text, id);
  if (confirmed) {
    let fileName = '';
    const t = String(first.text).match(/<meta property="og:title" content="([^"]+)"/i);
    if (t) fileName = t[1].replace(/&amp;/g, '&').trim();
    return { downloadUrl: confirmed, fileName };
  }
  // No form on the page: the usercontent confirm URL is the documented
  // fallback route; the caller verifies the downloaded content type.
  return { downloadUrl: userContentUrl(id), fileName: '' };
}

module.exports = { extractId, ucUrl, userContentUrl, parseConfirm, pageProblem, resolveGdrive, _setFetchRaw };
