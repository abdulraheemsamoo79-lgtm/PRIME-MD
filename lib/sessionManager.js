// Multi-session manager. One Baileys socket per paired phone number.
// - Sessions are stamped with SERVER_ID; SESSION_LIMIT is enforced.
// - Auto-reconnect with backoff; loggedOut sessions are cleaned up, never
//   reconnected. One session crashing never takes the others down.
// - Pairing: single-flight per number, custom code with silent random
//   fallback, 3-minute pending timeout, welcome DM on first connect, and a
//   one-time identity switch (desktop handshake -> Android session).
const pino = require('pino');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const config = require('../config');
const { useMongoAuthState, listStoredNumbers } = require('./mongoAuthState');
const { getDb } = require('./mongo');
const { pairingBrowser, sessionBrowser } = require('./browserIdentity');
const { PairingService, formatCode } = require('./pairing');

const logger = pino({ level: 'silent' });
const pairing = new PairingService();
const sessions = new Map();          // number -> entry
const identitySwitched = new Set();  // numbers already moved to Android identity in this process
let messageHandler = null;
let eventHandler = null;
let waVersion = null;

function setMessageHandler(fn) { messageHandler = fn; }
// forward socket events (group participants, message
// updates, calls) to a single handler installed by index.js.
function setEventHandler(fn) { eventHandler = fn; }
function count() { return sessions.size; }
function list() {
  return [...sessions.values()].map(e => ({ number: e.number, status: e.status, serverId: config.SERVER_ID, serverName: config.SERVER_NAME, startedAt: e.startedAt }));
}
function getSession(number) { return sessions.get(number) || null; }
function isConnected(number) { const e = sessions.get(number); return !!e && e.status === 'open'; }

async function stampMeta(number) {
  const db = await getDb();
  if (db) await db.collection('sessions_meta').updateOne(
    { _id: number },
    { $set: { serverId: config.SERVER_ID, serverName: config.SERVER_NAME, updatedAt: new Date() } },
    { upsert: true }
  ).catch(() => {});
}
async function removeMeta(number) {
  const db = await getDb();
  if (db) await db.collection('sessions_meta').deleteOne({ _id: number }).catch(() => {});
}

async function followChannels(sock) {
  for (const jid of config.CHANNEL_JIDS) {
    try { if (typeof sock.newsletterFollow === 'function') await sock.newsletterFollow(jid); } catch { /* silent by design */ }
  }
}

function waitReady(entry, timeoutMs = 10000) {
  if (entry.readyDone) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => {
      const i = entry.readyWaiters.indexOf(done);
      if (i >= 0) entry.readyWaiters.splice(i, 1);
      resolve();
    };
    entry.readyWaiters.push(done);
    setTimeout(done, timeoutMs); // proceed anyway after the wait - requestPairingCode queues on the socket
  });
}
function markReady(entry) {
  entry.readyDone = true;
  const waiters = (entry.readyWaiters || []).splice(0);
  waiters.forEach(r => { try { r(); } catch {} });
}

async function startSession(number) {
  const existing = sessions.get(number);
  if (existing && !existing.stopped) return existing;

  const { state, saveCreds, clearState } = await useMongoAuthState(number);
  const registered = !!state.creds.registered;
  const browser = registered ? sessionBrowser : pairingBrowser;
  if (!waVersion) { try { waVersion = (await fetchLatestBaileysVersion()).version; } catch { waVersion = undefined; } }

  const entry = {
    number, sock: null, status: 'connecting', startedAt: Date.now(),
    attempts: 0, stopped: false, pairingTimer: null, readyWaiters: [], readyDone: false,
    usedPairingBrowser: !registered, justPaired: false, clearState,
  };
  sessions.set(number, entry);

  let sock;
  try {
    sock = makeWASocket({
      version: waVersion,
      auth: state,
      browser,
      logger,
      printQRInTerminal: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      getMessage: async () => undefined,
    });
  } catch (e) {
    sessions.delete(number); // never leave a dead entry occupying a slot
    throw e;
  }
  entry.sock = sock;

  sock.ev.on('creds.update', async () => { try { await saveCreds(); } catch (e) { console.error(`[${number}] saveCreds failed:`, e.message); } });

  sock.ev.on('connection.update', async (update) => {
    try {
      const { connection, lastDisconnect } = update;
      if (connection) markReady(entry);
      if (connection === 'open') {
        entry.status = 'open';
        entry.attempts = 0;
        if (entry.pairingTimer) { clearTimeout(entry.pairingTimer); entry.pairingTimer = null; }
        await stampMeta(number);
        followChannels(sock).catch(() => {});
        if (entry.justPaired) {
          entry.justPaired = false;
          try {
            await sock.sendMessage(`${number}@s.whatsapp.net`, {
              text: `✅ *${config.BOT_NAME} is now connected!*\n\nYour number is paired with ${config.BOT_NAME} on ${config.SERVER_NAME}.\nSend *.menu* in any chat to see everything I can do.\n\n© POWERED BY ${config.BOT_NAME}`,
            });
          } catch { /* welcome DM is best-effort */ }
        }
        // Handshake used a desktop identity; a registered session must run
        // on the Android phone identity, so restart this socket once.
        if (entry.usedPairingBrowser && !identitySwitched.has(number)) {
          identitySwitched.add(number);
          setTimeout(() => { restartSession(number).catch(() => {}); }, 2500);
        }
      }
      if (connection === 'close') {
        entry.status = 'closed';
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        if (entry.stopped) return;
        if (statusCode === DisconnectReason.loggedOut) {
          console.log(`[${number}] logged out - cleaning up session`);
          await cleanupSession(number);
          return;
        }
        entry.attempts += 1;
        const delay = Math.min(30000, 2000 * Math.pow(2, Math.min(entry.attempts, 4)));
        console.log(`[${number}] connection closed (${statusCode || 'unknown'}), reconnecting in ${delay}ms`);
        setTimeout(() => { if (!entry.stopped) restartSession(number).catch(() => {}); }, delay);
      }
    } catch (e) { console.error(`[${number}] connection.update error:`, e.message); }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify' || !messageHandler) return;
    for (const msg of messages) {
      try { await messageHandler(number, sock, msg); }
      catch (e) { console.error(`[${number}] message handler error:`, e.message); }
    }
  });

  // event forwarding for automation hooks.
  const forward = (event) => (payload) => {
    if (!eventHandler) return;
    Promise.resolve(eventHandler(number, sock, event, payload)).catch(e => console.error(`[${number}] event handler error:`, e.message));
  };
  sock.ev.on('group-participants.update', forward('group-participants.update'));
  sock.ev.on('messages.update', forward('messages.update'));
  sock.ev.on('call', forward('call'));

  return entry;
}

