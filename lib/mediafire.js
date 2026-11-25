// MediaFire direct-link extraction for .mediafire.
// MediaFire no longer puts the direct link on the first page a bare fetch
// sees: the file URL first redirects to a check page AND sets session
// cookies - only a follow-up request carrying those cookies gets the page
// variant whose Download button holds the real download*.mediafire.com
// link. So the page fetch walks redirects manually with a small cookie
// jar and chains Referer like a browser (the same walk the user's own
// API handler documents; from some networks MediaFire answers with a
// Cloudflare "Just a moment" wall instead, which is reported honestly).
// The page fetcher is injectable for the offline harness.
const axios = require('axios');

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function isMediaFireUrl(s) {
  try { const h = new URL(String(s || '')).hostname; return h === 'mediafire.com' || h.endsWith('.mediafire.com'); }
  catch { return false; }
}

// Pull the direct download link out of a file page's HTML.
function extractFromHtml(html) {
  const s = String(html || '');
  let m = s.match(/id="downloadButton"[^>]*href="([^"]+)"/i) || s.match(/href="([^"]+)"[^>]*id="downloadButton"/i);
  if (!m) m = s.match(/href="(https?:\/\/download\d*\.mediafire\.com\/[^"]+)"/i);
  if (!m) return null;
  const url = m[1].replace(/&amp;/g, '&');
  let fileName = '';
  // MediaFire writes spaces as '+' in the download URL path.
  try { fileName = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '').replace(/\+/g, ' '); } catch {}
  if (!fileName) {
    const t = s.match(/<title>([^<]+)<\/title>/i);
    if (t) fileName = t[1].replace(/\s*-\s*MediaFire.*$/i, '').trim();
  }
  return { url, fileName };
}

function isChallengePage(html) { return /just a moment|challenges\.cloudflare\.com|cf-challenge/i.test(String(html || '')); }

// Default page fetcher: manual redirect walk with a cookie jar.
async function fetchPage(startUrl) {
  const jar = new Map();
  let current = startUrl;
  let referer = null;
  for (let hop = 0; hop < 6; hop++) {
    const headers = {
      'User-Agent': BROWSER_UA,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    };
    if (jar.size) headers.Cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    if (referer) headers.Referer = referer;
    const resp = await axios.get(current, {
      headers, timeout: 25000, maxRedirects: 0, validateStatus: () => true, responseType: 'text',
    });
    const setCookie = resp.headers['set-cookie'] || [];
    for (const line of Array.isArray(setCookie) ? setCookie : [setCookie]) {
      const pair = String(line).split(';')[0];
      const eq = pair.indexOf('=');
      if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    if (resp.status >= 300 && resp.status < 400 && resp.headers.location) {
      referer = current;
      current = new URL(resp.headers.location, current).toString();
      continue;
    }
    return String(resp.data || '');
  }
  return '';
}

let fetchPageFn = fetchPage;
function _setFetchPage(fn) { fetchPageFn = fn; }

// Resolve a MediaFire file page URL to { url, fileName }.
// Throws Error('blocked') on a protection wall, Error('not_found') when
// the page carries no download link (dead/removed/private file).
async function resolveMediafire(fileUrl) {
  const html = await fetchPageFn(fileUrl);
  if (isChallengePage(html)) throw new Error('blocked');
  const found = extractFromHtml(html);
  if (!found) throw new Error('not_found');
  return found;
}

module.exports = { isMediaFireUrl, extractFromHtml, isChallengePage, fetchPage, resolveMediafire, _setFetchPage };
