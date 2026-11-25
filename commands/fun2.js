// PRIME MD - Fun & Economy. XP and coins live in the settings
// layer under the session's `eco` map (keyed by user number), so levels
// and balances survive restarts. Quiz questions come from OpenTDB
// (verified live); memes from meme-api.com (verified live) with a built-in
// fallback list.
const { getJson } = require('../lib/net');

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const XP_PER_MSG = 10;
const XP_COOLDOWN_MS = 60 * 1000;
const DAILY_COINS = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

const FALLBACK_MEMES = [
  { title: 'When the code works first try', url: 'https://i.redd.it/st60qqneih3i1.png' },
];

// ---------- economy store helpers ----------
async function getEco(ctx) {
  const s = await ctx.settings.getSettings(ctx.sessionNumber);
  return { s, eco: { ...(s.eco || {}) } };
}
async function saveEco(ctx, eco) { await ctx.settings.setSettings(ctx.sessionNumber, { eco }); }
function recordOf(eco, num) { return eco[num] || { xp: 0, coins: 0, lastDaily: 0, lastXpAt: 0 }; }
function levelOf(xp) { return Math.floor(Math.sqrt(xp / 100)) + 1; }
function levelProgress(xp) {
  const lvl = levelOf(xp);
  const base = (lvl - 1) * (lvl - 1) * 100;
  const next = lvl * lvl * 100;
  return { lvl, into: xp - base, span: next - base };
}

// Award XP for ordinary (non-command) messages. Called by the index.js
// hook; cooldown-limited so farming by spam does not work.
async function awardMessageXp(settingsApi, sessionNumber, userNumber) {
  try {
    const s = await settingsApi.getSettings(sessionNumber);
    const eco = { ...(s.eco || {}) };
    const rec = recordOf(eco, userNumber);
    const now = Date.now();
    if (now - (rec.lastXpAt || 0) < XP_COOLDOWN_MS) return false;
    rec.xp = (rec.xp || 0) + XP_PER_MSG;
    rec.lastXpAt = now;
    eco[userNumber] = rec;
    await settingsApi.setSettings(sessionNumber, { eco });
    return true;
  } catch { return false; }
}

const pendingQuiz = new Map(); // `${session}|${jid}|${user}` -> { answer, timer }

const TRUTHS = [
  'What is the most embarrassing song on your playlist?',
  'What is one thing you have never told anyone?',
  'What was your most awkward moment in public?',
  'If you could swap lives with one person here for a day, who would it be and why?',
  'What is the silliest thing you are afraid of?',
  'What is the last thing you searched on your phone?',
];
const DARES = [
  'Send a voice note singing your favourite song.',
  'Type your next 3 messages in ALL CAPS.',
  'Change your profile picture to a cartoon for 1 hour.',
  'Send the 5th photo from your gallery (if it is safe to share).',
  'Speak in rhymes for the next 5 minutes.',
  'Let the group pick your status text for today.',
];
const COMPLIMENTS = [
  'You have a smile that could fix a bad day.',
  'Your energy makes every chat better.',
  'You are smarter than you give yourself credit for.',
  'The group is more fun when you are around.',
  'You have a genuinely kind heart.',
];
const INSULTS = [
  'You are proof that even Wi-Fi signals drop sometimes - mostly your brain signal.',
  'Your jokes have a loading time longer than a 2G network.',
  'You do not need a filter; you need a software update.',
  'Your brain is on power-saving mode. Permanently.',
];

