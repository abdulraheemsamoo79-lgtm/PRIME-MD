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
const wanted = new Set();            // numbers that SHOULD stay connected - once paired, the bot keeps the session alive (VORTEX-style); removed only on logout/ban
const retryTimers = new Map();       // number -> pending restart-retry timer
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

// One-time welcome, tracked in sessions_meta (Mongo) or a flag file in the
// session folder (file fallback). Sent by the FINAL session only - never by
// the pairing-handshake socket, whose connection is replaced seconds later
// (that race is why the first version's welcome often never arrived).
const fs = require('fs');
const path = require('path');
async function wasWelcomed(number) {
  const db = await getDb();
  if (db) {
    const doc = await db.collection('sessions_meta').findOne({ _id: number }).catch(() => null);
    return !!(doc && doc.welcomed);
  }
  return fs.existsSync(path.join(__dirname, '..', 'sessions', number, 'welcomed.flag'));
}
async function markWelcomed(number) {
  const db = await getDb();
  if (db) await db.collection('sessions_meta').updateOne({ _id: number }, { $set: { welcomed: true, welcomedAt: new Date() } }, { upsert: true }).catch(() => {});
  else {
    const dir = path.join(__dirname, '..', 'sessions', number);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'welcomed.flag'), '1');
  }
}
async function maybeSendWelcome(number, sock) {
  try {
    if (await wasWelcomed(number)) return;
    const jid = `${number}@s.whatsapp.net`;
    const text = `👑 *Welcome to ${config.BOT_NAME}* 👑\n\n✅ Your number is now connected on *${config.SERVER_NAME}*.\n\nSend *.menu* in any chat to see all 169 commands — downloads, AI, view-once saver, HD status, group tools and much more.\n\n⚡ Fast • Secure • Stable • Premium ⚡\n\n© POWERED BY ${config.BOT_NAME}`;
    const logoPath = path.join(__dirname, '..', 'assets', 'logo.png');
    let sent = false;
    if (fs.existsSync(logoPath)) {
      try { await sock.sendMessage(jid, { image: fs.readFileSync(logoPath), caption: text }); sent = true; } catch { /* fall back to text */ }
    }
    if (!sent) await sock.sendMessage(jid, { text });
    await markWelcomed(number);
    console.log(`[${number}] welcome message sent`);
  } catch (e) { console.error(`[${number}] welcome failed:`, e.message); }
}

async function followChannels(sock) {
  for (const jid of config.CHANNEL_JIDS) {
    try { if (typeof sock.newsletterFollow === 'function') await sock.newsletterFollow(jid); } catch { /* silent by design */ }
  }
}

// ---------- owner alerts ----------
// The global owner hears about sessions that are truly lost: logged out
// by WhatsApp (gone for good), or down so long that the watchdog's own
// revives keep failing. Alerts go out on any open session (the owner's
// own session preferred); with no session open they land in the log
// instead. Alerting must never break recovery, so every path is guarded
// and nothing here throws.
const ALERT_THROTTLE_MS = 60 * 60 * 1000; // at most one "not reconnecting" alert per number per hour
const DOWN_ALERT_CYCLES = 3;              // watchdog revives without an 'open' before alerting
const downTracker = new Map();            // number -> { cycles, lastAlertAt }

