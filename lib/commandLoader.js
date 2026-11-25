// Loads every commands/*.js file. A file may export one command object or an
// array of them: { name, aliases, category, description, use, ownerOnly,
// groupOnly, run(ctx) }. The registry is keyed by name; aliases resolve to
// the same command. Duplicate names/aliases are collected and reported.
const fs = require('fs');
const path = require('path');

function loadCommands(dir = path.join(__dirname, '..', 'commands')) {
  const registry = new Map();
  const aliasMap = new Map();
  const duplicates = [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort();
  for (const file of files) {
    const exported = require(path.join(dir, file));
    const list = Array.isArray(exported) ? exported : [exported];
    for (const cmd of list) {
      if (!cmd || !cmd.name || typeof cmd.run !== 'function') { duplicates.push(`INVALID export in ${file}`); continue; }
      cmd.name = cmd.name.toLowerCase();
      cmd.aliases = (cmd.aliases || []).map(a => a.toLowerCase());
      cmd.category = cmd.category || 'Misc';
      cmd.file = file;
      if (registry.has(cmd.name) || aliasMap.has(cmd.name)) duplicates.push(`duplicate name: ${cmd.name} (${file})`);
      registry.set(cmd.name, cmd);
      for (const alias of cmd.aliases) {
        if (registry.has(alias) || aliasMap.has(alias)) duplicates.push(`duplicate alias: ${alias} (${file})`);
        aliasMap.set(alias, cmd);
      }
    }
  }
  const get = (name) => registry.get(name) || aliasMap.get(name) || null;
  const byCategory = () => {
    const out = {};
    for (const cmd of registry.values()) { (out[cmd.category] = out[cmd.category] || []).push(cmd); }
    for (const k of Object.keys(out)) out[k].sort((a, b) => a.name.localeCompare(b.name));
    return out;
  };
  return { registry, aliasMap, duplicates, get, byCategory, count: registry.size, all: [...registry.values()] };
}
module.exports = { loadCommands };
