// Bounded per-session store of recently arrived messages. Antidelete and
// antiedit can only work if the original message was captured when it
// ARRIVED, so index.js feeds every incoming message through put().
// Keyed by session + message id; the stored chat JID travels with the
// entry, so a lookup can only return a message from its own session.
const MAX_PER_SESSION = 300;
const TTL_MS = 24 * 60 * 60 * 1000;

const store = new Map(); // session -> Map(msgId -> entry)

function extractText(message) {
  const m = message || {};
  return (m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption ||
    m.videoMessage?.caption || m.documentMessage?.caption || '').trim();
}

function pruneSession(map, now = Date.now()) {
  for (const [id, e] of map) if (now - e.ts > TTL_MS) map.delete(id);
  while (map.size > MAX_PER_SESSION) map.delete(map.keys().next().value); // oldest first
}

function put(sessionNumber, msg) {
  try {
    if (!msg?.message || !msg.key?.id || !msg.key?.remoteJid) return null;
    // Protocol messages (revokes/edits) are events, not content - skip them.
    if (msg.message.protocolMessage) return null;
    let map = store.get(sessionNumber);
    if (!map) { map = new Map(); store.set(sessionNumber, map); }
    const entry = {
      id: msg.key.id,
      chatJid: msg.key.remoteJid,
      participant: msg.key.participant || null,
      fromMe: !!msg.key.fromMe,
      senderNumber: (msg.key.participant || msg.key.remoteJid).split('@')[0].split(':')[0],
      pushName: msg.pushName || '',
      text: extractText(msg.message),
      message: msg.message,
      ts: Date.now(),
    };
    map.set(entry.id, entry);
    pruneSession(map);
    return entry;
  } catch { return null; }
}

function get(sessionNumber, msgId) {
  const map = store.get(sessionNumber);
  if (!map || !msgId) return null;
  pruneSession(map);
  return map.get(msgId) || null;
}

function remove(sessionNumber, msgId) {
  const map = store.get(sessionNumber);
  if (map) map.delete(msgId);
}

function size(sessionNumber) {
  const map = store.get(sessionNumber);
  return map ? map.size : 0;
}
function _clear() { store.clear(); }

module.exports = { put, get, remove, size, _clear, extractText };
