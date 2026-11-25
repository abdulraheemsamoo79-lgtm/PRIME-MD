// PRIME MD - Fun commands (local content, no network needed)
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const JOKES = [
  'Why do programmers prefer dark mode? Because light attracts bugs.',
  'I told my computer I needed a break, and now it will not stop sending me Kit Kat ads.',
  'Why did the scarecrow win an award? Because he was outstanding in his field.',
  'What do you call a fish without eyes? A fsh.',
  'Why did the math book look sad? It had too many problems.',
  'How does a penguin build its house? Igloos it together.',
  'Why did the bicycle fall over? It was two tired.',
  'What did one wall say to the other? I will meet you at the corner.',
  'Why do cows have hooves instead of feet? Because they lactose.',
  'What do you call cheese that is not yours? Nacho cheese.',
];
const FACTS = [
  'Honey never spoils. Archaeologists found 3,000-year-old honey in Egyptian tombs that was still edible.',
  'Octopuses have three hearts and blue blood.',
  'The first computer bug was a real moth found in a Harvard computer in 1947.',
  'Bananas are berries, but strawberries are not - botanically speaking.',
  'There are more possible chess games than atoms in the observable universe.',
  'A day on Venus is longer than a year on Venus.',
  'The human nose can remember around 50,000 different scents.',
  'Sea otters hold hands while they sleep so they do not drift apart.',
  'The dot over the letter i and j is called a tittle.',
  'WhatsApp was founded in 2009 by Jan Koum and Brian Acton.',
];
const QUOTES = [
  '"The best way to predict the future is to create it." - Peter Drucker',
  '"Success is not final, failure is not fatal: it is the courage to continue that counts." - Winston Churchill',
  '"Do not watch the clock; do what it does. Keep going." - Sam Levenson',
  '"Everything you have ever wanted is on the other side of fear." - George Addair',
  '"Hardships often prepare ordinary people for an extraordinary destiny." - C.S. Lewis',
  '"Believe you can and you are halfway there." - Theodore Roosevelt',
  '"It always seems impossible until it is done." - Nelson Mandela',
  '"Quality is not an act, it is a habit." - Aristotle',
];

module.exports = [
  {
    name: 'coin', aliases: ['flip'], category: 'Fun',
    description: 'Flip a coin.', use: '.coin',
    run: async (ctx) => { await ctx.reply(`🪙 The coin landed on: *${Math.random() < 0.5 ? 'Heads' : 'Tails'}*`); },
  },
  {
    name: 'dice', aliases: ['roll'], category: 'Fun',
    description: 'Roll a dice (1-6, or .dice 20 for a bigger one).', use: '.dice / .dice 20',
    run: async (ctx) => {
      let sides = parseInt(ctx.args[0] || '6', 10);
      if (Number.isNaN(sides)) sides = 6;
      sides = Math.min(1000, Math.max(2, sides));
      await ctx.reply(`🎲 You rolled a *${1 + Math.floor(Math.random() * sides)}* (dice of ${sides})`);
    },
  },
  {
    name: 'joke', aliases: [], category: 'Fun',
    description: 'Get a random clean joke.', use: '.joke',
    run: async (ctx) => { await ctx.reply(`😂 ${pick(JOKES)}`); },
  },
  {
    name: 'fact', aliases: [], category: 'Fun',
    description: 'Get a random interesting fact.', use: '.fact',
    run: async (ctx) => { await ctx.reply(`🧠 *Did you know?*\n${pick(FACTS)}`); },
  },
  {
    name: 'quote', aliases: [], category: 'Fun',
    description: 'Get a random motivational quote.', use: '.quote',
    run: async (ctx) => { await ctx.reply(`💬 ${pick(QUOTES)}`); },
  },
  {
    name: 'choose', aliases: [], category: 'Fun',
    description: 'Let the bot choose between options separated by "or".', use: '.choose tea or coffee',
    run: async (ctx) => {
      const parts = ctx.argText.split(/\s+or\s+/i).map(s => s.trim()).filter(Boolean);
      if (parts.length < 2) { await ctx.reply('Give me at least two options separated by "or", for example *.choose tea or coffee*'); return; }
      await ctx.reply(`🤔 I choose: *${pick(parts)}*`);
    },
  },
];
