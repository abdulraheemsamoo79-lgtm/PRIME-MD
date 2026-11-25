// PRIME MD - Group management & protection. All per-group
// settings live in the settings layer (restart-safe). Admin/owner gates:
// group admin commands require the sender to be a group admin, the global
// owner, or the session owner; ownerOnly commands are marked as such.
const fs = require('fs');
const os = require('os');
const path = require('path');
const groupUtil = require('../lib/groupUtil');

const FAIL = '⚠️ Sorry, that could not be done right now. Please make sure the bot is a group admin and try again.';

async function requireAdmin(ctx) {
  if (ctx.isOwner || ctx.isSessionOwner) return true;
  const ok = await groupUtil.isAdmin(ctx.sock, ctx.sessionNumber, ctx.jid, ctx.senderJid);
  if (!ok) await ctx.reply('🔒 That command is for group admins only.');
  return ok;
}
function targetOf(ctx) {
  const jid = ctx.mentionedJids?.[0] || ctx.quoted?.participant || null;
  if (jid) return jid;
  const num = (ctx.args[0] || '').replace(/\D/g, '');
  return num.length >= 7 ? `${num}@s.whatsapp.net` : null;
}
const numOf = (jid) => String(jid || '').split('@')[0].split(':')[0];

function toggleCmd(name, key, label, description) {
  return {
    name, aliases: [], category: 'Group', groupOnly: true, description,
    use: `.${name} on/off`,
    run: async (ctx) => {
      if (!(await requireAdmin(ctx))) return;
      const arg = (ctx.args[0] || '').toLowerCase();
      const cur = await groupUtil.getGroupSettings(ctx.settings, ctx.sessionNumber, ctx.jid);
      const next = arg === 'on' ? true : arg === 'off' ? false : !cur[key];
      await groupUtil.setGroupSetting(ctx.settings, ctx.sessionNumber, ctx.jid, { [key]: next });
      await ctx.reply(`✅ ${label} is now *${next ? 'ON' : 'OFF'}* for this group.`);
    },
  };
}

