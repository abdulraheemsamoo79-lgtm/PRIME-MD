// PRIME MD - Personal automation (Phase 3). Every toggle is stored in the
// per-session settings layer, so it survives restarts; the behaviours
// themselves are executed by lib/automation.js hooks. Each toggle command
// replies with its new ON/OFF state.
const msgstore = require('../lib/msgstore');

async function getToggles(ctx) {
  const s = await ctx.settings.getSettings(ctx.sessionNumber);
  return { s, toggles: s.toggles || {} };
}
async function setToggle(ctx, key, value) {
  const { toggles } = await getToggles(ctx);
  const next = { ...toggles, [key]: value };
  await ctx.settings.setSettings(ctx.sessionNumber, { toggles: next });
  return value;
}
function toggleCmd(name, key, label, description, extra) {
  return {
    name, aliases: [], category: 'Personal', description,
    use: `.${name} on/off`,
    run: async (ctx) => {
      const arg = (ctx.args[0] || '').toLowerCase();
      const { toggles } = await getToggles(ctx);
      const next = arg === 'on' ? true : arg === 'off' ? false : !toggles[key];
      await setToggle(ctx, key, next);
      if (extra) await extra(ctx, next);
      await ctx.reply(`✅ ${label} is now *${next ? 'ON' : 'OFF'}*.`);
    },
  };
}

const reminders = new Map(); // id -> timeout (in-memory on purpose, see .remind)

