// PRIME MD Phase 3 offline harness (stub socket, real command/hook code).
// Run: node tests/phase3.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { loadCommands } = require('../lib/commandLoader');
const settings = require('../lib/settings');
const groupUtil = require('../lib/groupUtil');
const msgstore = require('../lib/msgstore');
const automation = require('../lib/automation');
const stickerLib = require('../lib/sticker');
const fun2 = require('../commands/fun2');
const mediaCmds = require('../commands/media');
const config = require('../config');

const api = loadCommands();
const SESS = '900000000099'; // fake session - cleaned out of settings.json at the end
const GROUP = '120363000000000001@g.us';
const BOT_JID = `${SESS}@s.whatsapp.net`;
const ADMIN = '923111222333@s.whatsapp.net';
const USER1 = '923444555666@s.whatsapp.net';
const USER2 = '923777888999@s.whatsapp.net';
const NEWBIE = '923000111222@s.whatsapp.net';

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log('PASS', name); }
  catch (e) { failed++; console.log('FAIL', name, '-', e.message); }
}

function makeSock() {
  const sent = [];
  const calls = { participantsUpdate: [], settingUpdate: [] };
  const meta = {
    id: GROUP, subject: 'Test Group', owner: ADMIN, creation: 1700000000, desc: 'A test group',
    participants: [
      { id: BOT_JID, admin: 'admin' },
      { id: ADMIN, admin: 'admin' },
      { id: USER1 }, { id: USER2 }, { id: NEWBIE },
    ],
  };
  const sock = {
    sent, calls, meta,
    sendMessage: async (jid, payload, opts) => { const m = { jid, payload, opts }; sent.push(m); return { key: { id: 'OUT' + sent.length } }; },
    groupMetadata: async () => meta,
    groupParticipantsUpdate: async (jid, parts, action) => { calls.participantsUpdate.push({ jid, parts, action }); return parts.map(() => ({ status: 200 })); },
    groupSettingUpdate: async (jid, setting) => { calls.settingUpdate.push(setting); },
    groupInviteCode: async () => 'TESTINVITECODE123456',
    profilePictureUrl: async () => { throw new Error('no picture'); },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    rejectCall: async () => {},
    fetchBlocklist: async () => [],
  };
  return sock;
}
function makeCtx(sock, over = {}) {
  const jid = over.jid || GROUP;
  return {
    sock, msg: { key: { id: 'CMD' + Math.random().toString(36).slice(2, 8), remoteJid: jid } },
    jid, sessionNumber: SESS,
    senderJid: ADMIN, senderNumber: ADMIN.split('@')[0],
    pushName: 'Tester', isGroup: jid.endsWith('@g.us'), isOwner: false, isSessionOwner: false, fromMe: false,
    args: [], argText: '', quoted: null, mentionedJids: [], targetJid: ADMIN,
    config, commandsApi: api, sessions: { count: () => 1 }, settings,
    mode: 'public', bootedAt: Date.now(), logoPath: path.join(__dirname, '..', 'assets', 'logo.png'),
    reply: (t) => sock.sendMessage(jid, { text: String(t) }, {}),
    ...over,
  };
}
const texts = (sock) => sock.sent.filter(s => s.payload.text).map(s => s.payload.text).join('\n');

