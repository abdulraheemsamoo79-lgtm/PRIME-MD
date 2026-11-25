// Automation engine. index.js feeds EVERY incoming message here
// (onMessage) and sessionManager forwards socket events here (handleEvent:
// group-participants.update, messages.update, call). Everything is driven
// by per-session toggles in the settings layer, so all of it is
// restart-safe. Design rules: never crash the message flow, never send a
// raw error to a user, and the bot's own sends never re-trigger hooks
// (their message ids are remembered briefly).
const config = require('../config');
const settings = require('./settings');
const msgstore = require('./msgstore');
const vvcache = require('./vvcache');
const groupUtil = require('./groupUtil');
const { findMedia, downloadMedia, unwrapMessage } = require('./wamedia');

const BAD_WORDS = ['fuck', 'bitch', 'bastard', 'whore', 'slut', 'motherfucker', 'asshole', 'nigga', 'faggot', 'bullshit'];
const STATUS_EMOJIS = ['❤️', '🔥', '😍', '👏', '💯', '🙌', '😮', '✨'];
const LINK_RE = /(https?:\/\/|www\.|chat\.whatsapp\.com\/|t\.me\/|bit\.ly\/|wa\.me\/)/i;

const botSentIds = new Set(); // ids of messages THIS process sent (echo guard)
function noteSent(res) {
  try {
    const id = res?.key?.id;
    if (id) { botSentIds.add(id); setTimeout(() => botSentIds.delete(id), 60 * 1000).unref?.(); }
  } catch {}
}
async function send(sock, jid, content, opts) {
  const res = await sock.sendMessage(jid, content, opts);
  noteSent(res);
  return res;
}

async function getToggles(sessionNumber) {
  const s = await settings.getSettings(sessionNumber);
  return { settings: s, toggles: s.toggles || {} };
}
function selfJid(sessionNumber) { return `${sessionNumber}@s.whatsapp.net`; }

function textOf(message) { return msgstore.extractText(message || {}); }

// ---------- antidelete / antiedit ----------
async function resendStored(sessionNumber, sock, entry, header) {
  const dest = selfJid(sessionNumber);
  const who = entry.pushName ? `${entry.pushName} (${entry.senderNumber})` : entry.senderNumber;
  const media = findMedia(entry.message);
  try {
    if (media && ['image', 'video', 'audio', 'sticker', 'document'].includes(media.type)) {
      const buffer = await downloadMedia(media.content, media.type);
      const note = `${header}\nFrom: ${who}\nChat: ${entry.chatJid}`;
      if (media.type === 'image') await send(sock, dest, { image: buffer, caption: note });
      else if (media.type === 'video') await send(sock, dest, { video: buffer, caption: note, mimetype: 'video/mp4' });
      else if (media.type === 'audio') { await send(sock, dest, { text: note }); await send(sock, dest, { audio: buffer, ptt: !!media.content.ptt, mimetype: 'audio/ogg; codecs=opus' }); }
      else if (media.type === 'sticker') { await send(sock, dest, { text: note }); await send(sock, dest, { sticker: buffer }); }
      else await send(sock, dest, { document: buffer, fileName: media.content.fileName || 'file', caption: note });
    } else {
      await send(sock, dest, { text: `${header}\nFrom: ${who}\nChat: ${entry.chatJid}\n\n${entry.text || '(no text content)'}` });
    }
  } catch (e) { console.error('[automation] resend failed:', e.message); }
}

async function handleRevoke(sessionNumber, sock, originalKey) {
  const { toggles } = await getToggles(sessionNumber);
  if (!toggles.antidelete) return;
  const entry = msgstore.get(sessionNumber, originalKey?.id);
  if (!entry || entry.fromMe) return;
  await resendStored(sessionNumber, sock, entry, '🗑️ *Deleted message recovered* (antidelete)');
  msgstore.remove(sessionNumber, originalKey.id);
}

async function handleEdit(sessionNumber, sock, originalKey, editedMessage) {
  const { toggles } = await getToggles(sessionNumber);
  if (!toggles.antiedit) return;
  const entry = msgstore.get(sessionNumber, originalKey?.id);
  if (!entry || entry.fromMe) return;
  const newText = textOf(unwrapMessage(editedMessage || {}));
  const who = entry.pushName ? `${entry.pushName} (${entry.senderNumber})` : entry.senderNumber;
  await send(sock, selfJid(sessionNumber), {
    text: `✏️ *Message edited* (antiedit)\nFrom: ${who}\nChat: ${entry.chatJid}\n\nOld: ${entry.text || '(media / no text)'}\nNew: ${newText || '(media / no text)'}`,
  }).catch(() => {});
  entry.text = newText; // keep the store current for a later delete
}