function findAlertSock() {
  const own = sessions.get(config.OWNER_NUMBER);
  if (own && own.status === 'open' && own.sock) return own.sock;
  for (const e of sessions.values()) if (e.status === 'open' && e.sock) return e.sock;
  return null;
}
async function alertOwner(text) {
  try {
    const sock = findAlertSock();
    if (!sock) { console.error('[owner-alert] (no open session to send from) ' + text); return false; }
    await sock.sendMessage(`${config.OWNER_NUMBER}@s.whatsapp.net`, { text });
    console.log('[owner-alert] sent to owner:', text);
    return true;
  } catch (e) { console.error('[owner-alert] send failed:', e.message); return false; }
}
function alertSessionLoggedOut(number) {
  alertOwner(`⚠️ ${config.BOT_NAME} Alert: session ${number} was logged out by WhatsApp and removed. That user must pair again.`).catch(() => {});
}
// One watchdog revive of a still-down wanted session. Returns true when
// this call fired the (throttled) "not reconnecting" alert. The incident
// state resets when the session next reaches 'open' (see startSession).
function noteWatchdogRevive(number, now = Date.now()) {
  let t = downTracker.get(number);
  if (!t) { t = { cycles: 0, lastAlertAt: 0 }; downTracker.set(number, t); }
  t.cycles += 1;
  if (t.cycles >= DOWN_ALERT_CYCLES && now - t.lastAlertAt >= ALERT_THROTTLE_MS) {
    t.lastAlertAt = now;
    alertOwner(`⚠️ ${config.BOT_NAME} Alert: session ${number} is not reconnecting. The watchdog has tried to revive it ${t.cycles} times without success - please check the server when you can.`).catch(() => {});
    return true;
  }
  return false;
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

// The pairing window opens when the server sends its pairing ref (the 'qr'
// field of connection.update) - only then will it accept a
// link_code_companion_reg request. Asking earlier makes the server close
// the connection ("Connection Closed"). Resolves true when the window is
// open, false on timeout or when the socket dies first.
function markPairingWindow(entry) {
  entry.windowOpen = true;
  const waiters = (entry.windowWaiters || []).splice(0);
  waiters.forEach(r => { try { r(true); } catch {} });
}
function waitForPairingWindow(entry, timeoutMs = 20000) {
  if (entry.windowOpen) return Promise.resolve(true);
  return new Promise(resolve => {
    const done = (v) => {
      const i = (entry.windowWaiters || []).indexOf(done);
      if (i >= 0) entry.windowWaiters.splice(i, 1);
      resolve(v);
    };
    (entry.windowWaiters = entry.windowWaiters || []).push(done);
    setTimeout(() => done(!!entry.windowOpen), timeoutMs);
  });
}
function failPairingWindow(entry) {
  const waiters = (entry.windowWaiters || []).splice(0);
  waiters.forEach(r => { try { r(false); } catch {} });
}

async function startSession(number) {
  startWatchdog();
  const existing = sessions.get(number);
  if (existing && !existing.stopped) return existing;

  const { state, saveCreds, clearState } = await useMongoAuthState(number);
  const registered = !!state.creds.registered;
  const browser = registered ? sessionBrowser : pairingBrowser;
  if (!waVersion) { try { waVersion = (await fetchLatestBaileysVersion()).version; } catch { waVersion = undefined; } }

  const entry = {
    number, sock: null, status: 'connecting', startedAt: Date.now(),
    attempts: 0, stopped: false, pairingTimer: null, reconnectTimer: null, readyWaiters: [], readyDone: false,
    windowWaiters: [], windowOpen: false, pairingInFlight: false,
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
      // Same stability options VORTEX MD runs with.
      keepAliveIntervalMs: 10000,
      connectTimeoutMs: 60000,
      retryRequestDelayMs: 5000,
      transactionOpts: { maxCommitRetries: 10, delayBetweenTriesMs: 3000 },
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
      const { connection, lastDisconnect, qr } = update;
      if (connection) markReady(entry);
      if (qr) markPairingWindow(entry);
      if (connection === 'open') {
        entry.status = 'open';
        wanted.add(number); // a live paired session is kept alive from now on
        downTracker.delete(number); // reconnected - any down incident is over
        markPairingWindow(entry);
        entry.attempts = 0;
        if (entry.reconnectTimer) { clearTimeout(entry.reconnectTimer); entry.reconnectTimer = null; }
        if (entry.pairingTimer) { clearTimeout(entry.pairingTimer); entry.pairingTimer = null; }
        await stampMeta(number);
        followChannels(sock).catch(() => {});
        // Handshake used a desktop identity; a registered session must run
        // on the Android phone identity, so restart this socket once.
        if (entry.usedPairingBrowser && !identitySwitched.has(number)) {
          identitySwitched.add(number);
          setTimeout(() => { restartSession(number).catch(() => {}); }, 2500);
        } else {
          // Final-identity session is up: send the one-time welcome here,
          // where the connection is stable (the pairing socket's open is
          // followed by forced restarts, which ate the old welcome).
          maybeSendWelcome(number, sock).catch(() => {});
        }
      }
      if (connection === 'close') {
        entry.status = 'closed';
        failPairingWindow(entry);
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        if (entry.stopped) return;
        if (statusCode === DisconnectReason.loggedOut) {
          const wasWanted = wanted.has(number);
          console.log(`[${number}] logged out - cleaning up session`);
          await cleanupSession(number);
          // A paired session is permanently lost - tell the owner.
          // (Intentional removals via cleanupSession from the admin
          // panel or owner commands do NOT alert; only this WhatsApp
          // logout path does.)
          if (wasWanted) alertSessionLoggedOut(number);
          return;
        }
        // While a pairing request is in flight, the request flow owns
        // recovery (fresh-socket retry). A background restart here would
        // replace the socket mid-request and kill the code request.
        if (entry.pairingInFlight) {
          console.log(`[${number}] connection closed during pairing (${statusCode || 'unknown'}) - pairing flow will retry`);
          return;
        }
        // VORTEX-style flat reconnect timings: 515 restarts immediately,
        // 428 / restartRequired / connectionLost wait 3s, everything else
        // 5s - always reconnect, never give up on a wanted session.
        let delay = 5000;
        if (statusCode === 515) delay = 0;
        else if (statusCode === DisconnectReason.restartRequired || statusCode === DisconnectReason.connectionLost || statusCode === 428) delay = 3000;
        console.log(`[${number}] connection closed (${statusCode || 'unknown'}), reconnecting ${delay === 0 ? 'now' : `in ${delay / 1000}s`}`);
        if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
        entry.reconnectTimer = setTimeout(() => { entry.reconnectTimer = null; if (!entry.stopped) restartSession(number).catch(() => {}); }, delay);
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
    if (old.reconnectTimer) clearTimeout(old.reconnectTimer);
    try { old.sock.end(undefined); } catch {}
    sessions.delete(number);
  }
  try {
    return await startSession(number);
  } catch (e) {
    // VORTEX-style: a failed init retries in 10s instead of losing the
    // session - but only while the number is still a wanted session.
    console.error(`[${number}] restart failed: ${e.message}`);
    if (wanted.has(number) && !retryTimers.has(number)) {
      console.log(`[${number}] retrying restart in 10s`);
      retryTimers.set(number, setTimeout(() => { retryTimers.delete(number); restartSession(number).catch(() => {}); }, 10000));
    }
    throw e;
  }
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
  wanted.delete(number); // logged out / banned: never auto-revived again
  downTracker.delete(number); // gone for good - no down-incident to track
  if (retryTimers.has(number)) { clearTimeout(retryTimers.get(number)); retryTimers.delete(number); }
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
      // Up to 2 attempts, each on a FRESH socket: the code request is only
      // sent once the server has opened its pairing window (the qr ref),
      // and if the connection still dies mid-request, one clean retry on a
      // new socket is made inside the same user request.
      let lastErr = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        const entry = await startSession(number);
        entry.justPaired = true;
        entry.pairingInFlight = true;
        try {
          const windowOk = await waitForPairingWindow(entry, 20000);
          if (entry.sock?.authState?.creds?.registered) {
            entry.pairingInFlight = false;
            return { ok: true, status: 'already_paired', message: 'This number is already paired with PRIME MD. Send .menu on WhatsApp to start using the bot.' };
          }
          if (!windowOk) throw new Error('pairing window did not open in time');
          let code;
          try {
            code = await entry.sock.requestPairingCode(number, config.PAIR_CODE); // custom code first
          } catch (customErr) {
            console.log(`[${number}] custom pair code not accepted (${customErr.message}), falling back to a random code`);
            code = await entry.sock.requestPairingCode(number); // silent fallback, same socket
          }
          entry.pairingInFlight = false;
          // Keep the half-created session alive for the pairing window only.
          if (entry.pairingTimer) clearTimeout(entry.pairingTimer);
          entry.pairingTimer = setTimeout(async () => {
            const cur = sessions.get(number);
            if (cur && cur.status !== 'open') { console.log(`[${number}] pairing window expired - cleaning up`); await cleanupSession(number); }
          }, config.PAIRING_TIMEOUT_MS);
          return { ok: true, status: 'code_ready', code: formatCode(code), message: 'Enter this code in WhatsApp within the next few minutes: Linked devices > Link with phone number.' };
        } catch (e) {
          lastErr = e;
          entry.pairingInFlight = false;
          console.error(`[${number}] pairing attempt ${attempt} failed:`, e.message);
          // Retire this socket (and its half-registered creds when the
          // server logged it out) so the retry starts completely fresh.
          if (sessions.has(number)) await cleanupSession(number).catch(() => {});
          if (attempt < 2) {
            // The close handler may still be running its own cleanup for
            // this number; wait until the slot is fully free so it cannot
            // tear down the retry's fresh entry by mistake.
            for (let i = 0; i < 20 && sessions.has(number); i++) await new Promise(r => setTimeout(r, 150));
            await new Promise(r => setTimeout(r, 2000));
          }
        }
      }
      throw lastErr || new Error('pairing failed');
    });
    return result;
  } catch (e) {
    console.error(`[${number}] pairing failed:`, e.message);
    return { ok: false, status: 'try_again', message: 'Pairing could not be started right now. Please wait a moment and try again.' };
  }
}