module.exports = [
  toggleCmd('welcome', 'welcome', 'Group welcome messages', 'Turn fancy welcome messages for new members on or off.'),
  toggleCmd('goodbye', 'goodbye', 'Group goodbye messages', 'Turn goodbye messages for leaving members on or off.'),
  toggleCmd('antilink', 'antilink', 'Anti-link protection', 'Delete link messages from non-admins and warn the sender.'),
  toggleCmd('antibad', 'antibad', 'Anti-bad-words protection', 'Delete messages with bad words from non-admins and warn the sender.'),
  toggleCmd('antistatus', 'antistatus', 'Anti-status-share protection', 'Delete status-share messages posted in the group by non-admins.'),

  {
    name: 'tagall', aliases: ['everyone'], category: 'Group', groupOnly: true,
    description: 'Tag every group member with a visible numbered list (admins only).',
    use: '.tagall [message]',
    run: async (ctx) => {
      if (!(await requireAdmin(ctx))) return;
      let meta;
      try { meta = await groupUtil.getMetadata(ctx.sock, ctx.sessionNumber, ctx.jid); }
      catch { await ctx.reply(FAIL); return; }
      const members = (meta.participants || []).filter(p => numOf(p.id) !== ctx.sessionNumber);
      if (!members.length) { await ctx.reply('No members found in this group.'); return; }
      const head = ctx.argText ? `📢 ${ctx.argText}` : '📢 Attention everyone!';
      for (let i = 0; i < members.length; i += 50) {
        const chunk = members.slice(i, i + 50);
        let text = i === 0 ? `${head}\n` : '';
        chunk.forEach((p, j) => { text += `\n${i + j + 1}. @${numOf(p.id)}`; });
        if (i + 50 >= members.length) text += `\n\nTotal: ${members.length} members`;
        await ctx.sock.sendMessage(ctx.jid, { text: text.trim(), mentions: chunk.map(p => p.id) }, i === 0 ? { quoted: ctx.msg } : {});
      }
    },
  },
  {
    name: 'hidetag', aliases: [], category: 'Group', groupOnly: true,
    description: 'Send a message that silently tags every group member.',
    use: '.hidetag <message>',
    run: async (ctx) => {
      if (!(await requireAdmin(ctx))) return;
      if (!ctx.argText) { await ctx.reply('Please add a message: .hidetag <message>'); return; }
      let meta;
      try { meta = await groupUtil.getMetadata(ctx.sock, ctx.sessionNumber, ctx.jid); }
      catch { await ctx.reply(FAIL); return; }
      await ctx.sock.sendMessage(ctx.jid, { text: ctx.argText, mentions: (meta.participants || []).map(p => p.id) });
    },
  },
  {
    name: 'tagadmin', aliases: [], category: 'Group', groupOnly: true,
    description: 'Tag all group admins.',
    use: '.tagadmin [message]',
    run: async (ctx) => {
      let meta;
      try { meta = await groupUtil.getMetadata(ctx.sock, ctx.sessionNumber, ctx.jid); }
      catch { await ctx.reply(FAIL); return; }
      const admins = (meta.participants || []).filter(p => p.admin);
      if (!admins.length) { await ctx.reply('No admins found in this group.'); return; }
      let text = `👑 *Group Admins*${ctx.argText ? `\n${ctx.argText}` : ''}\n`;
      admins.forEach((p, i) => { text += `\n${i + 1}. @${numOf(p.id)}${p.admin === 'superadmin' ? ' (owner)' : ''}`; });
      await ctx.sock.sendMessage(ctx.jid, { text, mentions: admins.map(p => p.id) }, { quoted: ctx.msg });
    },
  },
  {
    name: 'kick', aliases: ['remove'], category: 'Group', groupOnly: true,
    description: 'Remove a member from the group (admins only).',
    use: '.kick @user / reply / number',
    run: async (ctx) => {
      if (!(await requireAdmin(ctx))) return;
      const target = targetOf(ctx);
      if (!target) { await ctx.reply('Please tag, reply to, or give the number of the member to remove.'); return; }
      if (numOf(target) === ctx.sessionNumber) { await ctx.reply('I cannot remove myself from the group.'); return; }
      try {
        await ctx.sock.groupParticipantsUpdate(ctx.jid, [target], 'remove');
        await ctx.sock.sendMessage(ctx.jid, { text: `👢 @${numOf(target)} has been removed from the group.`, mentions: [target] });
      } catch { await ctx.reply(FAIL); }
    },
  },
  {
    name: 'add', aliases: [], category: 'Group', groupOnly: true,
    description: 'Add a member to the group by number (admins only).',
    use: '.add <number>',
    run: async (ctx) => {
      if (!(await requireAdmin(ctx))) return;
      const num = (ctx.args[0] || '').replace(/\D/g, '');
      if (num.length < 7) { await ctx.reply('Please give a full number with country code: .add 923001234567'); return; }
      try {
        const res = await ctx.sock.groupParticipantsUpdate(ctx.jid, [`${num}@s.whatsapp.net`], 'add');
        const status = res?.[0]?.status;
        if (status && String(status) !== '200') {
          await ctx.reply(`⚠️ @${num} could not be added (WhatsApp status ${status}). Their privacy settings may block group adds - please invite them with the group link instead.`);
          return;
        }
        await ctx.reply(`✅ @${num} has been added to the group.`);
      } catch { await ctx.reply(FAIL); }
    },
  },
  {
    name: 'promote', aliases: [], category: 'Group', groupOnly: true,
    description: 'Promote a member to group admin (admins only).',
    use: '.promote @user / reply / number',
    run: async (ctx) => {
      if (!(await requireAdmin(ctx))) return;
      const target = targetOf(ctx);
      if (!target) { await ctx.reply('Please tag, reply to, or give the number of the member to promote.'); return; }
      try {
        await ctx.sock.groupParticipantsUpdate(ctx.jid, [target], 'promote');
        await ctx.sock.sendMessage(ctx.jid, { text: `⬆️ @${numOf(target)} is now a group admin.`, mentions: [target] });
      } catch { await ctx.reply(FAIL); }
    },
  },
  {
    name: 'demote', aliases: [], category: 'Group', groupOnly: true,
    description: 'Demote a group admin back to member (admins only).',
    use: '.demote @user / reply / number',
    run: async (ctx) => {
      if (!(await requireAdmin(ctx))) return;
      const target = targetOf(ctx);
      if (!target) { await ctx.reply('Please tag, reply to, or give the number of the admin to demote.'); return; }
      try {
        await ctx.sock.groupParticipantsUpdate(ctx.jid, [target], 'demote');
        await ctx.sock.sendMessage(ctx.jid, { text: `⬇️ @${numOf(target)} is no longer a group admin.`, mentions: [target] });
      } catch { await ctx.reply(FAIL); }
    },
  },
  {
    name: 'mute', aliases: [], category: 'Group', groupOnly: true,
    description: 'Mute the group - only admins can send messages (admins only).',
    use: '.mute',
    run: async (ctx) => {
      if (!(await requireAdmin(ctx))) return;
      try { await ctx.sock.groupSettingUpdate(ctx.jid, 'announcement'); await ctx.reply('🔇 Group muted. Only admins can send messages now.'); }
      catch { await ctx.reply(FAIL); }
    },
  },
  {
    name: 'unmute', aliases: [], category: 'Group', groupOnly: true,
    description: 'Unmute the group - everyone can send messages again (admins only).',
    use: '.unmute',
    run: async (ctx) => {
      if (!(await requireAdmin(ctx))) return;
      try { await ctx.sock.groupSettingUpdate(ctx.jid, 'not_announcement'); await ctx.reply('🔊 Group unmuted. Everyone can send messages now.'); }
      catch { await ctx.reply(FAIL); }
    },
  },
  {
    name: 'lockgc', aliases: [], category: 'Group', groupOnly: true,
    description: 'Lock group settings so only admins can edit group info (admins only).',
    use: '.lockgc',
    run: async (ctx) => {
      if (!(await requireAdmin(ctx))) return;
      try { await ctx.sock.groupSettingUpdate(ctx.jid, 'locked'); await ctx.reply('🔒 Group info is now locked - only admins can edit it.'); }
      catch { await ctx.reply(FAIL); }
    },
  },
  {
    name: 'unlockgc', aliases: [], category: 'Group', groupOnly: true,
    description: 'Unlock group settings so members can edit group info (admins only).',
    use: '.unlockgc',
    run: async (ctx) => {
      if (!(await requireAdmin(ctx))) return;
      try { await ctx.sock.groupSettingUpdate(ctx.jid, 'unlocked'); await ctx.reply('🔓 Group info is now unlocked - members can edit it.'); }
      catch { await ctx.reply(FAIL); }
    },
  },
  {
    name: 'gclink', aliases: ['linkgc'], category: 'Group', groupOnly: true,
    description: 'Get the group invite link.',
    use: '.gclink',
    run: async (ctx) => {
      try {
        const code = await ctx.sock.groupInviteCode(ctx.jid);
        await ctx.reply(`🔗 Group invite link:\nhttps://chat.whatsapp.com/${code}`);
      } catch { await ctx.reply(FAIL); }
    },
  },
  {
    name: 'revoke', aliases: ['resetlink'], category: 'Group', groupOnly: true,
    description: 'Reset the group invite link (admins only).',
    use: '.revoke',
    run: async (ctx) => {
      if (!(await requireAdmin(ctx))) return;
      try {
        const code = await ctx.sock.groupRevokeInvite(ctx.jid);
        await ctx.reply(`✅ Invite link reset. New link:\nhttps://chat.whatsapp.com/${code}`);
      } catch { await ctx.reply(FAIL); }
    },
  },
  {
    name: 'gcinfo', aliases: ['groupinfo'], category: 'Group', groupOnly: true,
    description: 'Show information about this group.',
    use: '.gcinfo',
    run: async (ctx) => {
      let meta;
      try { meta = await groupUtil.getMetadata(ctx.sock, ctx.sessionNumber, ctx.jid); }
      catch { await ctx.reply(FAIL); return; }
      const admins = (meta.participants || []).filter(p => p.admin).length;
      let out = `👥 *${meta.subject || 'Group'}*\n`;
      out += `🆔 ID: ${meta.id}\n`;
      out += `👤 Members: ${(meta.participants || []).length} (${admins} admins)\n`;
      if (meta.creation) out += `📅 Created: ${new Date(meta.creation * 1000).toDateString()}\n`;
      if (meta.owner) out += `👑 Owner: @${numOf(meta.owner)}\n`;
      if (meta.desc) out += `\n📜 *Description:*\n${meta.desc}`;
      await ctx.sock.sendMessage(ctx.jid, { text: out, mentions: meta.owner ? [meta.owner] : [] }, { quoted: ctx.msg });
    },
  },
  {
    name: 'setgname', aliases: [], category: 'Group', groupOnly: true,
    description: 'Change the group name (admins only).',
    use: '.setgname <new name>',
    run: async (ctx) => {
      if (!(await requireAdmin(ctx))) return;
      if (!ctx.argText) { await ctx.reply('Please give the new name: .setgname <name>'); return; }
      try { await ctx.sock.groupUpdateSubject(ctx.jid, ctx.argText.slice(0, 100)); await ctx.reply(`✅ Group name changed to *${ctx.argText.slice(0, 100)}*.`); }
      catch { await ctx.reply(FAIL); }
    },
  },
  {
    name: 'setgdesc', aliases: [], category: 'Group', groupOnly: true,
    description: 'Change the group description (admins only).',
    use: '.setgdesc <new description>',
    run: async (ctx) => {
      if (!(await requireAdmin(ctx))) return;
      if (!ctx.argText) { await ctx.reply('Please give the new description: .setgdesc <text>'); return; }
      try { await ctx.sock.groupUpdateDescription(ctx.jid, ctx.argText.slice(0, 512)); await ctx.reply('✅ Group description updated.'); }
      catch { await ctx.reply(FAIL); }
    },
  },
  {
    name: 'join', aliases: [], category: 'Group', ownerOnly: true,
    description: 'Make the bot join a group from an invite link (owner only).',
    use: '.join <invite link>',
    run: async (ctx) => {
      const m = (ctx.argText || '').match(/chat\.whatsapp\.com\/([0-9A-Za-z]{20,})/);
      if (!m) { await ctx.reply('Please give a valid group invite link: .join https://chat.whatsapp.com/...'); return; }
      try {
        const gid = await ctx.sock.groupAcceptInvite(m[1]);
        await ctx.reply(gid ? `✅ Joined the group (${gid}).` : '✅ Join request sent.');
      } catch { await ctx.reply(FAIL); }
    },
  },
  {
    name: 'leave', aliases: [], category: 'Group', groupOnly: true, ownerOnly: true,
    description: 'Make the bot leave this group (owner only).',
    use: '.leave',
    run: async (ctx) => {
      try {
        await ctx.reply('👋 Goodbye! PRIME MD is leaving this group.');
        await ctx.sock.groupLeave(ctx.jid);
      } catch { await ctx.reply(FAIL); }
    },
  },
  {
    name: 'newgc', aliases: [], category: 'Group', ownerOnly: true,
    description: 'Create a new group with the given name (owner only).',
    use: '.newgc <group name>',
    run: async (ctx) => {
      if (!ctx.argText) { await ctx.reply('Please give a name: .newgc <group name>'); return; }
      try {
        const meta = await ctx.sock.groupCreate(ctx.argText.slice(0, 100), [ctx.senderJid]);
        await ctx.reply(`✅ Group *${meta.subject}* created (ID: ${meta.id}).`);
      } catch { await ctx.reply(FAIL); }
    },
  },
  {
    name: 'requestlist', aliases: ['reqs'], category: 'Group', groupOnly: true,
    description: 'List pending group join requests (admins only).',
    use: '.requestlist',
    run: async (ctx) => {
      if (!(await requireAdmin(ctx))) return;
      if (typeof ctx.sock.groupRequestParticipantsList !== 'function') { await ctx.reply('Join requests are not supported on this connection.'); return; }
      try {
        const list = await ctx.sock.groupRequestParticipantsList(ctx.jid);
        if (!list || !list.length) { await ctx.reply('✅ No pending join requests for this group.'); return; }
        let out = `📥 *Pending join requests* (${list.length})\n`;
        list.forEach((r, i) => { out += `\n${i + 1}. @${numOf(r.jid)}${r.requestMethod ? ` - via ${r.requestMethod}` : ''}`; });
        out += '\n\nUse .acceptreq @user or .rejectreq @user.';
        await ctx.sock.sendMessage(ctx.jid, { text: out, mentions: list.map(r => r.jid) }, { quoted: ctx.msg });
      } catch { await ctx.reply(FAIL); }
    },
  },
  {
    name: 'acceptreq', aliases: [], category: 'Group', groupOnly: true,
    description: 'Approve a pending group join request (admins only).',
    use: '.acceptreq @user / number',
    run: async (ctx) => {
      if (!(await requireAdmin(ctx))) return;
      const target = targetOf(ctx);
      if (!target) { await ctx.reply('Please tag or give the number of the requester to approve.'); return; }
      try {
        await ctx.sock.groupRequestParticipantsUpdate(ctx.jid, [target], 'approve');
        await ctx.sock.sendMessage(ctx.jid, { text: `✅ @${numOf(target)} was approved to join the group.`, mentions: [target] });
      } catch { await ctx.reply(FAIL); }
    },
  },
  {
    name: 'rejectreq', aliases: [], category: 'Group', groupOnly: true,
    description: 'Reject a pending group join request (admins only).',
    use: '.rejectreq @user / number',
    run: async (ctx) => {
      if (!(await requireAdmin(ctx))) return;
      const target = targetOf(ctx);
      if (!target) { await ctx.reply('Please tag or give the number of the requester to reject.'); return; }
      try {
        await ctx.sock.groupRequestParticipantsUpdate(ctx.jid, [target], 'reject');
        await ctx.sock.sendMessage(ctx.jid, { text: `❌ @${numOf(target)}'s join request was rejected.`, mentions: [target] });
      } catch { await ctx.reply(FAIL); }
    },
  },
  {
    name: 'poll', aliases: [], category: 'Group',
    description: 'Create a native WhatsApp poll. Separate the question and options with |.',
    use: '.poll Best color? | Red | Blue | Green',
    run: async (ctx) => {
      const parts = (ctx.argText || '').split('|').map(s => s.trim()).filter(Boolean);
      if (parts.length < 3) { await ctx.reply('Usage: .poll Question? | Option 1 | Option 2 | ...'); return; }
      const [question, ...options] = parts;
      try {
        await ctx.sock.sendMessage(ctx.jid, { poll: { name: question.slice(0, 255), values: options.slice(0, 12).map(o => o.slice(0, 100)), selectableCount: 1 } });
      } catch { await ctx.reply(FAIL); }
    },
  },
  {
    name: 'warn', aliases: [], category: 'Group', groupOnly: true,
    description: 'Warn a member. At 3 warnings the member is removed (admins only).',
    use: '.warn @user [reason]',
    run: async (ctx) => {
      if (!(await requireAdmin(ctx))) return;
      const target = targetOf(ctx);
      if (!target) { await ctx.reply('Please tag, reply to, or give the number of the member to warn.'); return; }
      if (numOf(target) === ctx.sessionNumber || numOf(target) === ctx.config.OWNER_NUMBER) { await ctx.reply('That member cannot be warned.'); return; }
      const count = (await groupUtil.getWarns(ctx.settings, ctx.sessionNumber, ctx.jid, numOf(target))) + 1;
      if (count >= 3) {
        await groupUtil.setWarns(ctx.settings, ctx.sessionNumber, ctx.jid, numOf(target), 0);
        try {
          await ctx.sock.groupParticipantsUpdate(ctx.jid, [target], 'remove');
          await ctx.sock.sendMessage(ctx.jid, { text: `⛔ @${numOf(target)} reached 3 warnings and has been removed from the group.`, mentions: [target] });
        } catch { await ctx.reply(FAIL); }
        return;
      }
      await groupUtil.setWarns(ctx.settings, ctx.sessionNumber, ctx.jid, numOf(target), count);
      const reason = ctx.args.slice(1).join(' ') || 'breaking the group rules';
      await ctx.sock.sendMessage(ctx.jid, { text: `⚠️ @${numOf(target)}, you have been warned (${count}/3).\nReason: ${reason}\nAt 3 warnings you will be removed.`, mentions: [target] });
    },
  },
  {
    name: 'unwarn', aliases: [], category: 'Group', groupOnly: true,
    description: 'Remove one warning from a member (admins only).',
    use: '.unwarn @user',
    run: async (ctx) => {
      if (!(await requireAdmin(ctx))) return;
      const target = targetOf(ctx);
      if (!target) { await ctx.reply('Please tag, reply to, or give the number of the member.'); return; }
      const cur = await groupUtil.getWarns(ctx.settings, ctx.sessionNumber, ctx.jid, numOf(target));
      const next = Math.max(0, cur - 1);
      await groupUtil.setWarns(ctx.settings, ctx.sessionNumber, ctx.jid, numOf(target), next);
      await ctx.sock.sendMessage(ctx.jid, { text: `✅ One warning removed. @${numOf(target)} now has ${next}/3 warnings.`, mentions: [target] });
    },
  },
  {
    name: 'warnings', aliases: ['warns'], category: 'Group', groupOnly: true,
    description: 'Check how many warnings a member has.',
    use: '.warnings @user',
    run: async (ctx) => {
      const target = targetOf(ctx) || ctx.senderJid;
      const count = await groupUtil.getWarns(ctx.settings, ctx.sessionNumber, ctx.jid, numOf(target));
      await ctx.sock.sendMessage(ctx.jid, { text: `⚠️ @${numOf(target)} has ${count}/3 warnings in this group.`, mentions: [target] }, { quoted: ctx.msg });
    },
  },
  {
    name: 'antibot', aliases: [], category: 'Group', groupOnly: true, ownerOnly: true,
    description: 'Report possible bot/automated accounts in the group (report only - nobody is removed).',
    use: '.antibot',
    run: async (ctx) => {
      let meta;
      try { meta = await groupUtil.getMetadata(ctx.sock, ctx.sessionNumber, ctx.jid); }
      catch { await ctx.reply(FAIL); return; }
      const suspects = (meta.participants || []).filter(p => !p.admin && String(p.id).endsWith('@lid'));
      let out = `🤖 *Anti-bot report* (report only - no one has been removed)\n\nMembers: ${(meta.participants || []).length}\nPossible automated/hidden-number accounts: ${suspects.length}`;
      if (suspects.length) {
        out += '\n';
        suspects.slice(0, 30).forEach((p, i) => { out += `\n${i + 1}. ${p.id}`; });
        out += '\n\nThese accounts hide their phone number (LID), which is common for bots. Review them and use .kick yourself if needed.';
      } else {
        out += '\n\nNo hidden-number accounts found. This check is a simple report - it cannot prove an account is a bot.';
      }
      await ctx.reply(out);
    },
  },
  {
    name: 'groupbackup', aliases: ['gcbackup'], category: 'Group', groupOnly: true, ownerOnly: true,
    description: 'Export this group\'s settings and member list as a JSON file to your DM (owner only).',
    use: '.groupbackup',
    run: async (ctx) => {
      let meta;
      try { meta = await groupUtil.getMetadata(ctx.sock, ctx.sessionNumber, ctx.jid); }
      catch { await ctx.reply(FAIL); return; }
      const gs = await groupUtil.getGroupSettings(ctx.settings, ctx.sessionNumber, ctx.jid);
      const data = {
        bot: ctx.config.BOT_NAME, exportedAt: new Date().toISOString(),
        group: { id: meta.id, subject: meta.subject, desc: meta.desc || '', owner: meta.owner || null, creation: meta.creation || null },
        settings: gs,
        members: (meta.participants || []).map(p => ({ jid: p.id, admin: p.admin || null })),
      };
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prime-backup-'));
      const file = path.join(dir, `group-backup-${Date.now()}.json`);
      try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
        const dest = `${ctx.sessionNumber}@s.whatsapp.net`;
        await ctx.sock.sendMessage(dest, {
          document: fs.readFileSync(file), fileName: 'group-backup.json', mimetype: 'application/json',
          caption: `💾 Backup of *${meta.subject || 'group'}* - settings + ${(meta.participants || []).length} members.`,
        });
        await ctx.reply('✅ Group backup sent to your DM.');
      } catch { await ctx.reply(FAIL); }
      finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
    },
  },
];
