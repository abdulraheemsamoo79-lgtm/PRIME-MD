// YouTube resolution + download backends for .video / .song / .ytsearch.
//
// Search: the VEXORA API /api/ytsearch endpoint AND the local yt-search
// package are both currently broken with the same library error
// ("_title3.trim is not a function", live-tested 2026-11-25), so search and
// name->URL resolution use the Invidious search API (live-verified).
//
// Downloads: Tioo FIRST (standing order) - GET {host}/YouTube?url=<yt url>
// returns { status, mp4, mp3, title }. backend2 is primary, backend1 next,
// backend2 once more (its failures are often momentary); backend3 is never
// used (it returns status only, no media). Tioo is KNOWN intermittent.
// Fallback: the user's own VEXORA API /api/ytmp4 and /api/ytmp3.
const config = require('../config');
const { getJson } = require('./net');

const YT_ID = /(?:v=|youtu\.be\/|\/shorts\/|\/live\/)([A-Za-z0-9_-]{11})/;
const isYouTubeUrl = (s) => /youtu\.?be/.test(String(s || '')) && !!YT_ID.test(String(s || ''));
const videoIdOf = (s) => (String(s || '').match(YT_ID) || [])[1] || null;
const watchUrl = (id) => `https://www.youtube.com/watch?v=${id}`;

async function searchYouTube(query, limit = 10) {
  const data = await getJson(`${config.INVIDIOUS_BASE}/api/v1/search?q=${encodeURIComponent(query)}&type=video`, 25000);
  if (!Array.isArray(data)) throw new Error('search_failed');
  return data.filter(v => v.type === 'video' && v.videoId).slice(0, limit).map(v => ({
    title: v.title || '',
    videoId: v.videoId,
    url: watchUrl(v.videoId),
    author: v.author || '',
    duration: v.lengthSeconds ? `${Math.floor(v.lengthSeconds / 60)}:${String(v.lengthSeconds % 60).padStart(2, '0')}` : '',
    durationSeconds: v.lengthSeconds || 0,
    views: v.viewCount || 0,
    thumbnail: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
  }));
}

// Accepts a YouTube URL or plain search text. Returns { url, videoId, title }.
async function resolveYouTube(input) {
  const text = String(input || '').trim();
  if (isYouTubeUrl(text)) return { url: text, videoId: videoIdOf(text), title: '' };
  if (videoIdOf(text) && text.length === 11) return { url: watchUrl(text), videoId: text, title: '' };
  const hits = await searchYouTube(text, 1);
  if (!hits.length) return null;
  return { url: hits[0].url, videoId: hits[0].videoId, title: hits[0].title };
}

async function viaTioo(videoUrl, kind) {
  for (const host of config.TIOO_HOSTS) {
    try {
      const j = await getJson(`${host}/YouTube?url=${encodeURIComponent(videoUrl)}`, 20000);
      const link = kind === 'audio' ? j?.mp3 : j?.mp4;
      if (j?.status && link) return { downloadUrl: link, title: j.title || '' };
    } catch { /* try the next host */ }
  }
  return null;
}

async function viaApi(videoUrl, kind) {
  const ep = kind === 'audio' ? 'ytmp3' : 'ytmp4';
  try {
    const j = await getJson(`${config.VEXORA_API_BASE}/api/${ep}?url=${encodeURIComponent(videoUrl)}`, 90000);
    const link = kind === 'audio' ? j?.result?.audio_download : j?.result?.video_download;
    if (j?.status && link) return { downloadUrl: link, title: j?.result?.title || '' };
    if (j?.message && /too long/i.test(j.message)) return { error: 'too_long' };
  } catch { /* fall through */ }
  return null;
}

// kind: 'video' | 'audio'. Tioo first, VEXORA API second.
async function getYouTubeMedia(input, kind) {
  const resolved = await resolveYouTube(input);
  if (!resolved) return null;
  const tioo = await viaTioo(resolved.url, kind);
  if (tioo) return { ...tioo, title: tioo.title || resolved.title, pageUrl: resolved.url };
  const api = await viaApi(resolved.url, kind);
  if (api && !api.error) return { ...api, title: api.title || resolved.title, pageUrl: resolved.url };
  if (api?.error === 'too_long') return { error: 'too_long', pageUrl: resolved.url };
  return null;
}

module.exports = { isYouTubeUrl, videoIdOf, searchYouTube, resolveYouTube, viaTioo, viaApi, getYouTubeMedia };
