// Global ban list for PRIME MD. A banned number is ignored by the command
// handler on every session, and banning also removes that number's live
// session (handled by the .ban command). Storage: MongoDB (collection
// "global_state", doc _id "banlist") when a database is configured,
// otherwise a local JSON file. An in-memory cache keeps the per-message
// check cheap; the global owner can never be banned.
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getDb } = require('./mongo');

const FILE = process.env.PRIME_BANLIST_FILE || path.join(__dirname, '..', 'data', 'banlist.json');
const cache = new Map(); // number -> { at, by }
let loaded = false;
let loadPromise = null;

function persistFile() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const obj = {};
    for (const [n, v] of cache) obj[n] = v;
    fs.writeFileSync(FILE, JSON.stringify(obj, null, 2));
  } catch {}
}
function readFile() {
  try {
    const obj = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    for (const [n, v] of Object.entries(obj || {})) cache.set(n, v);
  } catch {}
}

async function ensureLoaded() {
  if (loaded) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    readFile();
    const db = await getDb().catch(() => null);
    if (db) {
      const doc = await db.collection('global_state').findOne({ _id: 'banlist' }).catch(() => null);
      if (doc && doc.numbers) for (const [n, v] of Object.entries(doc.numbers)) cache.set(n, v);
    }
    loaded = true;
  })();
  return loadPromise;
}

async function persist() {
  persistFile();
  const db = await getDb().catch(() => null);
  if (db) {
    const numbers = {};
    for (const [n, v] of cache) numbers[n] = v;
    await db.collection('global_state').updateOne({ _id: 'banlist' }, { $set: { numbers } }, { upsert: true }).catch(() => {});
  }
}

function isBanned(number) { return cache.has(String(number || '').replace(/\D/g, '')); }
function list() { return [...cache.entries()].map(([number, v]) => ({ number, at: v?.at || 0, by: v?.by || '' })); }

// The single check the message handler uses: banned numbers are ignored,
// the global owner is never ignored.
function shouldIgnore(senderNumber, isOwner) {
  if (isOwner) return false;
  return isBanned(senderNumber);
}

async function ban(number, by = '') {
  const n = String(number || '').replace(/\D/g, '');
  if (!n) return { ok: false, reason: 'invalid' };
  if (n === config.OWNER_NUMBER) return { ok: false, reason: 'owner' }; // hard guard
  await ensureLoaded();
  cache.set(n, { at: Date.now(), by });
  await persist();
  return { ok: true };
}
async function unban(number) {
  const n = String(number || '').replace(/\D/g, '');
  await ensureLoaded();
  const had = cache.delete(n);
  if (had) await persist();
  return { ok: true, removed: had };
}

function _resetForTests() { cache.clear(); loaded = false; loadPromise = null; }

module.exports = { ensureLoaded, isBanned, shouldIgnore, ban, unban, list, _resetForTests };
