// PRIME MD Phase 2 offline harness (stub socket, real command code).
// Run: node tests/phase2.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const sharp = require('sharp');
const { loadCommands } = require('../lib/commandLoader');
const vvcache = require('../lib/vvcache');
const wamedia = require('../lib/wamedia');
const moviedl = require('../lib/moviedl');
const aiCore = require('../lib/aiCore');
const config = require('../config');

let passed = 0, failed = 0;
function check(name, fn) {
  try { const r = fn(); if (r && r.then) return r.then(() => { passed++; console.log('PASS', name); }).catch(e => { failed++; console.log('FAIL', name, '-', e.message); }); passed++; console.log('PASS', name); }
  catch (e) { failed++; console.log('FAIL', name, '-', e.message); }
}
async function checkAsync(name, fn) { try { await fn(); passed++; console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '-', e.message); } }

function makeSock(groups = {}) {
  const sends = [];
  return {
    sends,
    sendMessage: async (jid, payload, opts) => {
      // Consume streams like Baileys would, before callers clean tmp files.
      for (const k of ['document', 'video', 'audio', 'image']) {
        const v = payload[k];
        if (v && typeof v.pipe === 'function') { const chunks = []; for await (const c of v) chunks.push(c); payload[k] = Buffer.concat(chunks); }
      }
      sends.push({ jid, payload, opts });
      return { key: { id: 'OUT' + sends.length } };
    },
    groupFetchAllParticipating: async () => groups,
  };
}
function makeCtx(sock, over = {}) {
  return {
    sock, msg: { key: { id: 'CMD1', remoteJid: over.jid || '111@s.whatsapp.net' } },
    jid: '111@s.whatsapp.net', sessionNumber: '923138702477',
    senderJid: '923111222333@s.whatsapp.net', senderNumber: '923111222333',
    pushName: 'Tester', isGroup: false, isOwner: false, isSessionOwner: false, fromMe: false,
    args: [], argText: '', quoted: null, mentionedJids: [], targetJid: '923111222333@s.whatsapp.net',
    config, commandsApi: api, sessions: { count: () => 1 }, settings: null,
    mode: 'public', bootedAt: Date.now(), logoPath: path.join(__dirname, '..', 'assets', 'logo.png'),
    reply: (t) => sock.sendMessage(over.jid || '111@s.whatsapp.net', { text: String(t) }, {}),
    ...over,
  };
}

const api = loadCommands();
const voMsg = (id, chat, tag) => ({
  key: { id, remoteJid: chat, participant: '923111222333@s.whatsapp.net' },
  message: { viewOnceMessage: { message: { imageMessage: { url: 'https://x', fileLength: 1000, _bytes: Buffer.from(tag) } } } },
});