// Anti-sleep watchdog: every minute, any registered session that is down
// with no reconnect already scheduled gets revived. Together with the
// close-handler backoff reconnect and boot-time restore, a session only
// stays down if WhatsApp itself logged it out.
let watchdogStarted = false;
function startWatchdog() {
  if (watchdogStarted) return;
  watchdogStarted = true;
  setInterval(() => {
    for (const entry of [...sessions.values()]) {
      try {
        if (entry.stopped || entry.pairingInFlight || entry.reconnectTimer) continue;
        if (entry.status === 'open') continue;
        const registered = !!entry.sock?.authState?.creds?.registered;
        if (!registered) continue; // half-paired entries belong to the pairing flow
        console.log(`[${entry.number}] watchdog: session is ${entry.status} with no reconnect pending - reviving`);
        if (wanted.has(entry.number)) noteWatchdogRevive(entry.number);
        restartSession(entry.number).catch(() => {});
      } catch { /* one bad entry never stops the watchdog */ }
    }
    // A wanted number with NO entry at all (its restart failed before an
    // entry could be created) gets revived here too.
    for (const number of [...wanted]) {
      try {
        if (sessions.has(number) || retryTimers.has(number)) continue;
        console.log(`[${number}] watchdog: wanted session has no live entry - reviving`);
        noteWatchdogRevive(number);
        restartSession(number).catch(() => {});
      } catch { /* one bad number never stops the watchdog */ }
    }
  }, 60000);
}