// ---------- status automations ----------
let statusReactIdx = 0;
async function onStatus(sessionNumber, sock, msg) {
  const { toggles } = await getToggles(sessionNumber);
  if (msg.key.fromMe) return;
  try {
    if (toggles.statusview && typeof sock.readMessages === 'function') {
      await sock.readMessages([msg.key]).catch(() => {});
    }
    if (toggles.statusreact) {
      const emoji = STATUS_EMOJIS[statusReactIdx++ % STATUS_EMOJIS.length];
      await send(sock, 'status@broadcast', { react: { text: emoji, key: msg.key } }).catch(() => {});
    }
    if (toggles.statussave) {
      const media = findMedia(msg.message);
      if (media && ['image', 'video'].includes(media.type)) {
        const buffer = await downloadMedia(media.content, media.type);
        const caption = `💾 *Status saved* (statussave)\nFrom: ${msg.pushName || msg.key.participant?.split('@')[0] || 'unknown'}${media.content.caption ? `\n\n${media.content.caption}` : ''}`;
        if (media.type === 'image') await send(sock, selfJid(sessionNumber), { image: buffer, caption });
        else await send(sock, selfJid(sessionNumber), { video: buffer, caption, mimetype: 'video/mp4' });
      }
    }
  } catch (e) { console.error('[automation] status failed:', e.message); }
}

// 'save' / 'sv' reply to a status in your own chat: the quoted status was
// captured in the message store on arrival, so it can be re-sent exactly.
async function onSaveTrigger(sessionNumber, sock, msg, text) {
  if (!/^(save|sv)$/i.test(text.trim())) return false;
  const ctxInfo = msg.message?.extendedTextMessage?.contextInfo ||
    msg.message?.imageMessage?.contextInfo || msg.message?.videoMessage?.contextInfo;
  const stanzaId = ctxInfo?.stanzaId;
  if (!stanzaId) return false;
  const entry = msgstore.get(sessionNumber, stanzaId);
  if (!entry || entry.chatJid !== 'status@broadcast') return false;
  const media = findMedia(entry.message);
  if (!media) return false;
  try {
    const buffer = await downloadMedia(media.content, media.type);
    const caption = `💾 *Status saved*\nFrom: ${entry.pushName || entry.senderNumber}`;
    const dest = selfJid(sessionNumber);
    if (media.type === 'image') await send(sock, dest, { image: buffer, caption });
    else if (media.type === 'video') await send(sock, dest, { video: buffer, caption, mimetype: 'video/mp4' });
    else if (media.type === 'audio') await send(sock, dest, { audio: buffer, ptt: true, mimetype: 'audio/ogg; codecs=opus' });
    else return false;
    return true;
  } catch { return false; }
}

// ---------- group moderation ----------
async function moderate(sessionNumber, sock, msg, text) {
  const jid = msg.key.remoteJid;
  const gs = await groupUtil.getGroupSettings(settings, sessionNumber, jid);
  if (!gs.antilink && !gs.antibad && !gs.antistatus) return;
  const senderJid = msg.key.participant || jid;
  // Admins, the global owner and the session owner are never moderated.
  const senderNumber = senderJid.split('@')[0].split(':')[0];
  if (senderNumber === config.OWNER_NUMBER || senderNumber === sessionNumber) return;
  if (await groupUtil.isAdmin(sock, sessionNumber, jid, senderJid)) return;

  const node = unwrapMessage(msg.message);
  let reason = null;
  if (gs.antistatus && node.viewOnceMessage == null && (node.groupStatusMentionMessage || node.statusMentionMessage || msg.message.groupStatusMentionMessage)) reason = 'status shares are not allowed in this group';
  if (!reason && gs.antistatus && /status/i.test(text) && msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.statusMessage) reason = 'status shares are not allowed in this group';
  if (!reason && gs.antilink && LINK_RE.test(text)) reason = 'links are not allowed in this group';
  if (!reason && gs.antibad) {
    const lower = ` ${text.toLowerCase()} `;
    if (BAD_WORDS.some(w => lower.includes(` ${w} `) || lower.includes(` ${w},`) || lower.includes(` ${w}.`))) reason = 'bad language is not allowed in this group';
  }
  if (!reason) return;
  try {
    await sock.sendMessage(jid, { delete: msg.key });
    await send(sock, jid, { text: `⚠️ @${senderNumber}, your message was removed: ${reason}.`, mentions: [senderJid] });
  } catch (e) { console.error('[automation] moderate failed:', e.message); }
}

