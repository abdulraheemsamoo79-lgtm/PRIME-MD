// Internet Archive movie download support for .moviedl.
// Search:  GET archive.org/advancedsearch.php (mediatype:movies, downloads desc)
// Files:   GET archive.org/metadata/<identifier>
// Download URL: https://archive.org/download/<identifier>/<file name>
// Pending picks live in memory per session+user and expire after 5 minutes.
// fetchJson / streamDownload are injectable for the offline harness.
const fs = require('fs');
const config = require('../config');
const { getJson, downloadToTmp } = require('./net');

const PICK_TTL_MS = 5 * 60 * 1000;
const pending = new Map(); // `${session}|${userJid}` -> { items, ts }
const pickKey = (session, userJid) => `${session}|${userJid}`;

function setPending(session, userJid, items) { pending.set(pickKey(session, userJid), { items, ts: Date.now() }); }
function getPending(session, userJid) {
  const p = pending.get(pickKey(session, userJid));
  if (!p) return null;
  if (Date.now() - p.ts > PICK_TTL_MS) { pending.delete(pickKey(session, userJid)); return null; }
  return p;
}
function clearPending(session, userJid) { pending.delete(pickKey(session, userJid)); }

let fetchJson = (url) => getJson(url, 30000);
let streamDownload = (url, opts) => downloadToTmp(url, opts);
function _setFetchJson(fn) { fetchJson = fn; }
function _setStreamDownload(fn) { streamDownload = fn; }

async function searchMovies(query) {
  const q = `mediatype:movies AND (title:(${query}) OR creator:(${query}))`;
  const url = 'https://archive.org/advancedsearch.php?q=' + encodeURIComponent(q) +
    '&fl[]=identifier&fl[]=title&fl[]=downloads&sort[]=downloads+desc&rows=5&page=1&output=json';
  const j = await fetchJson(url);
  const docs = j?.response?.docs || [];
  return docs.filter(d => d.identifier).map(d => ({
    identifier: d.identifier,
    title: d.title || d.identifier,
    downloads: d.downloads || 0,
  }));
}

const VIDEO_EXT = /\.(mp4|mkv|avi|mov|m4v)$/i;
const BAD_NAME = /sample|trailer|thumb|\.thumbs|_preview|trailer\./i;

// Pick the best playable file: ORIGINAL MP4 first, then any original video,
// then the largest derivative MP4 - always under the cap, never a
// sample/trailer/thumbnail. Returns { name, size, url } or null.
function pickBestFile(identifier, files, maxBytes = config.MOVIE_MAX_BYTES) {
  const candidates = (files || []).filter(f => {
    if (!f.name || f.name.includes('/')) return false; // skip thumbs/subdirs
    if (!VIDEO_EXT.test(f.name) || BAD_NAME.test(f.name)) return false;
    const size = Number(f.size || 0);
    if (!size || size > maxBytes || size < 5 * 1024 * 1024) return false;
    return true;
  });
  if (!candidates.length) return null;
  const score = (f) => {
    let s = 0;
    if (f.source === 'original') s += 4;
    if (/\.mp4$/i.test(f.name)) s += 2;
    if (/h\.?264|mpeg4/i.test(f.format || '')) s += 1;
    return s;
  };
  candidates.sort((a, b) => score(b) - score(a) || Number(b.size) - Number(a.size));
  const best = candidates[0];
  return {
    name: best.name,
    size: Number(best.size),
    format: best.format || '',
    source: best.source || '',
    url: `https://archive.org/download/${identifier}/${encodeURIComponent(best.name)}`,
  };
}

async function getBestFile(identifier) {
  const j = await fetchJson(`https://archive.org/metadata/${encodeURIComponent(identifier)}`);
  const files = j?.files || [];
  return pickBestFile(identifier, files);
}

module.exports = {
  searchMovies, getBestFile, pickBestFile, setPending, getPending, clearPending,
  streamDownload: (...a) => streamDownload(...a), _setFetchJson, _setStreamDownload, PICK_TTL_MS,
};
