// Per-sender sliding-window limiter for prefix COMMANDS only.
// A sender may run at most MAX_IN_WINDOW commands in any WINDOW_MS
// window, counted across ALL sessions combined (the state lives in
// this module, not per session). Over the limit, commands are silently
// dropped by the caller; at most one polite notice per NOTICE_EVERY_MS
// is offered. The global owner is never limited. Non-command traffic
// never reaches this module, so automations are unaffected.
const config = require('../config');

const WINDOW_MS = 15 * 1000;
const MAX_IN_WINDOW = 12;
const NOTICE_EVERY_MS = 5 * 60 * 1000;

const hits = new Map();       // sender number -> ascending command timestamps
const lastNotice = new Map(); // sender number -> last notice timestamp

function numberOf(jid) {
  return String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
}

// Returns { allowed, notify }: allowed=false means drop the command;
// notify=true (only alongside allowed=false) means one slow-down
// notice may be sent to the user.
function check(senderJid, now = Date.now()) {
  const num = numberOf(senderJid);
  if (!num || num === config.OWNER_NUMBER) return { allowed: true, notify: false };
  let arr = hits.get(num);
  if (!arr) { arr = []; hits.set(num, arr); }
  while (arr.length && now - arr[0] >= WINDOW_MS) arr.shift();
  if (arr.length >= MAX_IN_WINDOW) {
    const notify = now - (lastNotice.get(num) || 0) >= NOTICE_EVERY_MS;
    if (notify) lastNotice.set(num, now);
    return { allowed: false, notify };
  }
  arr.push(now);
  return { allowed: true, notify: false };
}

// Drop stale state so the maps cannot grow without bound.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [num, arr] of hits) {
    while (arr.length && now - arr[0] >= WINDOW_MS) arr.shift();
    if (!arr.length) hits.delete(num);
  }
  for (const [num, t] of lastNotice) if (now - t >= NOTICE_EVERY_MS) lastNotice.delete(num);
}, 10 * 60 * 1000);
if (sweep.unref) sweep.unref();

module.exports = { check, WINDOW_MS, MAX_IN_WINDOW, NOTICE_EVERY_MS, _hits: hits };