// ---------- main message hook ----------
async function onMessage(sessionNumber, sock, msg) {
  try {
    if (!msg?.message || !msg.key?.remoteJid) return;
    if (botSentIds.has(msg.key.id)) return; // our own send echoing back
    const jid = msg.key.remoteJid;
    if (jid === 'status@broadcast') { await onStatus(sessionNumber, sock, msg); return; }
    if (jid.endsWith('@newsletter')) return;

    // Protocol messages: delete-for-everyone / edits arriving as upserts.
    const proto = msg.message.protocolMessage;
    if (proto) {
      if (proto.type === 0 && proto.key) await handleRevoke(sessionNumber, sock, proto.key); // 0 = REVOKE
      else if (proto.type === 14 && proto.key) await handleEdit(sessionNumber, sock, proto.key, proto.editedMessage); // 14 = MESSAGE_EDIT
      return;
    }

    const text = textOf(msg.message);
    const fromMe = !!msg.key.fromMe;
    const { settings: s, toggles } = await getToggles(sessionNumber);
    const selfChat = jid === selfJid(sessionNumber) || (jid.endsWith('@s.whatsapp.net') && jid.split('@')[0] === sessionNumber);
    const quiet = !!s.sleepmode;

    if (fromMe) {
      // AFK turns off when the owner themselves sends a normal message.
      if (s.afk?.on && !text.startsWith(config.PREFIX)) {
        await settings.setSettings(sessionNumber, { afk: { on: false, reason: '', since: 0, notified: [] } });
      }
      return;
    }

    const senderJid = msg.key.participant || jid;
    const senderNumber = senderJid.split('@')[0].split(':')[0];

    // 'save' trigger works in any chat where a status was quoted.
    if (await onSaveTrigger(sessionNumber, sock, msg, text)) return;

    const isCommand = text.startsWith(config.PREFIX);

    if (toggles.autoread && typeof sock.readMessages === 'function') sock.readMessages([msg.key]).catch(() => {});
    if (toggles.alwaysonline && typeof sock.sendPresenceUpdate === 'function') sock.sendPresenceUpdate('available').catch(() => {});
    if (toggles.autotyping && typeof sock.sendPresenceUpdate === 'function') {
      sock.sendPresenceUpdate('composing', jid).catch(() => {});
      setTimeout(() => sock.sendPresenceUpdate('paused', jid).catch(() => {}), 3000).unref?.();
    }
    if (toggles.autoreactdm && !jid.endsWith('@g.us') && !isCommand) {
      send(sock, jid, { react: { text: '❤️', key: msg.key } }).catch(() => {});
    }

    // View-once auto-save to the owner's own DM (footer-less box, like .vv2).
    if (toggles.autovv) {
      const entry = vvcache.get(sessionNumber, jid, msg.key.id);
      if (entry) {
        try {
          const buffer = await downloadMedia(entry.content, entry.type);
          const label = { image: 'Photo', video: 'Video', audio: 'Voice Note' }[entry.type] || 'Media';
          const box = `┌─ 📥 VIEW ONCE SAVED ─────────\n├ Status: Saved\n├ Type: ${label}\n└─────────────────────────`;
          const dest = selfJid(sessionNumber);
          if (entry.type === 'image') await send(sock, dest, { image: buffer, caption: box });
          else if (entry.type === 'video') await send(sock, dest, { video: buffer, caption: box, mimetype: 'video/mp4' });
          else await send(sock, dest, { audio: buffer, ptt: true, mimetype: 'audio/ogg; codecs=opus' });
        } catch (e) { console.error('[automation] autovv failed:', e.message); }
      }
    }

    if (isCommand) return; // moderation & auto-replies never touch commands

    if (jid.endsWith('@g.us')) {
      await moderate(sessionNumber, sock, msg, text);
      // Mention alert: the session user was mentioned or quoted in a group.
      if (toggles.mentionalert) {
        const ctxInfo = msg.message.extendedTextMessage?.contextInfo || msg.message.imageMessage?.contextInfo || msg.message.videoMessage?.contextInfo;
        const mentioned = (ctxInfo?.mentionedJid || []).some(j => j.split('@')[0].split(':')[0] === sessionNumber);
        const quotedSelf = (ctxInfo?.participant || '').split('@')[0].split(':')[0] === sessionNumber;
        if ((mentioned || quotedSelf) && senderNumber !== sessionNumber) {
          let gname = jid;
          try { gname = (await groupUtil.getMetadata(sock, sessionNumber, jid)).subject || jid; } catch {}
          await send(sock, selfJid(sessionNumber), {
            text: `🔔 *Mention alert*\n${msg.pushName || senderNumber} ${quotedSelf ? 'replied to you' : 'mentioned you'} in *${gname}*:\n\n${text || '(media message)'}`,
          }).catch(() => {});
        }
      }
      return;
    }

    // DM automations: sleep mode quiet reply, AFK, custom auto-reply.
    const notified = new Set(s.afk?.notified || []);
    if (quiet && !notified.has('sleep:' + senderNumber)) {
      notified.add('sleep:' + senderNumber);
      await settings.setSettings(sessionNumber, { afk: { ...(s.afk || {}), notified: [...notified].slice(-200) } });
      await send(sock, jid, { text: '🌙 Sleep mode is on. I will reply when I am back.' }, { quoted: msg }).catch(() => {});
      return;
    }
    if (s.afk?.on && !notified.has(senderNumber)) {
      notified.add(senderNumber);
      await settings.setSettings(sessionNumber, { afk: { ...s.afk, notified: [...notified].slice(-200) } });
      await send(sock, jid, { text: `💤 I am away right now${s.afk.reason ? `: ${s.afk.reason}` : ''}. I will reply when I am back.` }, { quoted: msg }).catch(() => {});
      return;
    }
    if (toggles.autoreply && s.autoreplyText) {
      const key = `ar:${senderNumber}`;
      if (!notified.has(key)) {
        notified.add(key);
        await settings.setSettings(sessionNumber, { afk: { ...(s.afk || {}), notified: [...notified].slice(-200) } });
        await send(sock, jid, { text: s.autoreplyText }, { quoted: msg }).catch(() => {});
      }
    }
  } catch (e) { console.error('[automation] onMessage error:', e.message); }
}