async function restartSession(number) {
  const old = sessions.get(number);
  if (old) {
    old.stopped = true;
    if (old.pairingTimer) clearTimeout(old.pairingTimer);
    try { old.sock.end(undefined); } catch {}
    sessions.delete(number);
  }
  return startSession(number);
}

async function stopSession(number) {
  const entry = sessions.get(number);
  if (!entry) return false;
  entry.stopped = true;
  if (entry.pairingTimer) clearTimeout(entry.pairingTimer);
  try { entry.sock.end(undefined); } catch {}
  sessions.delete(number);
  return true;
}

async function cleanupSession(number) {
  const entry = sessions.get(number);
  await stopSession(number);
  if (entry && entry.clearState) { try { await entry.clearState(); } catch {} }
  else {
    // Auth was created outside a live entry (rare) - rebuild just to clear it.
    try { const a = await useMongoAuthState(number); await a.clearState(); } catch {}
  }
  await removeMeta(number);
}

// The one pairing entry point used by /api/code and the .pair command.
// Always resolves to a shaped result; never throws to the caller.
async function requestCode(number, ip) {
  try {
    if (isConnected(number)) {
      const e = sessions.get(number);
      if (e.sock?.authState?.creds?.registered) {
        return { ok: true, status: 'already_paired', message: 'This number is already paired with PRIME MD. Send .menu on WhatsApp to start using the bot.' };
      }
    }
    // A request already in flight for this number is shared, not duplicated
    // and not rate-limited - it IS the same request.
    if (!pairing.hasPending(number)) {
      const limited = pairing.checkRate(number, ip);
      if (limited) return { ok: false, status: 'rate_limited', retryAfterSec: limited.retryAfterSec, message: limited.message };
      if (!sessions.has(number) && sessions.size >= config.SESSION_LIMIT) {
        return { ok: false, status: 'server_full', message: `${config.SERVER_NAME} is full right now (${config.SESSION_LIMIT} users). Please try again later.` };
      }
      pairing.recordRequest(number, ip);
    }
    const result = await pairing.singleFlight(number, async () => {
      const entry = await startSession(number);
      entry.justPaired = true;
      await waitReady(entry);
      if (entry.sock?.authState?.creds?.registered) {
        return { ok: true, status: 'already_paired', message: 'This number is already paired with PRIME MD. Send .menu on WhatsApp to start using the bot.' };
      }
      let code;
      try {
        code = await entry.sock.requestPairingCode(number, config.PAIR_CODE); // custom code first
      } catch (customErr) {
        console.log(`[${number}] custom pair code not accepted, falling back to a random code`);
        code = await entry.sock.requestPairingCode(number); // silent fallback, same session attempt
      }
      // Keep the half-created session alive for the pairing window only.
      if (entry.pairingTimer) clearTimeout(entry.pairingTimer);
      entry.pairingTimer = setTimeout(async () => {
        const cur = sessions.get(number);
        if (cur && cur.status !== 'open') { console.log(`[${number}] pairing window expired - cleaning up`); await cleanupSession(number); }
      }, config.PAIRING_TIMEOUT_MS);
      return { ok: true, status: 'code_ready', code: formatCode(code), message: 'Enter this code in WhatsApp within the next few minutes: Linked devices > Link with phone number.' };
    });
    return result;
  } catch (e) {
    console.error(`[${number}] pairing failed:`, e.message);
    return { ok: false, status: 'try_again', message: 'Pairing could not be started right now. Please wait a moment and try again.' };
  }
}

async function restoreSessions() {
  try {
    const numbers = await listStoredNumbers(config.SERVER_ID);
    const todo = numbers.slice(0, config.SESSION_LIMIT);
    console.log(`[restore] ${todo.length} stored session(s) on ${config.SERVER_NAME}`);
    for (const n of todo) {
      startSession(n).catch(e => console.error(`[restore] ${n} failed:`, e.message));
      await new Promise(r => setTimeout(r, 500)); // stagger boots
    }
  } catch (e) { console.error('[restore] failed:', e.message); }
}

module.exports = {
  setMessageHandler, setEventHandler, startSession, stopSession, cleanupSession, restartSession,
  requestCode, restoreSessions, count, list, getSession, isConnected, pairing, formatCode,
};