(async () => {
  // Media downloader stub: returns the bytes tagged onto the media content.
  wamedia._setDownloader(async (content) => {
    if (content && content._bytes) return content._bytes;
    throw new Error('stub: no bytes');
  });

  const CHAT_A = '923999000111@s.whatsapp.net';
  const CHAT_B = '923999000222@s.whatsapp.net';
  const SESS = '923138702477';

  // ---------- .vv exact-only ----------
  vvcache._clear();
  vvcache.put(SESS, voMsg('A1', CHAT_A, 'AAAA'));
  vvcache.put(SESS, voMsg('B1', CHAT_B, 'BBBB'));
  const vvCmd = api.get('vv');
  const vv2Cmd = api.get('vv2');

  await checkAsync('.vv sends the exact quoted message from the same chat', async () => {
    const sock = makeSock();
    const ctx = makeCtx(sock, { jid: CHAT_A, quoted: { stanzaId: 'A1', message: null, participant: '' } });
    await vvCmd.run(ctx);
    const media = sock.sends.find(s => s.payload.image);
    assert(media, 'no image sent');
    assert.strictEqual(media.jid, CHAT_A);
    assert.strictEqual(media.payload.image.toString(), 'AAAA');
    assert(media.payload.caption.includes('VIEW ONCE SAVED') && media.payload.caption.includes('© POWERED BY PRIME MD'), 'caption box/footer missing');
  });

  await checkAsync('.vv NEVER leaks another chat\'s media (cross-chat quote id)', async () => {
    const sock = makeSock();
    const ctx = makeCtx(sock, { jid: CHAT_A, quoted: { stanzaId: 'B1', message: null, participant: '' } });
    await vvCmd.run(ctx);
    assert(!sock.sends.some(s => s.payload.image || s.payload.video || s.payload.audio), 'media was sent - LEAK');
    assert(sock.sends.some(s => /could not find/i.test(s.payload.text || '')), 'expected a not-found reply');
  });

  await checkAsync('.vv with no quote uses the latest cached item of THIS chat', async () => {
    const sock = makeSock();
    const ctx = makeCtx(sock, { jid: CHAT_B, quoted: null });
    await vvCmd.run(ctx);
    const media = sock.sends.find(s => s.payload.image);
    assert(media && media.payload.image.toString() === 'BBBB', 'wrong media');
  });

  await checkAsync('.vv2 sends to the user DM without the footer', async () => {
    const sock = makeSock();
    const ctx = makeCtx(sock, { jid: CHAT_A, quoted: { stanzaId: 'A1', message: null, participant: '' } });
    await vv2Cmd.run(ctx);
    const media = sock.sends.find(s => s.payload.image);
    assert(media, 'no image sent');
    assert.strictEqual(media.jid, ctx.senderJid);
    assert(!media.payload.caption.includes('© POWERED BY'), 'vv2 must not carry the footer');
    assert(media.payload.caption.includes('VIEW ONCE SAVED'), 'box missing');
  });

  await checkAsync('.vv not-found path replies friendly and sends nothing', async () => {
    const sock = makeSock();
    const ctx = makeCtx(sock, { jid: '923999000999@s.whatsapp.net', sessionNumber: '900000000000', quoted: null });
    await vvCmd.run(ctx);
    assert(sock.sends.length === 1 && /could not find/i.test(sock.sends[0].payload.text || ''), 'expected single not-found reply');
  });

  // ---------- .4kstatus audience ----------
  await checkAsync('.4kstatus passes a deduped statusJidList audience and a 1080x1920 JPEG', async () => {
    const png = await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 200, g: 40, b: 40 } } }).png().toBuffer();
    const groups = {
      'g1@g.us': { participants: [{ id: '111@s.whatsapp.net' }, { id: '222@s.whatsapp.net' }] },
      'g2@g.us': { participants: [{ id: '222@s.whatsapp.net' }, { id: '333@s.whatsapp.net' }] },
    };
    const sock = makeSock(groups);
    const ctx = makeCtx(sock, {
      quoted: { stanzaId: 'S1', participant: '', message: { imageMessage: { _bytes: png } } },
    });
    await api.get('4kstatus').run(ctx);
    const statusSend = sock.sends.find(s => s.jid === 'status@broadcast');
    assert(statusSend, 'no status send');
    const list = statusSend.opts.statusJidList;
    assert(Array.isArray(list), 'statusJidList missing - status would be visible to NOBODY');
    for (const j of ['111@s.whatsapp.net', '222@s.whatsapp.net', '333@s.whatsapp.net', `${SESS}@s.whatsapp.net`, ctx.senderJid]) {
      assert(list.includes(j), `audience missing ${j}`);
    }
    assert.strictEqual(new Set(list).size, list.length, 'audience not deduped');
    const meta = await sharp(statusSend.payload.image).metadata();
    assert.strictEqual(meta.width, 1080); assert.strictEqual(meta.height, 1920); assert.strictEqual(meta.format, 'jpeg');
    assert(sock.sends.some(s => /HD photo posted/i.test(s.payload.text || '')), 'success reply only after send');
  });

  await checkAsync('.groupstatus posts text with an audience', async () => {
    const sock = makeSock({});
    const ctx = makeCtx(sock, { argText: 'Hello status', args: ['Hello', 'status'] });
    await api.get('groupstatus').run(ctx);
    const statusSend = sock.sends.find(s => s.jid === 'status@broadcast');
    assert(statusSend && statusSend.payload.text === 'Hello status', 'text status not sent');
    assert(Array.isArray(statusSend.opts.statusJidList) && statusSend.opts.statusJidList.length >= 2, 'audience missing');
  });

  // ---------- .moviedl list -> pick (stubbed Archive) ----------
  await checkAsync('.moviedl list then number pick downloads the best file', async () => {
    moviedl._setFetchJson(async (url) => {
      if (url.includes('advancedsearch')) return { response: { docs: [{ identifier: 'TestMovie2000', title: 'Test Movie', downloads: 12345 }] } };
      if (url.includes('/metadata/')) return { files: [
        { name: 'TestMovie_sample.mp4', format: 'MPEG4', size: 50 * 1024 * 1024, source: 'original' },
        { name: 'TestMovie.mp4', format: 'MPEG4', size: 700 * 1024 * 1024, source: 'original' },
        { name: 'TestMovie_512kb.mp4', format: 'MPEG4', size: 300 * 1024 * 1024, source: 'derivative' },
      ] };
      throw new Error('unexpected url ' + url);
    });
    const { tmpPath } = require('../lib/net');
    moviedl._setStreamDownload(async (url, opts) => {
      assert(url.includes('TestMovie.mp4') && !url.includes('sample'), 'wrong file picked: ' + url);
      const f = tmpPath('.mp4'); fs.writeFileSync(f, Buffer.alloc(1024, 7)); return { file: f, size: 1024 };
    });
    const sock = makeSock();
    const ctx = makeCtx(sock, { argText: 'Test Movie', args: ['Test', 'Movie'] });
    await api.get('moviedl').run(ctx);
    assert(sock.sends.some(s => /Movies found/i.test(s.payload.text || '') && /1\./.test(s.payload.text)), 'list not sent');
    const dl = require('../commands/download');
    const pickCtx = makeCtx(sock, { argText: '1', args: ['1'] });
    const handled = await dl.handleMoviePick(pickCtx);
    assert.strictEqual(handled, true);
    const doc = sock.sends.find(s => s.payload.document);
    assert(doc, 'no document sent');
    assert.strictEqual(doc.payload.fileName, 'TestMovie.mp4');
  });

  check('pickBestFile: cap and sample rules', () => {
    const files = [
      { name: 'big.mp4', format: 'MPEG4', size: 3 * 1024 * 1024 * 1024, source: 'original' },
      { name: 'trailer.mp4', format: 'MPEG4', size: 100 * 1024 * 1024, source: 'original' },
    ];
    assert.strictEqual(moviedl.pickBestFile('x', files), null);
  });

  // ---------- AI creator-context injection ----------
  check('AI prompt injects creator context for identity questions only', () => {
    const idp = aiCore.__testables.buildPrompt('Who is AR PRIME?');
    assert(idp.includes('ARPRIME456') && idp.includes('New Saeedabad') && idp.includes('AbdulRaheem'), 'creator context missing');
    const plain = aiCore.__testables.buildPrompt('What is the weather like?');
    assert(!plain.includes('ARPRIME456'), 'context should not be injected for plain questions');
    assert.strictEqual(aiCore.__testables.validateAnswer('', { identity: true }), false);
    assert.strictEqual(aiCore.__testables.validateAnswer('I do not know who that is.', { identity: true }), false);
    assert.strictEqual(aiCore.__testables.validateAnswer('AR PRIME, also known as AbdulRaheem, built it.', { identity: true }), true);
    assert.strictEqual(aiCore.__testables.validateAnswer('Paris is the capital of France.', { identity: false }), true);
  });

  // ---------- voice-note opus conversion ----------
  await checkAsync('toOpusVoice converts audio to a real ogg/opus file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prime-vvtest-'));
    const tone = path.join(dir, 'tone.mp3');
    await wamedia.runFfmpeg(['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.3', tone]);
    const ogg = path.join(dir, 'tone.ogg');
    await wamedia.toOpusVoice(tone, ogg);
    assert(fs.existsSync(ogg) && fs.statSync(ogg).size > 500, 'ogg missing/small');
    assert.strictEqual(fs.readFileSync(ogg).toString('latin1', 0, 4), 'OggS');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  console.log(`\nPhase 2 harness: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
