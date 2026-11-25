// PRIME MD - Utility 2. Every external source here was verified
// live during the build (see BUILD-PHASE3.md): VEXORA API weather (+ wttr.in
// fallback), BBC/Dawn RSS, CoinGecko, DictionaryAPI, Wikipedia, is.gd,
// MyMemory, thum.io, open.er-api, World Bank (REST Countries is
// deprecated - its API now returns a deprecation error). .imdb/.movie were left
// out on purpose: every keyless IMDb source failed live (imdbot 500,
// imdbapi.dev unreachable) and results must never be faked.
const axios = require('axios');
const config = require('../config');
const { getJson, UA } = require('../lib/net');

async function getText(url, timeoutMs = 20000) {
  const r = await axios.get(url, { timeout: timeoutMs, headers: UA, validateStatus: () => true, responseType: 'text' });
  if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
  return String(r.data);
}

const COIN_IDS = {
  btc: 'bitcoin', bitcoin: 'bitcoin', eth: 'ethereum', ethereum: 'ethereum',
  sol: 'solana', solana: 'solana', xrp: 'ripple', ripple: 'ripple',
  doge: 'dogecoin', dogecoin: 'dogecoin', ada: 'cardano', cardano: 'cardano',
  bnb: 'binancecoin', usdt: 'tether', tether: 'tether', trx: 'tron', tron: 'tron',
  ltc: 'litecoin', litecoin: 'litecoin', dot: 'polkadot', polkadot: 'polkadot',
  matic: 'matic-network', shib: 'shiba-inu', 'shiba-inu': 'shiba-inu',
};

const ELEMENTS = {
  h: [1, 'Hydrogen', '1.008', 'Nonmetal'], he: [2, 'Helium', '4.003', 'Noble gas'], li: [3, 'Lithium', '6.94', 'Alkali metal'],
  be: [4, 'Beryllium', '9.012', 'Alkaline earth metal'], b: [5, 'Boron', '10.81', 'Metalloid'], c: [6, 'Carbon', '12.011', 'Nonmetal'],
  n: [7, 'Nitrogen', '14.007', 'Nonmetal'], o: [8, 'Oxygen', '15.999', 'Nonmetal'], f: [9, 'Fluorine', '18.998', 'Halogen'],
  ne: [10, 'Neon', '20.180', 'Noble gas'], na: [11, 'Sodium', '22.990', 'Alkali metal'], mg: [12, 'Magnesium', '24.305', 'Alkaline earth metal'],
  al: [13, 'Aluminium', '26.982', 'Post-transition metal'], si: [14, 'Silicon', '28.085', 'Metalloid'], p: [15, 'Phosphorus', '30.974', 'Nonmetal'],
  s: [16, 'Sulfur', '32.06', 'Nonmetal'], cl: [17, 'Chlorine', '35.45', 'Halogen'], ar: [18, 'Argon', '39.948', 'Noble gas'],
  k: [19, 'Potassium', '39.098', 'Alkali metal'], ca: [20, 'Calcium', '40.078', 'Alkaline earth metal'], fe: [26, 'Iron', '55.845', 'Transition metal'],
  co: [27, 'Cobalt', '58.933', 'Transition metal'], ni: [28, 'Nickel', '58.693', 'Transition metal'], cu: [29, 'Copper', '63.546', 'Transition metal'],
  zn: [30, 'Zinc', '65.38', 'Transition metal'], br: [35, 'Bromine', '79.904', 'Halogen'], ag: [47, 'Silver', '107.868', 'Transition metal'],
  sn: [50, 'Tin', '118.710', 'Post-transition metal'], i: [53, 'Iodine', '126.904', 'Halogen'], ba: [56, 'Barium', '137.327', 'Alkaline earth metal'],
  pt: [78, 'Platinum', '195.084', 'Transition metal'], au: [79, 'Gold', '196.967', 'Transition metal'], hg: [80, 'Mercury', '200.592', 'Transition metal'],
  pb: [82, 'Lead', '207.2', 'Post-transition metal'], u: [92, 'Uranium', '238.029', 'Actinide'],
};
const ELEMENT_BY_NAME = {};
for (const [sym, [num, name, mass, cat]] of Object.entries(ELEMENTS)) ELEMENT_BY_NAME[name.toLowerCase()] = [sym, num, name, mass, cat];

