// Group helpers for Phase 3: metadata (short-cached), admin checks, and
// per-group settings + warns stored through the Phase 1 settings layer
// (session settings -> `groups` map and `warns` map, so everything is
// restart-safe in Mongo or the settings file).
const GROUP_DEFAULTS = { welcome: false, goodbye: false, antilink: false, antibad: false, antistatus: false };

const metaCache = new Map(); // `${session}|${jid}` -> { meta, ts }
const META_TTL = 30 * 1000;

async function getMetadata(sock, sessionNumber, jid) {
  const key = `${sessionNumber}|${jid}`;
  const hit = metaCache.get(key);
  if (hit && Date.now() - hit.ts < META_TTL) return hit.meta;
  const meta = await sock.groupMetadata(jid);
  metaCache.set(key, { meta, ts: Date.now() });
  return meta;
}
function _clearMetaCache() { metaCache.clear(); }

function participantOf(meta, jid) {
  if (!meta || !jid) return null;
  const num = jid.split('@')[0].split(':')[0];
  return (meta.participants || []).find(p => {
    const pn = (p.id || '').split('@')[0].split(':')[0];
    const phone = (p.phoneNumber || '').split('@')[0].split(':')[0];
    return pn === num || phone === num;
  }) || null;
}
function isAdminMeta(meta, jid) {
  const p = participantOf(meta, jid);
  return !!(p && (p.admin === 'admin' || p.admin === 'superadmin'));
}
async function isAdmin(sock, sessionNumber, jid, userJid) {
  try { return isAdminMeta(await getMetadata(sock, sessionNumber, jid), userJid); }
  catch { return false; }
}

// ---- per-group settings (via settings layer) ----
async function getGroupSettings(settingsApi, sessionNumber, groupJid) {
  const s = await settingsApi.getSettings(sessionNumber);
  const all = s.groups || {};
  return { ...GROUP_DEFAULTS, ...(all[groupJid] || {}) };
}
async function setGroupSetting(settingsApi, sessionNumber, groupJid, patch) {
  const s = await settingsApi.getSettings(sessionNumber);
  const all = { ...(s.groups || {}) };
  all[groupJid] = { ...GROUP_DEFAULTS, ...(all[groupJid] || {}), ...patch };
  await settingsApi.setSettings(sessionNumber, { groups: all });
  return all[groupJid];
}
async function allGroupSettings(settingsApi, sessionNumber) {
  const s = await settingsApi.getSettings(sessionNumber);
  return s.groups || {};
}

// ---- warns (per session+group+user) ----
const warnKey = (groupJid, userNumber) => `${groupJid}|${userNumber}`;
async function getWarns(settingsApi, sessionNumber, groupJid, userNumber) {
  const s = await settingsApi.getSettings(sessionNumber);
  return (s.warns || {})[warnKey(groupJid, userNumber)] || 0;
}
async function setWarns(settingsApi, sessionNumber, groupJid, userNumber, count) {
  const s = await settingsApi.getSettings(sessionNumber);
  const warns = { ...(s.warns || {}) };
  if (count <= 0) delete warns[warnKey(groupJid, userNumber)];
  else warns[warnKey(groupJid, userNumber)] = count;
  await settingsApi.setSettings(sessionNumber, { warns });
  return count;
}

module.exports = {
  GROUP_DEFAULTS, getMetadata, _clearMetaCache, participantOf, isAdminMeta, isAdmin,
  getGroupSettings, setGroupSetting, allGroupSettings, getWarns, setWarns, warnKey,
};