// ---------- socket events ----------
async function handleEvent(sessionNumber, sock, event, payload) {
  try {
    if (event === 'group-participants.update') {
      const { id: groupJid, participants = [], action } = payload || {};
      if (!groupJid || !['add', 'remove'].includes(action)) return;
      const gs = await groupUtil.getGroupSettings(settings, sessionNumber, groupJid);
      if (action === 'add' && !gs.welcome) return;
      if (action === 'remove' && !gs.goodbye) return;
      let meta = null;
      try { meta = await groupUtil.getMetadata(sock, sessionNumber, groupJid); } catch {}
      const gname = meta?.subject || 'the group';
      const count = meta?.participants?.length || 0;
      for (const p of participants) {
        const pJid = typeof p === 'string' ? p : (p.id || p);
        const number = String(pJid).split('@')[0].split(':')[0];
        if (action === 'add') {
          const text = `┌─ 🎉 𝐖𝐄𝐋𝐂𝐎𝐌𝐄 ─────────────\n├ 👋 Welcome to *${gname}*, @${number}!\n├ 👥 You are member #${count}\n├ 📜 Please read the group rules and enjoy your stay.\n└─────────────────────────\n© POWERED BY ${config.BOT_NAME}`;
          let pic = null;
          try { pic = await sock.profilePictureUrl(pJid, 'image'); } catch {}
          if (pic) {
            try {
              const { downloadToTmp, cleanup } = require('./net');
              const dl = await downloadToTmp(pic, { maxBytes: 5 * 1024 * 1024, ext: '.jpg' });
              const fs = require('fs');
              const buf = fs.readFileSync(dl.file);
              cleanup(dl.file);
              await send(sock, groupJid, { image: buf, caption: text, mentions: [pJid] });
              continue;
            } catch { /* fall through to text */ }
          }
          await send(sock, groupJid, { text, mentions: [pJid] });
        } else {
          const text = `┌─ 👋 𝐆𝐎𝐎𝐃𝐁𝐘𝐄 ─────────────\n├ @${number} has left *${gname}*.\n├ 👥 Members now: ${count}\n└─────────────────────────\n© POWERED BY ${config.BOT_NAME}`;
          await send(sock, groupJid, { text, mentions: [pJid] });
        }
      }
      return;
    }
    if (event === 'messages.update') {
      for (const item of payload || []) {
        const upd = item.update || {};
        const proto = upd.message?.protocolMessage;
        if (proto?.type === 0 && proto.key) await handleRevoke(sessionNumber, sock, proto.key);
        else if (proto?.type === 14 && proto.key) await handleEdit(sessionNumber, sock, proto.key, proto.editedMessage);
      }
      return;
    }
    if (event === 'call') {
      const { toggles } = await getToggles(sessionNumber);
      const s = await settings.getSettings(sessionNumber);
      if (!toggles.anticall && !s.sleepmode) return;
      for (const call of payload || []) {
        if (call.status !== 'offer') continue;
        try {
          if (typeof sock.rejectCall === 'function') await sock.rejectCall(call.id, call.from);
          await send(sock, call.from, { text: `📵 Sorry, calls are not accepted on this number right now. Please send a message instead.\n\n© ${config.BOT_NAME}` });
        } catch (e) { console.error('[automation] anticall failed:', e.message); }
      }
      return;
    }
  } catch (e) { console.error('[automation] event error:', e.message); }
}

module.exports = { onMessage, handleEvent, _send: send, BAD_WORDS, LINK_RE };