module.exports = [
  {
    name: 'ship', aliases: [], category: 'Fun',
    description: 'Check the love match between you and a tagged user (just for fun).',
    use: '.ship @user',
    run: async (ctx) => {
      const target = ctx.mentionedJids?.[0] || ctx.quoted?.participant;
      if (!target) { await ctx.reply('Usage: .ship @user - tag someone to check your match.'); return; }
      const pct = Math.floor(Math.random() * 101);
      const bar = '❤️'.repeat(Math.round(pct / 20)) + '🤍'.repeat(5 - Math.round(pct / 20));
      const verdict = pct >= 80 ? 'A perfect match! 💍' : pct >= 60 ? 'A strong match! 💕' : pct >= 40 ? 'There is a spark. ✨' : pct >= 20 ? 'Just friends, probably. 🙂' : 'Run. 🏃';
      await ctx.sock.sendMessage(ctx.jid, {
        text: `💘 *Ship Result*\n@${ctx.senderNumber} + @${String(target).split('@')[0]}\n\n${bar} ${pct}%\n${verdict}`,
        mentions: [ctx.senderJid, target],
      }, { quoted: ctx.msg });
    },
  },
  {
    name: 'hack', aliases: [], category: 'Fun',
    description: 'A prank "hacking" progress joke. Completely fake and harmless.',
    use: '.hack @user',
    run: async (ctx) => {
      const target = ctx.mentionedJids?.[0] || ctx.quoted?.participant || ctx.senderJid;
      const num = String(target).split('@')[0];
      const steps = [
        `👨‍💻 Initialising prank hack on @${num}...`,
        '📡 Bypassing the firewall of pure imagination... 25%',
        '🔓 Cracking password: it was "password123"... 50%',
        '📂 Downloading embarrassing photos... 75%',
        '✅ Hack complete! Just kidding - this was a prank. No real hacking happened. 😄',
      ];
      let sent = null;
      for (const step of steps) {
        if (!sent) sent = await ctx.sock.sendMessage(ctx.jid, { text: step, mentions: [target] });
        else await ctx.sock.sendMessage(ctx.jid, { text: step, edit: sent.key, mentions: [target] }).catch(async () => { await ctx.reply(step); });
        await new Promise(r => setTimeout(r, 700));
      }
    },
  },
  {
    name: 'rate', aliases: [], category: 'Fun',
    description: 'Rate anything out of 10 (random, just for fun).',
    use: '.rate <anything>',
    run: async (ctx) => {
      if (!ctx.argText) { await ctx.reply('Usage: .rate <anything>'); return; }
      const score = Math.floor(Math.random() * 11);
      await ctx.reply(`⭐ I rate *${ctx.argText.slice(0, 60)}*: *${score}/10*`);
    },
  },
  {
    name: 'truth', aliases: [], category: 'Fun',
    description: 'Get a truth question for truth-or-dare games.',
    use: '.truth',
    run: async (ctx) => { await ctx.reply(`🤔 *Truth:* ${pick(TRUTHS)}`); },
  },
  {
    name: 'dare', aliases: [], category: 'Fun',
    description: 'Get a dare for truth-or-dare games.',
    use: '.dare',
    run: async (ctx) => { await ctx.reply(`😈 *Dare:* ${pick(DARES)}`); },
  },
  {
    name: 'compliment', aliases: [], category: 'Fun',
    description: 'Give a compliment to a tagged user, or yourself.',
    use: '.compliment [@user]',
    run: async (ctx) => {
      const target = ctx.mentionedJids?.[0] || ctx.quoted?.participant || ctx.senderJid;
      await ctx.sock.sendMessage(ctx.jid, { text: `💐 @${String(target).split('@')[0]}, ${pick(COMPLIMENTS)}`, mentions: [target] }, { quoted: ctx.msg });
    },
  },
  {
    name: 'insult', aliases: [], category: 'Fun',
    description: 'A light, friendly roast for a tagged user. All in good fun.',
    use: '.insult [@user]',
    run: async (ctx) => {
      const target = ctx.mentionedJids?.[0] || ctx.quoted?.participant || ctx.senderJid;
      await ctx.sock.sendMessage(ctx.jid, { text: `🔥 @${String(target).split('@')[0]}, ${pick(INSULTS)}`, mentions: [target] }, { quoted: ctx.msg });
    },
  },
  {
    name: 'meme', aliases: [], category: 'Fun',
    description: 'Fetch a fresh meme (meme-api.com, with a built-in fallback).',
    use: '.meme',
    run: async (ctx) => {
      try {
        const data = await getJson('https://meme-api.com/gimme');
        if (!data?.url || data.nsfw) throw new Error('bad meme');
        await ctx.sock.sendMessage(ctx.jid, { image: { url: data.url }, caption: `😂 ${data.title || 'Meme'} (r/${data.subreddit || 'memes'})` }, { quoted: ctx.msg });
      } catch {
        const m = pick(FALLBACK_MEMES);
        try { await ctx.sock.sendMessage(ctx.jid, { image: { url: m.url }, caption: `😂 ${m.title}` }, { quoted: ctx.msg }); }
        catch { await ctx.reply('⚠️ Sorry, no meme could be loaded right now. Please try again in a moment.'); }
      }
    },
  },
  {
    name: 'level', aliases: ['rank'], category: 'Economy',
    description: 'See your XP level and coin balance. You earn XP by chatting (once a minute).',
    use: '.level [@user]',
    run: async (ctx) => {
      const { eco } = await getEco(ctx);
      const targetNum = (ctx.mentionedJids?.[0] || ctx.quoted?.participant || ctx.senderJid).split('@')[0];
      const rec = recordOf(eco, targetNum);
      const { lvl, into, span } = levelProgress(rec.xp || 0);
      const filled = Math.min(10, Math.floor((into / span) * 10));
      await ctx.reply(
        `🏆 *Level Card*\n👤 @${targetNum}\n⭐ Level: *${lvl}*\n✨ XP: ${rec.xp || 0} (${into}/${span} to next level)\n${'█'.repeat(filled)}${'░'.repeat(10 - filled)}\n🪙 Coins: ${rec.coins || 0}`
      );
    },
  },
  {
    name: 'daily', aliases: [], category: 'Economy',
    description: `Claim your daily reward of ${DAILY_COINS} coins (once every 24 hours).`,
    use: '.daily',
    run: async (ctx) => {
      const { eco } = await getEco(ctx);
      const rec = recordOf(eco, ctx.senderNumber);
      const now = Date.now();
      if (now - (rec.lastDaily || 0) < DAY_MS) {
        const left = DAY_MS - (now - rec.lastDaily);
        const h = Math.floor(left / 3600000), m = Math.floor((left % 3600000) / 60000);
        await ctx.reply(`⏳ You already claimed today's reward. Come back in ${h}h ${m}m.`);
        return;
      }
      rec.coins = (rec.coins || 0) + DAILY_COINS;
      rec.lastDaily = now;
      eco[ctx.senderNumber] = rec;
      await saveEco(ctx, eco);
      await ctx.reply(`🎁 Daily reward claimed: *+${DAILY_COINS} coins*\n🪙 Your balance: ${rec.coins} coins`);
    },
  },
  {
    name: 'balance', aliases: ['bal'], category: 'Economy',
    description: 'Check your coin balance.',
    use: '.balance',
    run: async (ctx) => {
      const { eco } = await getEco(ctx);
      const rec = recordOf(eco, ctx.senderNumber);
      await ctx.reply(`🪙 *Your balance:* ${rec.coins || 0} coins\n⭐ XP: ${rec.xp || 0} (Level ${levelOf(rec.xp || 0)})`);
    },
  },
  {
    name: 'give', aliases: [], category: 'Economy',
    description: 'Give some of your coins to a tagged user.',
    use: '.give @user <amount>',
    run: async (ctx) => {
      const target = ctx.mentionedJids?.[0] || ctx.quoted?.participant;
      const amount = parseInt(ctx.args.find(a => /^\d+$/.test(a)), 10);
      if (!target || !amount || amount <= 0) { await ctx.reply('Usage: .give @user <amount>'); return; }
      const targetNum = String(target).split('@')[0];
      if (targetNum === ctx.senderNumber) { await ctx.reply('You cannot give coins to yourself.'); return; }
      const { eco } = await getEco(ctx);
      const mine = recordOf(eco, ctx.senderNumber);
      if ((mine.coins || 0) < amount) { await ctx.reply(`⚠️ You only have ${mine.coins || 0} coins. Earn more with .daily and .quiz`); return; }
      const theirs = recordOf(eco, targetNum);
      mine.coins -= amount;
      theirs.coins = (theirs.coins || 0) + amount;
      eco[ctx.senderNumber] = mine;
      eco[targetNum] = theirs;
      await saveEco(ctx, eco);
      await ctx.sock.sendMessage(ctx.jid, {
        text: `🪙 @${ctx.senderNumber} gave *${amount} coins* to @${targetNum}.\nYour new balance: ${mine.coins} coins`,
        mentions: [ctx.senderJid, target],
      }, { quoted: ctx.msg });
    },
  },
  {
    name: 'quiz', aliases: ['trivia'], category: 'Economy',
    description: 'Answer a trivia question to earn 10 coins. Reply with the correct option text.',
    use: '.quiz, then reply with your answer',
    run: async (ctx) => {
      const key = `${ctx.sessionNumber}|${ctx.jid}|${ctx.senderNumber}`;
      // A pending question for this user? Treat this message... no - answers
      // arrive as quoted replies handled below; a fresh .quiz replaces it.
      try {
        const data = await getJson('https://opentdb.com/api.php?amount=1&type=multiple');
        const q = data?.results?.[0];
        if (!q) throw new Error('no question');
        const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&eacute;/g, 'é');
        const options = [...q.incorrect_answers.map(decode), decode(q.correct_answer)].sort(() => Math.random() - 0.5);
        const old = pendingQuiz.get(key);
        if (old) clearTimeout(old.timer);
        const timer = setTimeout(() => pendingQuiz.delete(key), 120 * 1000);
        timer.unref?.();
        pendingQuiz.set(key, { answer: decode(q.correct_answer).toLowerCase(), options: options.map(o => o.toLowerCase()), timer });
        let out = `❓ *Quiz* (${decode(q.category)} - ${q.difficulty})\n\n${decode(q.question)}\n`;
        options.forEach((o, i) => { out += `\n${['A', 'B', 'C', 'D'][i]}. ${o}`; });
        out += '\n\nReply to this message with the correct answer (the text or its letter) within 2 minutes to win 10 coins.';
        await ctx.reply(out);
      } catch { await ctx.reply('⚠️ Sorry, a quiz question could not be loaded right now. Please try again.'); }
    },
  },
];

