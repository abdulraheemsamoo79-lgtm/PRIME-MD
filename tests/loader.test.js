// Command registry check: totals, per-category counts, duplicates.
const { loadCommands } = require('../lib/commandLoader');
const api = loadCommands();
console.log(`Total commands: ${api.count}`);
const cats = api.byCategory();
for (const [cat, cmds] of Object.entries(cats)) console.log(`  ${cat}: ${cmds.length} (${cmds.map(c => c.name).join(', ')})`);
console.log(`Aliases: ${api.aliasMap.size}`);
console.log(`Duplicates: ${api.duplicates.length}${api.duplicates.length ? ' -> ' + api.duplicates.join('; ') : ''}`);
if (api.duplicates.length) process.exit(1);
