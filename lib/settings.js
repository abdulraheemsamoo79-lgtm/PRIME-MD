// Per-session settings (mode etc.). Mongo when available, otherwise an
// in-memory map persisted to data/settings.json. Restart-safe either way.
const fs = require('fs');
const path = require('path');
const { getDb } = require('./mongo');

const FILE = path.join(__dirname, '..', 'data', 'settings.json');
let cache = {};
try { cache = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { cache = {}; }

function persistFile() {
  try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(cache, null, 2)); } catch {}
}
function defaults() { return { mode: 'public' }; }

async function getSettings(number) {
  if (cache[number]) return { ...defaults(), ...cache[number] };
  const db = await getDb();
  if (db) {
    const doc = await db.collection('settings').findOne({ _id: number }).catch(() => null);
    if (doc && doc.value) { cache[number] = doc.value; return { ...defaults(), ...doc.value }; }
  }
  return defaults();
}
async function setSettings(number, patch) {
  const next = { ...(await getSettings(number)), ...patch };
  cache[number] = next;
  persistFile();
  const db = await getDb();
  if (db) await db.collection('settings').updateOne({ _id: number }, { $set: { value: next } }, { upsert: true }).catch(() => {});
  return next;
}
async function getMode(number) { return (await getSettings(number)).mode || 'public'; }
async function setMode(number, mode) { return setSettings(number, { mode }); }

module.exports = { getSettings, setSettings, getMode, setMode };