(async () => {
  // ---------- welcome event ----------
  await check('welcome fires on participant add with mention + member count', async () => {
    await groupUtil.setGroupSetting(settings, SESS, GROUP, { welcome: true });
    const sock = makeSock();
    await automation.handleEvent(SESS, sock, 'group-participants.update', { id: GROUP, participants: [NEWBIE], action: 'add' });
    const welcome = sock.sent.find(s => s.jid === GROUP && /Welcome to/.test(s.payload.text || s.payload.caption || ''));
    assert(welcome, 'no welcome message sent');
    const body = welcome.payload.text || welcome.payload.caption;
    assert(body.includes('@923000111222'), 'new member not mentioned in text');
    assert(body.includes('member #5'), 'member count missing: ' + body);
    assert((welcome.payload.mentions || []).includes(NEWBIE), 'mentions array missing the new member');
    assert(body.includes('PRIME MD'), 'branding missing');
  });

  await check('goodbye stays silent while its toggle is off', async () => {
    const sock = makeSock();
    await automation.handleEvent(SESS, sock, 'group-participants.update', { id: GROUP, participants: [NEWBIE], action: 'remove' });
    assert.strictEqual(sock.sent.length, 0);
  });

  // ---------- warn x3 = kick ----------
  await check('warn: 3rd warning removes the member', async () => {
    const sock = makeSock();
    const warn = api.get('warn');
    for (let i = 0; i < 3; i++) {
      const ctx = makeCtx(sock, { mentionedJids: [USER2], targetJid: USER2, args: ['@923777888999'] });
      await warn.run(ctx);
    }
    const removes = sock.calls.participantsUpdate.filter(c => c.action === 'remove' && c.parts.includes(USER2));
    assert.strictEqual(removes.length, 1, 'expected exactly one remove call, got ' + JSON.stringify(sock.calls.participantsUpdate));
    assert(texts(sock).includes('(1/3)') && texts(sock).includes('(2/3)'), 'warn counts not reported');
    assert.strictEqual(await groupUtil.getWarns(settings, SESS, GROUP, USER2.split('@')[0]), 0, 'warns not reset after kick');
  });

  // ---------- antilink moderation ----------
  await check('antilink deletes a link from a non-admin but not from an admin', async () => {
    await groupUtil.setGroupSetting(settings, SESS, GROUP, { antilink: true });
    const linkMsg = (participant) => ({
      key: { id: 'L' + participant, remoteJid: GROUP, participant },
      message: { conversation: 'join us https://example.com now' },
      pushName: 'Someone',
    });
    const sockA = makeSock();
    await automation.onMessage(SESS, sockA, linkMsg(USER1));
    assert(sockA.sent.some(s => s.payload.delete), 'non-admin link was NOT deleted');
    const sockB = makeSock();
    await automation.onMessage(SESS, sockB, linkMsg(ADMIN));
    assert(!sockB.sent.some(s => s.payload.delete), 'admin link was wrongly deleted');
  });

  // ---------- sticker pipeline ----------
  await check('sticker pipeline produces a real webp buffer with pack exif', async () => {
    const png = await sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 1 } } }).png().toBuffer();
    const sticker = await stickerLib.imageToSticker(png);
    assert.strictEqual(sticker.subarray(0, 4).toString(), 'RIFF');
    assert.strictEqual(sticker.subarray(8, 12).toString(), 'WEBP');
    assert(sticker.includes(Buffer.from('sticker-pack-name')), 'exif pack name missing');
    assert(sticker.includes(Buffer.from('PRIME MD')), 'pack name PRIME MD missing');
    const meta = await sharp(sticker).metadata();
    assert.strictEqual(meta.format, 'webp');
    assert.strictEqual(meta.width, 512);
  });

  await check('attp text rendering produces a sticker', async () => {
    const sticker = await stickerLib.textToSticker('HELLO PRIME');
    assert.strictEqual(sticker.subarray(8, 12).toString(), 'WEBP');
    const meta = await sharp(sticker).metadata();
    assert.strictEqual(meta.format, 'webp');
  });

  // ---------- economy: XP ----------
  await check('XP increments once, then the cooldown blocks the second award', async () => {
    const user = '923555000111';
    const first = await fun2.awardMessageXp(settings, SESS, user);
    const second = await fun2.awardMessageXp(settings, SESS, user);
    assert.strictEqual(first, true);
    assert.strictEqual(second, false, 'cooldown did not block the second award');
    const s = await settings.getSettings(SESS);
    assert.strictEqual(s.eco[user].xp, 10);
    assert.strictEqual(fun2._levelOf(0), 1);
    assert.strictEqual(fun2._levelOf(100), 2);
  });

  // ---------- economy: daily ----------
  await check('daily claim works once and is refused the second time', async () => {
    const sock = makeSock();
    const daily = api.get('daily');
    const ctx = makeCtx(sock, { jid: USER1, senderJid: USER1, senderNumber: USER1.split('@')[0] });
    await daily.run(ctx);
    await daily.run(ctx);
    const all = texts(sock);
    assert(all.includes('+100 coins'), 'first claim did not pay out');
    assert(all.includes('already claimed'), 'second claim was not refused');
    const s = await settings.getSettings(SESS);
    assert.strictEqual(s.eco[USER1.split('@')[0]].coins, 100);
  });

  // ---------- quiz answer flow ----------
  await check('quiz answer flow awards 10 coins for a correct answer', async () => {
    const sock = makeSock();
    const userNum = USER2.split('@')[0];
    const key = `${SESS}|${USER1}|${userNum}`;
    const timer = setTimeout(() => {}, 60000); timer.unref();
    fun2._pendingQuiz.set(key, { answer: 'paris', options: ['london', 'paris', 'rome', 'berlin'], timer });
    const ctx = makeCtx(sock, {
      jid: USER1, senderJid: USER2, senderNumber: userNum,
      argText: 'Paris', args: ['Paris'],
      quoted: { stanzaId: 'Q1', message: null, participant: BOT_JID },
    });
    const consumed = await fun2.tryQuizAnswer(ctx);
    assert.strictEqual(consumed, true);
    const s = await settings.getSettings(SESS);
    assert.strictEqual(s.eco[userNum].coins, 10, 'coins not awarded: ' + JSON.stringify(s.eco[userNum]));
    assert(texts(sock).includes('Correct!'), 'no correct-answer reply');
    // A wrong answer is judged too and pays nothing.
    const timer2 = setTimeout(() => {}, 60000); timer2.unref();
    fun2._pendingQuiz.set(key, { answer: 'paris', options: ['london', 'paris', 'rome', 'berlin'], timer: timer2 });
    const ctx2 = makeCtx(sock, { jid: USER1, senderJid: USER2, senderNumber: userNum, argText: 'london', args: ['london'], quoted: { stanzaId: 'Q2', message: null, participant: BOT_JID } });
    assert.strictEqual(await fun2.tryQuizAnswer(ctx2), true);
    const s2 = await settings.getSettings(SESS);
    assert.strictEqual(s2.eco[userNum].coins, 10, 'wrong answer changed the balance');
  });

  // ---------- antidelete store + revoke flow ----------
  await check('antidelete store keeps and returns the exact stored message', async () => {
    msgstore._clear();
    const msg = {
      key: { id: 'M1', remoteJid: GROUP, participant: USER1 },
      message: { conversation: 'the exact secret text' },
      pushName: 'Sender One',
    };
    msgstore.put(SESS, msg);
    const entry = msgstore.get(SESS, 'M1');
    assert(entry, 'entry missing');
    assert.strictEqual(entry.text, 'the exact secret text');
    assert.strictEqual(entry.chatJid, GROUP);
  });

  await check('antidelete revoke event re-sends the stored message to the owner DM', async () => {
    await settings.setSettings(SESS, { toggles: { antidelete: true } });
    const sock = makeSock();
    await automation.handleEvent(SESS, sock, 'messages.update', [{
      key: { id: 'UPD1', remoteJid: GROUP },
      update: { message: { protocolMessage: { type: 0, key: { id: 'M1', remoteJid: GROUP, participant: USER1 } } } },
    }]);
    const dm = sock.sent.find(s => s.jid === BOT_JID && /Deleted message recovered/.test(s.payload.text || ''));
    assert(dm, 'no recovery DM sent: ' + JSON.stringify(sock.sent.map(x => x.payload)));
    assert(dm.payload.text.includes('the exact secret text'), 'stored text missing from the DM');
    assert.strictEqual(msgstore.get(SESS, 'M1'), null, 'entry should be consumed after recovery');
  });

  // ---------- emojimix ----------
  await check('emojimix known combo resolves OR fails gracefully', async () => {
    const found = await mediaCmds._fetchKitchen('😀', '🤩');
    if (found) {
      assert.strictEqual(found.buffer.subarray(1, 4).toString(), 'PNG', 'kitchen result is not a PNG');
      assert(/emojikitchen\/\d{8}\/u1f600\/u1f600_u1f929\.png$/.test(found.url), 'unexpected kitchen URL: ' + found.url);
      console.log('      (live combo found: ' + found.url + ')');
    } else {
      console.log('      (no live combo this run - graceful null accepted)');
    }
    const none = await mediaCmds._fetchKitchen('🦄', '🦄');
    assert(none === null || Buffer.isBuffer(none.buffer), 'unknown combo must fail gracefully');
  });

  // ---------- notes persistence across a settings reload ----------
  await check('notes survive a settings reload (file-backed store)', async () => {
    const sock = makeSock();
    const note = api.get('note');
    const ctx = makeCtx(sock, { jid: USER1, senderJid: USER1, senderNumber: USER1.split('@')[0], argText: 'remember the milk', args: ['remember', 'the', 'milk'] });
    await note.run(ctx);
    assert(texts(sock).includes('Note saved'), 'note command did not confirm');
    // Simulate a restart: drop the module from the require cache and reload.
    for (const p of ['../lib/settings', '../lib/mongo']) { try { delete require.cache[require.resolve(p)]; } catch {} }
    const freshSettings = require('../lib/settings');
    const s = await freshSettings.getSettings(SESS);
    assert((s.notes || []).some(n => n.text === 'remember the milk'), 'note missing after reload: ' + JSON.stringify(s.notes));
  });

  // Cleanup: remove the fake session from the persisted settings file.
  try {
    const file = path.join(__dirname, '..', 'data', 'settings.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete data[SESS];
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch {}

  console.log(`\nPhase 3 harness: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
