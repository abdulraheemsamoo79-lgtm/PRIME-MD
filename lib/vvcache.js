// View-once ARRIVAL cache. View-once media can only be captured when it
// ARRIVES (after it is opened it is gone), so index.js feeds every incoming
// message through put(). Entries are keyed by session + chat + message id:
// a lookup can only ever return media from the exact same chat - the
// EXACT-ONLY rule is enforced by the key itself, not by trust.
const config = require('../config');
const { findMedia, isViewOnce } = require('./wamedia');

const store = new Map(); // `${session}|${chatJid}|${msgId}` -> entry
const keyOf = (session, chatJid, msgId) => `${session}|${chatJid}|${msgId}`;

function prune(now = Date.now()) {
  for (const [k, e] of store) if (now - e.ts > config.VV_CACHE_TTL_MS) store.delete(k);
  while (store.size > config.VV_CACHE_MAX_ITEMS) store.delete(store.keys().next().value); // oldest first
}

// Feed an incoming Baileys message. Returns the entry when it was cached.
function put(sessionNumber, msg) {
  try {
    if (!msg?.message || !msg.key?.id || !msg.key?.remoteJid) return null;
    if (!isViewOnce(msg.message)) return null;
    const media = findMedia(msg.message);
    if (!media || !['image', 'video', 'audio'].includes(media.type)) return null;
    const declared = Number(media.content.fileLength || 0);
    if (declared && declared > config.VV_MAX_BYTES) return null; // size cap
    const entry = {
      session: sessionNumber,
      chatJid: msg.key.remoteJid,
      msgId: msg.key.id,
      participant: msg.key.participant || null,
      type: media.type,
      content: media.content,
      ts: Date.now(),
    };
    store.set(keyOf(sessionNumber, entry.chatJid, entry.msgId), entry);
    prune();
    return entry;
  } catch { return null; }
}

function get(sessionNumber, chatJid, msgId) {
  if (!msgId) return null;
  prune();
  return store.get(keyOf(sessionNumber, chatJid, msgId)) || null;
}

// Latest cached view-once in THIS chat only (used when .vv has no quote).
function latest(sessionNumber, chatJid) {
  prune();
  let best = null;
  for (const e of store.values()) {
    if (e.session === sessionNumber && e.chatJid === chatJid && (!best || e.ts > best.ts)) best = e;
  }
  return best;
}

function size() { prune(); return store.size; }
function _clear() { store.clear(); }

module.exports = { put, get, latest, size, _clear };
