// PRIME MD - AI commands. All of them run on lib/aiCore: the
// user's own VEXORA API first, a guarded keyless fallback second.
const config = require('../config');
const { askAi } = require('../lib/aiCore');

const FAIL = '⚠️ Sorry, the AI is busy right now. Please try again in a moment.';

function aiCommand(name, aliases, label, styleHint) {
  return {
    name, aliases, category: 'AI',
    description: `Chat with the ${label} assistant.`,
    use: `.${name} <your question>`,
    run: async (ctx) => {
      if (!ctx.argText) { await ctx.reply(`🤖 Please ask something, for example *.${name} What is the capital of Pakistan?*`); return; }
      const answer = await askAi(styleHint ? `${styleHint}\n\nQuestion: ${ctx.argText}` : ctx.argText);
      if (!answer) { await ctx.reply(FAIL); return; }
      await ctx.reply(`🤖 *${label}*\n\n${answer.slice(0, 3500)}`);
    },
  };
}

module.exports = [
  aiCommand('ai', ['chat', 'ask'], 'PRIME MD AI', ''),
  aiCommand('deepseek', [], 'DeepSeek', 'Answer in the style of the DeepSeek assistant: precise and well structured.'),
  aiCommand('copilot', [], 'Copilot', 'Answer in the style of Microsoft Copilot: friendly and practical, with clear steps when useful.'),
  aiCommand('llama', [], 'Llama', 'Answer in the style of Meta Llama: direct and concise.'),
  {
    name: 'aimode', aliases: [], category: 'AI',
    description: 'Turn AI Mode on or off for yourself. When on, the bot answers your normal messages with AI.',
    use: '.aimode on / .aimode off',
    run: async (ctx) => {
      const arg = (ctx.args[0] || '').toLowerCase();
      const current = await ctx.settings.getSettings(ctx.sessionNumber);
      const users = { ...(current.aimodeUsers || {}) };
      const mine = !!users[ctx.senderNumber];
      if (arg === 'on') {
        users[ctx.senderNumber] = true;
        await ctx.settings.setSettings(ctx.sessionNumber, { aimodeUsers: users });
        await ctx.reply('🤖 *AI Mode is ON for you.* Send any normal message (without a command) and I will answer it with AI. Send *.aimode off* to stop.');
      } else if (arg === 'off') {
        delete users[ctx.senderNumber];
        await ctx.settings.setSettings(ctx.sessionNumber, { aimodeUsers: users });
        await ctx.reply('🤖 *AI Mode is OFF for you.* I will only answer commands now.');
      } else {
        await ctx.reply(`🤖 AI Mode is currently *${mine ? 'ON' : 'OFF'}* for you.\nUse *.aimode on* or *.aimode off* to change it.`);
      }
    },
  },
];
