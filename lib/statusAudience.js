// Status audience builder. PROVEN REQUIREMENT (from the user's other bot,
// verified in Baileys code and on a real phone): a status send WITHOUT a
// statusJidList audience is accepted by WhatsApp but visible to NOBODY.
// Every status send must pass this audience: all participants of all groups
// the session is in + the session's own number + the command user, deduped.
function mergeAudience(groupJidsLists, sessionNumber, extraJids = []) {
  const set = new Set();
  for (const list of groupJidsLists || []) for (const jid of list || []) if (jid) set.add(jid);
  if (sessionNumber) set.add(`${sessionNumber}@s.whatsapp.net`);
  for (const jid of extraJids || []) if (jid) set.add(jid);
  return [...set];
}

async function getStatusAudience(sock, sessionNumber, extraJids = []) {
  let groups = {};
  try { groups = await sock.groupFetchAllParticipating(); } catch { groups = {}; }
  const lists = Object.values(groups || {}).map(g => (g.participants || []).map(p => p.id));
  return mergeAudience(lists, sessionNumber, extraJids);
}

module.exports = { getStatusAudience, mergeAudience };
