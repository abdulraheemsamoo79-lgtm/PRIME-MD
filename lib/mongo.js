// Shared MongoDB access. Returns null ONLY when no real MONGO_URI is
// configured (local smoke tests / dev without a database).
//
// When a real URI IS configured, the first connect is retried for ~30s:
// on Railway a fresh container's private network (mongodb.railway.internal)
// is often not ready in the first seconds, and a single failed attempt
// must never silently drop the bot onto temporary file storage - sessions
// stored there die with the container.
const { MongoClient } = require('mongodb');
const config = require('../config');

function isPlaceholder(uri) {
  if (!uri) return true;
  return /PASSWORD|USER:|CLUSTER\.mongodb|YOUR_/i.test(uri);
}
function mongoConfigured() { return !isPlaceholder(config.MONGO_URI); }

let clientPromise = null;
let dbCache = null;

async function connectWithRetry() {
  let lastErr = null;
  for (let i = 1; i <= 8; i++) {
    try {
      const client = new MongoClient(config.MONGO_URI, { serverSelectionTimeoutMS: 8000 });
      const connected = await client.connect();
      console.log('[mongo] connected');
      return connected.db(config.MONGO_DB);
    } catch (err) {
      lastErr = err;
      console.error(`[mongo] connect attempt ${i} failed: ${err.message}`);
      if (i < 8) await new Promise(r => setTimeout(r, 3000));
    }
  }
  throw lastErr || new Error('mongo connect failed');
}

async function getDb() {
  if (!mongoConfigured()) return null;
  if (dbCache) return dbCache;
  if (!clientPromise) {
    clientPromise = connectWithRetry()
      .then(db => { dbCache = db; return db; })
      .catch(err => {
        console.error('[mongo] connect failed after all retries:', err.message);
        clientPromise = null; // a later call may try again
        return null;
      });
  }
  return clientPromise;
}
module.exports = { getDb, isPlaceholder, mongoConfigured };