// Called by the index.js hook for non-command messages. If this user has a
// pending quiz question in this chat and the message text matches one of
// the options (or its letter A-D), it is judged: +10 coins for a correct
// answer. Returns true when the message was consumed as a quiz answer.
async function tryQuizAnswer(ctx) {
  const key = `${ctx.sessionNumber}|${ctx.jid}|${ctx.senderNumber}`;
  const pending = pendingQuiz.get(key);
  if (!pending) return false;
  const guess = String(ctx.argText || '').trim().toLowerCase();
  if (!guess) return false;
  const letters = { a: 0, b: 1, c: 2, d: 3 };
  let chosen = null;
  if (guess.length === 1 && letters[guess] !== undefined) chosen = pending.options[letters[guess]];
  else if (pending.options.includes(guess)) chosen = guess;
  if (chosen === null) return false; // not an answer attempt - ignore
  clearTimeout(pending.timer);
  pendingQuiz.delete(key);
  if (chosen === pending.answer) {
    const s = await ctx.settings.getSettings(ctx.sessionNumber);
    const eco = { ...(s.eco || {}) };
    const rec = recordOf(eco, ctx.senderNumber);
    rec.coins = (rec.coins || 0) + 10;
    eco[ctx.senderNumber] = rec;
    await ctx.settings.setSettings(ctx.sessionNumber, { eco });
    await ctx.reply(`🎉 Correct! The answer was *${pending.answer}*.\n🪙 +10 coins - your balance is now ${rec.coins} coins.`);
  } else {
    await ctx.reply(`❌ Not quite. The correct answer was *${pending.answer}*.`);
  }
  return true;
}

module.exports.awardMessageXp = awardMessageXp;
module.exports.tryQuizAnswer = tryQuizAnswer;
module.exports._pendingQuiz = pendingQuiz;
module.exports._levelOf = levelOf;
