// Baileys auth state backed by MongoDB (collections: auth_creds, auth_keys),
// adapted from the standard useMultiFileAuthState pattern.
// Fallback: when no real MONGO_URI is configured, uses Baileys' own
// useMultiFileAuthState under sessions/<number>/ so the bot (and the smoke
// test) runs with no database at all.
const fs = require('fs');
const path = require('path');
const { initAuthCreds, BufferJSON, proto, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { getDb, mongoConfigured } = require('./mongo');

async function useMongoAuthState(number) {
  const db = await getDb();
  if (!db && mongoConfigured()) {
    // A database IS configured but unreachable even after retries. Refuse
    // to start: storing this session in the container's temporary files
    // would silently lose it on the next restart/redeploy.
    throw new Error('Database is configured but not reachable - refusing to store the session in temporary files');
  }
  if (!db) {
    const dir = path.join(__dirname, '..', 'sessions', number);
    fs.mkdirSync(dir, { recursive: true });
    const fileAuth = await useMultiFileAuthState(dir);
    return { state: fileAuth.state, saveCreds: fileAuth.saveCreds, isMongo: false, clearState: async () => { fs.rmSync(dir, { recursive: true, force: true }); } };
  }

  const credsCol = db.collection('auth_creds');
  const keysCol = db.collection('auth_keys');
  const writeDoc = async (col, id, value) => {
    await col.updateOne({ _id: id }, { $set: { value: JSON.stringify(value, BufferJSON.replacer) } }, { upsert: true });
  };
  const readDoc = async (col, id) => {
    const doc = await col.findOne({ _id: id });
    return doc ? JSON.parse(doc.value, BufferJSON.reviver) : null;
  };
  const removeDoc = async (col, id) => { await col.deleteOne({ _id: id }); };

  const creds = (await readDoc(credsCol, number)) || initAuthCreds();
  return {
    isMongo: true,
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(ids.map(async (id) => {
            let value = await readDoc(keysCol, `${number}:${type}:${id}`);
            if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
            data[id] = value;
          }));
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const type in data) {
            for (const id in data[type]) {
              const value = data[type][id];
              tasks.push(value ? writeDoc(keysCol, `${number}:${type}:${id}`, value) : removeDoc(keysCol, `${number}:${type}:${id}`));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: async () => { await writeDoc(credsCol, number, creds); },
    clearState: async () => {
      await credsCol.deleteOne({ _id: number });
      await keysCol.deleteMany({ _id: new RegExp(`^${number}:`) });
    },
  };
}

// Which numbers already have stored auth for THIS server (used to restore
// sessions on boot). Mongo: creds docs stamped by sessionManager meta.
// File fallback: folders under sessions/ containing creds.json.
async function listStoredNumbers(serverId) {
  const db = await getDb();
  if (!db && mongoConfigured()) {
    throw new Error('Database is configured but not reachable - cannot list stored sessions');
  }
  if (db) {
    const docs = await db.collection('sessions_meta').find({ serverId }).project({ _id: 1 }).toArray();
    return docs.map(d => d._id);
  }
  const base = path.join(__dirname, '..', 'sessions');
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base).filter(n => fs.existsSync(path.join(base, n, 'creds.json')));
}

module.exports = { useMongoAuthState, listStoredNumbers };