module.exports = [
  {
    name: 'antidelete', aliases: [], category: 'Personal',
    description: 'Recover deleted messages to your own DM (messages are stored when they arrive).',
    use: '.antidelete on/off',
    run: async (ctx) => {
      const arg = (ctx.args[0] || '').toLowerCase();
      const { toggles } = await getToggles(ctx);
      if (arg === 'status') {
        await ctx.reply(`🗑️ Antidelete is *${toggles.antidelete ? 'ON' : 'OFF'}*.\nStored messages right now: ${msgstore.size(ctx.sessionNumber)}\nDeleted messages can only be recovered if they arrived while the bot was running.`);
        return;
      }
      const next = arg === 'on' ? true : arg === 'off' ? false : !toggles.antidelete;
      await setToggle(ctx, 'antidelete', next);
      await ctx.reply(`✅ Antidelete is now *${next ? 'ON' : 'OFF'}*.${next ? '\nDeleted messages will be re-sent to your own DM.' : ''}`);
    },
  },
  toggleCmd('antiedit', 'antiedit', 'Antiedit', 'Show the old and new text in your DM when someone edits a message.'),
  toggleCmd('autovv', 'autovv', 'Auto view-once save', 'Automatically save incoming view-once media to your own DM.'),
  toggleCmd('statusview', 'statusview', 'Auto status view', 'Automatically view (read) every status that arrives.'),
  toggleCmd('statusreact', 'statusreact', 'Auto status react', 'Automatically react to statuses with emojis.'),
  toggleCmd('anticall', 'anticall', 'Anti-call', 'Automatically reject incoming calls with a polite message.'),
  toggleCmd('autoread', 'autoread', 'Auto-read', 'Automatically mark incoming messages as read.'),
  toggleCmd('autoreactdm', 'autoreactdm', 'Auto-react to DMs', 'Automatically react to DM messages with a heart.'),
  toggleCmd('mentionalert', 'mentionalert', 'Mention alerts', 'Get a DM alert when you are mentioned or quoted in a group.'),
  toggleCmd('autotyping', 'autotyping', 'Auto-typing', 'Show a typing indicator when messages arrive.'),
  toggleCmd('alwaysonline', 'alwaysonline', 'Always online', 'Keep your presence shown as online.', async (ctx, next) => {
    try { await ctx.sock.sendPresenceUpdate(next ? 'available' : 'unavailable'); } catch {}
  }),
  {
    name: 'statussave', aliases: [], category: 'Personal',
    description: 'Auto-save incoming status media to your DM. You can also reply "save" to any status.',
    use: '.statussave on/off',
    run: async (ctx) => {
      const arg = (ctx.args[0] || '').toLowerCase();
      const { toggles } = await getToggles(ctx);
      const next = arg === 'on' ? true : arg === 'off' ? false : !toggles.statussave;
      await setToggle(ctx, 'statussave', next);
      await ctx.reply(`✅ Auto status save is now *${next ? 'ON' : 'OFF'}*.\nTip: you can also reply *save* to any status to save just that one.`);
    },
  },
  {
    name: 'sleepmode', aliases: [], category: 'Personal',
    description: 'Night bundle: rejects calls and quietly replies once to each DM sender while you sleep.',
    use: '.sleepmode on/off',
    run: async (ctx) => {
      const arg = (ctx.args[0] || '').toLowerCase();
      const { s } = await getToggles(ctx);
      const next = arg === 'on' ? true : arg === 'off' ? false : !s.sleepmode;
      await ctx.settings.setSettings(ctx.sessionNumber, { sleepmode: next });
      await ctx.reply(`🌙 Sleep mode is now *${next ? 'ON' : 'OFF'}*.${next ? '\nCalls will be rejected and DM senders will get one quiet reply each.' : ''}`);
    },
  },
  {
    name: 'afk', aliases: [], category: 'Personal',
    description: 'Set yourself away with a reason. DM senders get one auto-reply; it turns off when you send a message.',
    use: '.afk [reason] / .afk off',
    run: async (ctx) => {
      const { s } = await getToggles(ctx);
      if ((ctx.args[0] || '').toLowerCase() === 'off') {
        await ctx.settings.setSettings(ctx.sessionNumber, { afk: { on: false, reason: '', since: 0, notified: [] } });
        await ctx.reply('✅ AFK is now *OFF*. Welcome back!');
        return;
      }
      if (!ctx.argText && !s.afk?.on) {
        await ctx.settings.setSettings(ctx.sessionNumber, { afk: { on: true, reason: '', since: Date.now(), notified: [] } });
        await ctx.reply('💤 AFK is now *ON*. DM senders will get one auto-reply each.');
        return;
      }
      if (!ctx.argText && s.afk?.on) {
        await ctx.reply(`💤 AFK is *ON*${s.afk.reason ? ` - reason: ${s.afk.reason}` : ''}.\nUse .afk off to turn it off.`);
        return;
      }
      await ctx.settings.setSettings(ctx.sessionNumber, { afk: { on: true, reason: ctx.argText.slice(0, 200), since: Date.now(), notified: [] } });
      await ctx.reply(`💤 AFK is now *ON*.\nReason: ${ctx.argText.slice(0, 200)}`);
    },
  },
  {
    name: 'autoreply', aliases: [], category: 'Personal',
    description: 'Set a custom auto-reply text for DMs (sent once per sender).',
    use: '.autoreply <text> / .autoreply off',
    run: async (ctx) => {
      if ((ctx.args[0] || '').toLowerCase() === 'off') {
        await setToggle(ctx, 'autoreply', false);
        await ctx.reply('✅ Auto-reply is now *OFF*.');
        return;
      }
      if (!ctx.argText) {
        const { toggles, s } = await getToggles(ctx);
        await ctx.reply(`💬 Auto-reply is *${toggles.autoreply ? 'ON' : 'OFF'}*.${s.autoreplyText ? `\nCurrent text: ${s.autoreplyText}` : ''}\nUse .autoreply <text> to set it, or .autoreply off.`);
        return;
      }
      await ctx.settings.setSettings(ctx.sessionNumber, { autoreplyText: ctx.argText.slice(0, 500) });
      await setToggle(ctx, 'autoreply', true);
      await ctx.reply('✅ Auto-reply is now *ON*.\nText: ' + ctx.argText.slice(0, 500));
    },
  },
  {
    name: 'remind', aliases: [], category: 'Personal',
    description: 'Remind yourself in N minutes. Note: reminders are kept in memory and are lost if the bot restarts.',
    use: '.remind <minutes> <text>',
    run: async (ctx) => {
      const mins = parseFloat(ctx.args[0]);
      const text = ctx.args.slice(1).join(' ');
      if (!mins || mins <= 0 || mins > 60 * 24 * 7 || !text) {
        await ctx.reply('Usage: .remind <minutes> <text>\nExample: .remind 30 Call the bank\n\nNote: reminders are lost if the bot restarts.');
        return;
      }
      const id = `${ctx.sessionNumber}:${Date.now()}`;
      const timer = setTimeout(async () => {
        reminders.delete(id);
        try { await ctx.sock.sendMessage(ctx.jid, { text: `⏰ *Reminder*\n\n${text}` }); } catch {}
      }, mins * 60 * 1000);
      timer.unref?.();
      reminders.set(id, timer);
      await ctx.reply(`⏰ Reminder set for ${mins} minute(s): ${text}\n(It will be lost if the bot restarts before then.)`);
    },
  },
  {
    name: 'note', aliases: [], category: 'Personal',
    description: 'Save a note. Notes are stored in the database and survive restarts.',
    use: '.note <text>',
    run: async (ctx) => {
      if (!ctx.argText) { await ctx.reply('Usage: .note <text>'); return; }
      const { s } = await getToggles(ctx);
      const notes = [...(s.notes || []), { text: ctx.argText.slice(0, 1000), at: Date.now() }];
      await ctx.settings.setSettings(ctx.sessionNumber, { notes: notes.slice(-100) });
      await ctx.reply(`📝 Note saved (#${notes.length}). Use .notes to see them all.`);
    },
  },
  {
    name: 'notes', aliases: [], category: 'Personal',
    description: 'List all your saved notes.',
    use: '.notes',
    run: async (ctx) => {
      const { s } = await getToggles(ctx);
      const notes = s.notes || [];
      if (!notes.length) { await ctx.reply('📝 You have no notes yet. Save one with .note <text>'); return; }
      let out = `📝 *Your notes* (${notes.length})\n`;
      notes.forEach((n, i) => { out += `\n${i + 1}. ${n.text}`; });
      await ctx.reply(out.slice(0, 3900));
    },
  },
  {
    name: 'delnote', aliases: [], category: 'Personal',
    description: 'Delete a note by its number (see .notes).',
    use: '.delnote <number>',
    run: async (ctx) => {
      const idx = parseInt(ctx.args[0], 10) - 1;
      const { s } = await getToggles(ctx);
      const notes = [...(s.notes || [])];
      if (Number.isNaN(idx) || idx < 0 || idx >= notes.length) { await ctx.reply('Please give a valid note number from .notes'); return; }
      const [removed] = notes.splice(idx, 1);
      await ctx.settings.setSettings(ctx.sessionNumber, { notes });
      await ctx.reply(`🗑️ Note deleted: ${removed.text.slice(0, 100)}`);
    },
  },
  {
    name: 'setbio', aliases: [], category: 'Personal',
    description: 'Change your WhatsApp bio (profile status).',
    use: '.setbio <text>',
    run: async (ctx) => {
      if (!ctx.argText) { await ctx.reply('Usage: .setbio <text>'); return; }
      try { await ctx.sock.updateProfileStatus(ctx.argText.slice(0, 139)); await ctx.reply('✅ Bio updated.'); }
      catch { await ctx.reply('⚠️ Sorry, the bio could not be updated right now.'); }
    },
  },
  {
    name: 'setname', aliases: [], category: 'Personal',
    description: 'Change your WhatsApp profile name.',
    use: '.setname <name>',
    run: async (ctx) => {
      if (!ctx.argText) { await ctx.reply('Usage: .setname <name>'); return; }
      try { await ctx.sock.updateProfileName(ctx.argText.slice(0, 25)); await ctx.reply('✅ Profile name updated.'); }
      catch { await ctx.reply('⚠️ Sorry, the profile name could not be updated right now.'); }
    },
  },
  {
    name: 'blocklist', aliases: [], category: 'Personal',
    description: 'List the numbers you have blocked.',
    use: '.blocklist',
    run: async (ctx) => {
      try {
        const list = (await ctx.sock.fetchBlocklist()).filter(Boolean);
        if (!list.length) { await ctx.reply('🚫 Your block list is empty.'); return; }
        let out = `🚫 *Blocked numbers* (${list.length})\n`;
        list.forEach((j, i) => { out += `\n${i + 1}. ${String(j).split('@')[0]}`; });
        await ctx.reply(out.slice(0, 3900));
      } catch { await ctx.reply('⚠️ Sorry, the block list could not be loaded right now.'); }
    },
  },
];