module.exports = [
  {
    name: 'weather', aliases: [], category: 'Utility',
    description: 'Get the current weather for a city (VEXORA API first, wttr.in fallback).',
    use: '.weather <city>',
    run: async (ctx) => {
      const city = ctx.argText?.trim();
      if (!city) { await ctx.reply('Usage: .weather <city>'); return; }
      try {
        const data = await getJson(`${config.VEXORA_API_BASE}/api/weather?q=${encodeURIComponent(city)}`);
        const r = data.result;
        if (!data.status || !r) throw new Error('bad shape');
        await ctx.reply(`🌦️ *Weather - ${r.city}, ${r.country}*\n🌡️ Temperature: ${r.temperature}°C (feels like ${r.feels_like}°C)\n☀️ Condition: ${r.condition}\n💧 Humidity: ${r.humidity}%\n💨 Wind: ${r.wind_speed} m/s\n📈 High: ${r.temp_max}°C  📉 Low: ${r.temp_min}°C\n🌅 Sunrise: ${String(r.sunrise).slice(11, 16)}  🌇 Sunset: ${String(r.sunset).slice(11, 16)}`);
        return;
      } catch { /* fall through to wttr.in */ }
      try {
        const data = await getJson(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
        const c = data.current_condition?.[0];
        const area = data.nearest_area?.[0];
        if (!c) throw new Error('bad shape');
        await ctx.reply(`🌦️ *Weather - ${area?.areaName?.[0]?.value || city}, ${area?.country?.[0]?.value || ''}*\n🌡️ Temperature: ${c.temp_C}°C (feels like ${c.FeelsLikeC}°C)\n☀️ Condition: ${c.weatherDesc?.[0]?.value}\n💧 Humidity: ${c.humidity}%\n💨 Wind: ${c.windspeedKmph} km/h`);
      } catch { await ctx.reply(`⚠️ Sorry, the weather for "${city}" could not be loaded right now.`); }
    },
  },
  {
    name: 'news', aliases: [], category: 'Utility',
    description: 'Get the latest world headlines (BBC News RSS, Dawn as fallback).',
    use: '.news',
    run: async (ctx) => {
      const parse = (xml, source) => {
        const items = [];
        const re = /<item>[\s\S]*?<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<\/item>/g;
        let m;
        while ((m = re.exec(xml)) && items.length < 8) {
          const title = m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
          const link = m[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
          if (title && link) items.push({ title, link });
        }
        return items.length ? { source, items } : null;
      };
      try {
        let parsed = null;
        try { parsed = parse(await getText('https://feeds.bbci.co.uk/news/world/rss.xml'), 'BBC News'); } catch {}
        if (!parsed) parsed = parse(await getText('https://www.dawn.com/feeds/home'), 'Dawn');
        if (!parsed) throw new Error('no items');
        let out = `📰 *Latest Headlines - ${parsed.source}*\n`;
        parsed.items.forEach((it, i) => { out += `\n${i + 1}. ${it.title}\n${it.link}\n`; });
        await ctx.reply(out.slice(0, 3900));
      } catch { await ctx.reply('⚠️ Sorry, the news could not be loaded right now. Please try again later.'); }
    },
  },
  {
    name: 'crypto', aliases: [], category: 'Utility',
    description: 'Get a cryptocurrency price in USD and PKR (CoinGecko).',
    use: '.crypto bitcoin / .crypto btc',
    run: async (ctx) => {
      const q = (ctx.args[0] || '').toLowerCase();
      if (!q) { await ctx.reply('Usage: .crypto <coin> - for example .crypto bitcoin'); return; }
      const id = COIN_IDS[q] || q;
      try {
        const data = await getJson(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd,pkr&include_24hr_change=true`);
        const d = data[id];
        if (!d) { await ctx.reply(`⚠️ Coin "${q}" was not found. Try .crypto bitcoin, .crypto eth or .crypto sol`); return; }
        const chg = d.usd_24h_change != null ? `${d.usd_24h_change >= 0 ? '📈' : '📉'} 24h: ${d.usd_24h_change.toFixed(2)}%` : '';
        await ctx.reply(`🪙 *${id}*\n💵 USD: $${d.usd?.toLocaleString()}\n🇵🇰 PKR: Rs ${d.pkr?.toLocaleString()}\n${chg}\nSource: CoinGecko`);
      } catch { await ctx.reply('⚠️ Sorry, the price could not be loaded. CoinGecko may be rate-limiting right now - please try again in a minute.'); }
    },
  },
  {
    name: 'define', aliases: ['dict'], category: 'Utility',
    description: 'Get the dictionary meaning of an English word.',
    use: '.define <word>',
    run: async (ctx) => {
      const word = (ctx.args[0] || '').toLowerCase();
      if (!word) { await ctx.reply('Usage: .define <word>'); return; }
      try {
        const data = await getJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
        const entry = Array.isArray(data) ? data[0] : null;
        if (!entry) throw new Error('not found');
        let out = `📖 *${entry.word}*${entry.phonetic ? ` (${entry.phonetic})` : ''}\n`;
        for (const meaning of (entry.meanings || []).slice(0, 3)) {
          out += `\n*${meaning.partOfSpeech}:*`;
          (meaning.definitions || []).slice(0, 2).forEach(d => {
            out += `\n• ${d.definition}`;
            if (d.example) out += `\n  _Example: ${d.example}_`;
          });
        }
        await ctx.reply(out.slice(0, 3900));
      } catch { await ctx.reply(`⚠️ Sorry, no definition was found for "${word}".`); }
    },
  },
  {
    name: 'wiki', aliases: [], category: 'Utility',
    description: 'Get a short Wikipedia summary of a topic.',
    use: '.wiki <topic>',
    run: async (ctx) => {
      const q = ctx.argText?.trim();
      if (!q) { await ctx.reply('Usage: .wiki <topic>'); return; }
      try {
        let data = null;
        try { data = await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q.replace(/\s+/g, '_'))}`); }
        catch {
          const search = await getJson(`https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(q)}&limit=1&format=json`);
          const title = search?.[1]?.[0];
          if (!title) throw new Error('not found');
          data = await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/\s+/g, '_'))}`);
        }
        if (!data?.extract) throw new Error('not found');
        await ctx.reply(`📚 *${data.title}*\n\n${data.extract.slice(0, 1500)}\n\n🔗 ${data.content_urls?.desktop?.page || ''}`.slice(0, 3900));
      } catch { await ctx.reply(`⚠️ Sorry, nothing was found on Wikipedia for "${q}".`); }
    },
  },
  {
    name: 'shorten', aliases: [], category: 'Utility',
    description: 'Shorten a long URL (is.gd).',
    use: '.shorten <url>',
    run: async (ctx) => {
      const url = (ctx.args[0] || '').trim();
      if (!/^https?:\/\//i.test(url)) { await ctx.reply('Usage: .shorten <full url starting with https://>'); return; }
      try {
        const short = (await getText(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`)).trim();
        if (!/^https:\/\/is\.gd\//.test(short)) throw new Error('bad reply');
        await ctx.reply(`🔗 Short link:\n${short}`);
      } catch { await ctx.reply('⚠️ Sorry, that URL could not be shortened right now.'); }
    },
  },
  {
    name: 'translate', aliases: [], category: 'Utility',
    description: 'Translate text into another language (MyMemory).',
    use: '.translate <lang code> <text> - for example .translate ur Good morning',
    run: async (ctx) => {
      const lang = (ctx.args[0] || '').toLowerCase();
      const text = ctx.args.slice(1).join(' ');
      if (!lang || !text) { await ctx.reply('Usage: .translate <lang code> <text>\nExample: .translate ur Good morning\nCommon codes: ur (Urdu), hi (Hindi), ar (Arabic), es (Spanish), fr (French), en (English)'); return; }
      try {
        const data = await getJson(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 400))}&langpair=en|${encodeURIComponent(lang)}`);
        const out = data?.responseData?.translatedText;
        if (!out) throw new Error('bad shape');
        await ctx.reply(`🌐 *Translation (en → ${lang}):*\n\n${out}`);
      } catch { await ctx.reply('⚠️ Sorry, the translation failed. The free translation service may be rate-limiting right now - please check the language code and try again in a little while.'); }
    },
  },
  {
    name: 'ssweb', aliases: ['screenshot'], category: 'Utility',
    description: 'Take a screenshot of a web page (thum.io).',
    use: '.ssweb <url>',
    run: async (ctx) => {
      let url = (ctx.args[0] || '').trim();
      if (!url) { await ctx.reply('Usage: .ssweb <url>'); return; }
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      try {
        await ctx.sock.sendMessage(ctx.jid, {
          image: { url: `https://image.thum.io/get/width/1200/${url}` },
          caption: `📸 Screenshot of ${url}`,
        }, { quoted: ctx.msg });
      } catch { await ctx.reply('⚠️ Sorry, the screenshot could not be taken right now.'); }
    },
  },
  {
    name: 'currency', aliases: [], category: 'Utility',
    description: 'Convert money between currencies (open.er-api.com rates).',
    use: '.currency <amount> <from> <to> - for example .currency 100 USD PKR',
    run: async (ctx) => {
      const amount = parseFloat(ctx.args[0]);
      const from = (ctx.args[1] || '').toUpperCase();
      const to = (ctx.args[2] || '').toUpperCase();
      if (!amount || !from || !to) { await ctx.reply('Usage: .currency <amount> <from> <to>\nExample: .currency 100 USD PKR'); return; }
      try {
        const data = await getJson(`https://open.er-api.com/v6/latest/${from}`);
        const rate = data?.rates?.[to];
        if (data.result !== 'success' || !rate) throw new Error('bad pair');
        await ctx.reply(`💱 *Currency Conversion*\n\n${amount} ${from} = *${(amount * rate).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${to}*\nRate: 1 ${from} = ${rate} ${to}`);
      } catch { await ctx.reply('⚠️ Sorry, that currency pair could not be converted. Please check the codes (USD, PKR, EUR, AED...).'); }
    },
  },
  {
    name: 'country', aliases: [], category: 'Utility',
    description: 'Get facts about a country (World Bank open data - REST Countries has been deprecated).',
    use: '.country <name>',
    run: async (ctx) => {
      const q = (ctx.argText || '').trim().toLowerCase();
      if (!q) { await ctx.reply('Usage: .country <name>'); return; }
      try {
        const data = await getJson('https://api.worldbank.org/v2/country/all?format=json&per_page=400');
        const list = Array.isArray(data) ? data[1] : null;
        if (!list) throw new Error('bad shape');
        const c = list.find(x => x.name.toLowerCase() === q) ||
          list.find(x => x.name.toLowerCase().includes(q) && x.region?.id !== 'NA');
        if (!c || !c.capitalCity) throw new Error('not found');
        let popLine = '';
        try {
          const pop = await getJson(`https://api.worldbank.org/v2/country/${c.id}/indicator/SP.POP.TOTL?format=json&per_page=5`);
          const row = (pop?.[1] || []).find(r => r.value != null);
          if (row) popLine = `\n👥 Population: ${Number(row.value).toLocaleString()} (${row.date})`;
        } catch { /* population is a bonus - skip silently */ }
        await ctx.reply(
          `🌍 *${c.name}*\n` +
          `🏛️ Capital: ${c.capitalCity}\n` +
          `🌐 Region: ${c.region?.value || '-'}\n` +
          `💼 Income level: ${c.incomeLevel?.value || '-'}` +
          popLine +
          `\n📍 Coordinates: ${c.latitude}, ${c.longitude}\n` +
          `🔤 ISO codes: ${c.iso2Code} / ${c.id}\n` +
          `Source: World Bank open data`
        );
      } catch { await ctx.reply(`⚠️ Sorry, no country was found for "${ctx.argText}".`); }
    },
  },
  {
    name: 'element', aliases: [], category: 'Utility',
    description: 'Get facts about a chemical element from the built-in periodic table data.',
    use: '.element <symbol or name> - for example .element Fe / .element gold',
    run: async (ctx) => {
      const q = (ctx.argText || '').trim().toLowerCase();
      if (!q) { await ctx.reply('Usage: .element <symbol or name> - for example .element Fe'); return; }
      let hit = null;
      if (ELEMENTS[q]) { const [num, name, mass, cat] = ELEMENTS[q]; hit = { sym: q.toUpperCase(), num, name, mass, cat }; }
      else if (ELEMENT_BY_NAME[q]) { const [sym, num, name, mass, cat] = ELEMENT_BY_NAME[q]; hit = { sym: sym.toUpperCase(), num, name, mass, cat }; }
      if (!hit) { await ctx.reply(`⚠️ "${ctx.argText}" is not in my built-in table yet. I know the most common elements - try Fe, Au, O, Na, Cu or U.`); return; }
      await ctx.reply(`🧪 *${hit.name} (${hit.sym})*\n🔢 Atomic number: ${hit.num}\n⚖️ Atomic mass: ${hit.mass}\n🗂️ Category: ${hit.cat}`);
    },
  },
];
