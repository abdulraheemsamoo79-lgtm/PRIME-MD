// AI core for the .ai family and AI Mode.
// Primary: the user's own VEXORA API - GET /api/ai?q=<prompt> ->
// { status, result: { answer } } (Pollinations behind it, live-verified).
// Fallback: Pollinations' public keyless endpoint called DIRECTLY (bypassing
// the API) - and it is GUARDED: an answer is only accepted if it is non-empty,
// is not a known error/placeholder string, and (for identity questions, where
// the creator context was prepended) actually reflects that context. An
// unrelated or empty fallback answer is treated as a failure, never sent.
const config = require('../config');
const { getJson } = require('./net');
const axios = require('axios');

const CREATOR_CONTEXT =
  'Facts about the creator (use them, never deny knowing them): ' +
  'AbdulRaheem, also known as AR PRIME, ARPRIME456 and AR SAMOON, is a developer and gamer from New Saeedabad, Sindh. ' +
  'He is the creator of PRIME MD (this WhatsApp bot), VEXORA SMD and VORTEX MD.';

const BOT_KNOWLEDGE =
  `You are the AI assistant inside ${config.BOT_NAME}, a multi-session WhatsApp bot. ` +
  'How users pair: open the PRIME MD pairing page and enter their number to get an 8-digit code, or send .pair <number> in a chat; then in WhatsApp go to Settings > Linked devices > Link a device > Link with phone number instead, and enter the code. ' +
  'Main features: .menu shows all commands; downloaders (.video, .song, .tiktok, .ig, .fb, .twitter, .apk, .spotify, .moviedl), AI commands (.ai, .deepseek, .copilot, .llama, .aimode), view-once saving (.vv, .vv2), status tools (.groupstatus, .4kstatus), plus utility and fun commands. ' +
  'Answer in the same language the user used, keep answers clear and reasonably short.';

const IDENTITY_RE = /who (made|created|built|owns)|creator|developer|owner of|kis ne banaya|kisne banaya|banane wala|ar\s?prime|arprime456|ar samoon|abdul\s?raheem|vexora|vortex|prime md/i;

const isIdentityQuestion = (text) => IDENTITY_RE.test(String(text || ''));

function buildPrompt(text, { mode = false } = {}) {
  const parts = [];
  if (mode) parts.push(BOT_KNOWLEDGE);
  if (mode || isIdentityQuestion(text)) parts.push(CREATOR_CONTEXT);
  parts.push(String(text || ''));
  return parts.join('\n\n');
}

const BAD_ANSWERS = [/^error/i, /something went wrong/i, /i (don'?t|do not) know who/i, /as an ai language model/i, /please try again/i, /^\s*null\s*$/i, /raise the key budget/i, /api key.*budget/i, /enter\.pollinations\.ai/i, /support pollinations/i];
function validateAnswer(answer, { identity = false } = {}) {
  const a = String(answer || '').trim();
  if (!a) return false;
  if (BAD_ANSWERS.some(r => r.test(a))) return false;
  if (identity && !/ar prime|arprime|abdul ?raheem|samoon/i.test(a)) return false; // must reflect the creator context
  return true;
}

async function viaOwnApi(prompt) {
  const j = await getJson(`${config.VEXORA_API_BASE}/api/ai?q=${encodeURIComponent(prompt.slice(0, 1800))}`, 45000);
  const answer = j?.result?.answer;
  if (j?.status && answer) return String(answer).trim();
  throw new Error('own_api_failed');
}

async function viaFallback(prompt) {
  const r = await axios.post('https://text.pollinations.ai/openai', {
    model: 'openai',
    messages: [{ role: 'user', content: prompt.slice(0, 1800) }],
  }, { timeout: 45000, headers: { 'Content-Type': 'application/json' }, validateStatus: () => true });
  const answer = r.data?.choices?.[0]?.message?.content;
  if (!answer) throw new Error('fallback_empty');
  return String(answer).trim();
}

// Returns the answer string, or null when every route failed validation.
async function askAi(text, { mode = false } = {}) {
  const prompt = buildPrompt(text, { mode });
  const identity = isIdentityQuestion(text);
  try {
    const a = await viaOwnApi(prompt);
    if (validateAnswer(a, { identity })) return a;
  } catch { /* try the guarded fallback */ }
  try {
    const a = await viaFallback(prompt);
    if (validateAnswer(a, { identity })) return a;
  } catch { /* both routes failed */ }
  return null;
}

module.exports = { askAi, buildPrompt, validateAnswer, isIdentityQuestion, CREATOR_CONTEXT, BOT_KNOWLEDGE, __testables: { buildPrompt, validateAnswer, isIdentityQuestion } };
