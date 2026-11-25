// Shared MongoDB access. Returns null when MONGO_URI is unset or still a
// placeholder, so the whole bot can run on local fallbacks (smoke tests,
// local dev) without a database.
const { MongoClient } = require('mongodb');
const config = require('../config');

function isPlaceholder(uri) {
  if (!uri) return true;
  return /PASSWORD|USER:|CLUSTER\.mongodb|YOUR_/i.test(uri);
}

let clientPromise = null;
async function getDb() {
  if (isPlaceholder(config.MONGO_URI)) return null;
  if (!clientPromise) {
    const client = new MongoClient(config.MONGO_URI, { serverSelectionTimeoutMS: 8000 });
    clientPromise = client.connect().then(c => c.db(config.MONGO_DB)).catch(err => {
      console.error('[mongo] connect failed, falling back to local storage:', err.message);
      clientPromise = null;
      return null;
    });
  }
  return clientPromise;
}
module.exports = { getDb, isPlaceholder };
