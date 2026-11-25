// Drama download support for .drama.
// There is NO /api/drama endpoint on the VEXORA API (live-tested
// 2026-11-25: it answers {"status":false,"message":"Endpoint not found:
// /api/drama"}), so .drama follows the proven behaviour of the user's
// VEXORA bot instead:
//   - search YouTube BY NAME ONLY (links are refused),
//   - pick the first episode-length result (15 minutes or longer),
//   - send a (1) DOCUMENT / (2) VIDEO choice card,
//   - ONLY a quote-reply to that card with "1" or "2" counts - a bare
//     number without a quote is never picked up,
//   - option (2) is refused for anything longer than 10 minutes,
//   - the file comes from /api/ytmp4?long=1 (live-verified on a 37-minute
//     drama episode), with the Tioo chain as fallback. A "pair" result
//     (separate video+audio links) is muxed with ffmpeg and always sent
//     as a document, exactly like the proven bot did.
// Search / resolve / stream functions are injectable for the harness.
const config = require('../config');
const { getJson, downloadToTmp } = require('./net');
const yt = require('./youtube');

const PICK_TTL_MS = 5 * 60 * 1000;
const MIN_DRAMA_SECONDS = 900;   // an episode is 15+ minutes
const MAX_INLINE_SECONDS = 600;  // option (2) refuses anything over 10 minutes
const pending = new Map(); // `${session}|${userJid}` -> { stanzaId, jid, video, ts }
const pickKey = (session, userJid) => `${session}|${userJid}`;

function setPending(session, userJid, entry) { pending.set(pickKey(session, userJid), { ...entry, ts: Date.now() }); }
function getPending(session, userJid) {
  const p = pending.get(pickKey(session, userJid));
  if (!p) return null;
  if (Date.now() - p.ts > PICK_TTL_MS) { pending.delete(pickKey(session, userJid)); return null; }
  return p;
}
function clearPending(session, userJid) { pending.delete(pickKey(session, userJid)); }

let searchFn = (q, limit) => yt.searchYouTube(q, limit);
let streamDownload = (url, opts) => downloadToTmp(url, opts);
function _setSearch(fn) { searchFn = fn; }
function _setStreamDownload(fn) { streamDownload = fn; }

// Find the first episode-length video for a drama name.
async function findDrama(name) {
  const hits = await searchFn(name, 10);
  return (hits || []).find(h => (h.durationSeconds || 0) >= MIN_DRAMA_SECONDS) || null;
}

// Resolve a watch URL to a downloadable file. Returns one of:
//   { downloadUrl, title }                - single ready file
//   { pair: true, videoUrl, audioUrl }    - must be muxed, document only
//   null                                  - nothing worked
async function resolveDownload(watchUrl) {
  // Proven drama route first: the API's long-video mode.
  try {
    const j = await getJson(`${config.VEXORA_API_BASE}/api/ytmp4?url=${encodeURIComponent(watchUrl)}&long=1`, 120000);
    const r = j?.result;
    if (j?.status && r?.video_download) {
      if (r.mode === 'pair' && r.audio_download) {
        return { pair: true, videoUrl: r.video_download, audioUrl: r.audio_download, title: r.title || '' };
      }
      return { downloadUrl: r.video_download, title: r.title || '' };
    }
  } catch { /* fall through to the Tioo chain */ }
  try {
    const tioo = await yt.viaTioo(watchUrl, 'video');
    if (tioo?.downloadUrl) return { downloadUrl: tioo.downloadUrl, title: tioo.title || '' };
  } catch { /* fall through */ }
  return null;
}
let resolveFn = resolveDownload;
function _setResolve(fn) { resolveFn = fn; }

module.exports = {
  findDrama, resolveDownload, setPending, getPending, clearPending,
  streamDownload: (...a) => streamDownload(...a),
  resolve: (...a) => resolveFn(...a),
  _setSearch, _setStreamDownload, _setResolve,
  PICK_TTL_MS, MIN_DRAMA_SECONDS, MAX_INLINE_SECONDS,
};