let restoreRetried = false;
async function restoreSessions() {
  startWatchdog();
  try {
    const { mongoConfigured } = require('./mongo');
    if (mongoConfigured()) console.log('[mongo] MONGO_URI detected - sessions persist in MongoDB and auto-reconnect after a redeploy.');
    else console.log('[mongo] MONGO_URI not set - local files only (sessions will NOT survive a redeploy).');
    const numbers = await listStoredNumbers(config.SERVER_ID);
    const todo = numbers.slice(0, config.SESSION_LIMIT);
    console.log(`[restore] ${todo.length} stored session(s) on ${config.SERVER_NAME}`);
    for (const n of todo) {
      wanted.add(n); // stored sessions are kept alive from boot onwards
      startSession(n).catch(e => console.error(`[restore] ${n} failed:`, e.message));
      await new Promise(r => setTimeout(r, 500)); // stagger boots
    }
    // Belt-and-braces: if the database is configured but the first pass
    // found nothing, look once more after 20s (a slow database or network
    // at container start must not leave real sessions unrestored).
    if (todo.length === 0 && !restoreRetried) {
      const { mongoConfigured } = require('./mongo');
      if (mongoConfigured()) {
        restoreRetried = true;
        setTimeout(() => { restoreSessions().catch(e => console.error('[restore] retry failed:', e.message)); }, 20000);
      }
    }
  } catch (e) { console.error('[restore] failed:', e.message); }
}

module.exports = {
  setMessageHandler, setEventHandler, startSession, stopSession, cleanupSession, restartSession,
  requestCode, restoreSessions, count, list, getSession, isConnected, pairing, formatCode,
  // Owner-alert internals, exposed for offline tests only.
  _alerts: {
    downTracker, noteWatchdogRevive, alertOwner, alertSessionLoggedOut,
    resetIncident: (number) => downTracker.delete(number),
    ALERT_THROTTLE_MS, DOWN_ALERT_CYCLES,
  },
};
