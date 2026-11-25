// PRIME MD - Islamic commands (Phase 3). Keyless sources, each verified
// live during the build: AlQuran Cloud (ayah/surah) and Aladhan
// (prayer times + qibla). Hadith APIs did not answer live, so .hadith
// serves a small built-in collection of well-known hadith with their
// sources, exactly as planned. Asma ul Husna and duas are built-in data.
const { getJson } = require('../lib/net');

const NAMES_99 = [
  ['Ar-Rahman', 'The Most Merciful'], ['Ar-Rahim', 'The Most Compassionate'], ['Al-Malik', 'The King'], ['Al-Quddus', 'The Most Holy'], ['As-Salam', 'The Source of Peace'],
  ['Al-Mu\'min', 'The Giver of Faith'], ['Al-Muhaymin', 'The Guardian'], ['Al-Aziz', 'The Almighty'], ['Al-Jabbar', 'The Compeller'], ['Al-Mutakabbir', 'The Supreme'],
  ['Al-Khaliq', 'The Creator'], ['Al-Bari', 'The Originator'], ['Al-Musawwir', 'The Fashioner'], ['Al-Ghaffar', 'The Great Forgiver'], ['Al-Qahhar', 'The Irresistible'],
  ['Al-Wahhab', 'The Supreme Bestower'], ['Ar-Razzaq', 'The Provider'], ['Al-Fattah', 'The Opener'], ['Al-Alim', 'The All-Knowing'], ['Al-Qabid', 'The Withholder'],
  ['Al-Basit', 'The Extender'], ['Al-Khafid', 'The Abaser'], ['Ar-Rafi', 'The Exalter'], ['Al-Mu\'izz', 'The Honourer'], ['Al-Mudhill', 'The Humiliator'],
  ['As-Sami', 'The All-Hearing'], ['Al-Basir', 'The All-Seeing'], ['Al-Hakam', 'The Impartial Judge'], ['Al-Adl', 'The Utterly Just'], ['Al-Latif', 'The Subtly Kind'],
  ['Al-Khabir', 'The All-Aware'], ['Al-Halim', 'The Most Forbearing'], ['Al-Azim', 'The Magnificent'], ['Al-Ghafoor', 'The All-Forgiving'], ['Ash-Shakur', 'The Most Appreciative'],
  ['Al-Ali', 'The Most High'], ['Al-Kabir', 'The Most Great'], ['Al-Hafiz', 'The Preserver'], ['Al-Muqit', 'The Sustainer'], ['Al-Hasib', 'The Reckoner'],
  ['Al-Jalil', 'The Majestic'], ['Al-Karim', 'The Most Generous'], ['Ar-Raqib', 'The Watchful'], ['Al-Mujib', 'The Responsive'], ['Al-Wasi', 'The All-Encompassing'],
  ['Al-Hakim', 'The All-Wise'], ['Al-Wadud', 'The Most Loving'], ['Al-Majid', 'The Most Glorious'], ['Al-Ba\'ith', 'The Resurrector'], ['Ash-Shahid', 'The Witness'],
  ['Al-Haqq', 'The Absolute Truth'], ['Al-Wakil', 'The Trustee'], ['Al-Qawiyy', 'The Most Strong'], ['Al-Matin', 'The Firm'], ['Al-Waliyy', 'The Protecting Friend'],
  ['Al-Hamid', 'The Most Praiseworthy'], ['Al-Muhsi', 'The Appraiser'], ['Al-Mubdi', 'The Originator'], ['Al-Mu\'id', 'The Restorer'], ['Al-Muhyi', 'The Giver of Life'],
  ['Al-Mumit', 'The Creator of Death'], ['Al-Hayy', 'The Ever-Living'], ['Al-Qayyum', 'The Self-Subsisting'], ['Al-Wajid', 'The Perceiver'], ['Al-Majid', 'The Illustrious'],
  ['Al-Wahid', 'The One'], ['As-Samad', 'The Eternal Refuge'], ['Al-Qadir', 'The Most Capable'], ['Al-Muqtadir', 'The All-Powerful'], ['Al-Muqaddim', 'The Expediter'],
  ['Al-Mu\'akhkhir', 'The Delayer'], ['Al-Awwal', 'The First'], ['Al-Akhir', 'The Last'], ['Az-Zahir', 'The Manifest'], ['Al-Batin', 'The Hidden'],
  ['Al-Wali', 'The Governor'], ['Al-Muta\'ali', 'The Most Exalted'], ['Al-Barr', 'The Source of Goodness'], ['At-Tawwab', 'The Ever-Relenting'], ['Al-Muntaqim', 'The Avenger'],
  ['Al-Afuww', 'The Pardoner'], ['Ar-Ra\'uf', 'The Most Kind'], ['Malik-ul-Mulk', 'Master of the Kingdom'], ['Dhul-Jalali wal-Ikram', 'Lord of Majesty and Honour'], ['Al-Muqsit', 'The Equitable'],
  ['Al-Jami', 'The Gatherer'], ['Al-Ghaniyy', 'The Self-Sufficient'], ['Al-Mughni', 'The Enricher'], ['Al-Mani', 'The Preventer'], ['Ad-Darr', 'The Distresser'],
  ['An-Nafi', 'The Benefactor'], ['An-Nur', 'The Light'], ['Al-Hadi', 'The Guide'], ['Al-Badi', 'The Incomparable'], ['Al-Baqi', 'The Everlasting'],
  ['Al-Warith', 'The Inheritor'], ['Ar-Rashid', 'The Guide to Right Path'], ['As-Sabur', 'The Most Patient'],
];

const HADITHS = [
  { text: 'The best among you are those who learn the Qur\'an and teach it.', source: 'Sahih al-Bukhari 5027' },
  { text: 'Actions are but by intentions, and every person shall have only that which they intended.', source: 'Sahih al-Bukhari 1' },
  { text: 'The most beloved deeds to Allah are those done most consistently, even if small.', source: 'Sahih al-Bukhari 6464' },
  { text: 'Make things easy and do not make them difficult; give glad tidings and do not repel people.', source: 'Sahih al-Bukhari 69' },
  { text: 'None of you truly believes until he loves for his brother what he loves for himself.', source: 'Sahih al-Bukhari 13' },
  { text: 'The strong is not the one who overcomes people by wrestling, but the one who controls himself in anger.', source: 'Sahih al-Bukhari 6114' },
  { text: 'Allah is Gentle and loves gentleness in all things.', source: 'Sahih al-Bukhari 6927' },
  { text: 'The best of you are the best to their families, and I am the best of you to my family.', source: 'Sunan al-Tirmidhi 3895' },
  { text: 'Whoever believes in Allah and the Last Day, let him speak good or remain silent.', source: 'Sahih al-Bukhari 6018' },
  { text: 'Purity is half of faith, and Alhamdulillah fills the scale.', source: 'Sahih Muslim 223' },
  { text: 'The upper hand is better than the lower hand (the one that gives is better than the one that takes).', source: 'Sahih al-Bukhari 1429' },
  { text: 'Do not envy one another, do not hate one another... and be, O servants of Allah, brothers.', source: 'Sahih Muslim 2559' },
];

const DUAS = [
  { arabic: 'رَبَّنَا آتِنَا فِي الدُّنْيَا حَسَنَةً وَفِي الْآخِرَةِ حَسَنَةً وَقِنَا عَذَابَ النَّارِ', translation: 'Our Lord, give us good in this world and good in the Hereafter, and shield us from the punishment of the Fire.', source: 'Qur\'an 2:201' },
  { arabic: 'رَبِّ اشْرَحْ لِي صَدْرِي وَيَسِّرْ لِي أَمْرِي', translation: 'My Lord, expand for me my chest and ease for me my task.', source: 'Qur\'an 20:25-26' },
  { arabic: 'لَا إِلَٰهَ إِلَّا أَنْتَ سُبْحَانَكَ إِنِّي كُنْتُ مِنَ الظَّالِمِينَ', translation: 'There is no deity but You; glory be to You. Indeed, I have been of the wrongdoers. (Dua of Prophet Yunus)', source: 'Qur\'an 21:87' },
  { arabic: 'حَسْبُنَا اللَّهُ وَنِعْمَ الْوَكِيلُ', translation: 'Allah is sufficient for us, and He is the best Disposer of affairs.', source: 'Qur\'an 3:173' },
  { arabic: 'رَبَّنَا اغْفِرْ لِي وَلِوَالِدَيَّ وَلِلْمُؤْمِنِينَ يَوْمَ يَقُومُ الْحِسَابُ', translation: 'Our Lord, forgive me and my parents and the believers on the Day the account is established.', source: 'Qur\'an 14:41' },
  { arabic: 'اللَّهُمَّ إِنِّي أَسْأَلُكَ الْعَفْوَ وَالْعَافِيَةَ فِي الدُّنْيَا وَالْآخِرَةِ', translation: 'O Allah, I ask You for pardon and well-being in this world and the Hereafter.', source: 'Sunan Ibn Majah 3871' },
  { arabic: 'يَا مُقَلِّبَ الْقُلُوبِ ثَبِّتْ قَلْبِي عَلَى دِينِكَ', translation: 'O Turner of hearts, keep my heart firm upon Your religion.', source: 'Sunan al-Tirmidhi 3522' },
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Geocode a place name with OpenStreetMap Nominatim (verified live -
// Aladhan's own timingsByCity returns placeholder coordinates for smaller
// Pakistani cities, so real coordinates are fetched here and the timings
// are then requested BY coordinates, which is the accurate route).
async function geocode(place) {
  const data = await getJson(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(place)}&format=json&limit=1`);
  const hit = Array.isArray(data) ? data[0] : null;
  if (!hit) return null;
  return { lat: hit.lat, lon: hit.lon, label: String(hit.display_name || place).split(',').slice(0, 2).join(',') };
}

module.exports = [
  {
    name: 'ayah', aliases: [], category: 'Islamic',
    description: 'Get a Qur\'an verse in Arabic with English translation (AlQuran Cloud).',
    use: '.ayah 2:255 / .ayah 255',
    run: async (ctx) => {
      const ref = (ctx.argText || '').trim();
      if (!ref) { await ctx.reply('Usage: .ayah <surah:ayah> - for example .ayah 2:255\nOr give the global ayah number (1-6236): .ayah 255'); return; }
      try {
        const data = await getJson(`https://api.alquran.cloud/v1/ayah/${encodeURIComponent(ref)}/editions/quran-uthmani,en.asad`);
        const [ar, en] = data.data || [];
        if (!ar || !en) throw new Error('bad shape');
        await ctx.reply(`📖 *Surah ${en.surah.englishName} (${en.surah.number}:${en.numberInSurah})*\n\n${ar.text}\n\n${en.text}\n\n— Qur'an ${en.surah.number}:${en.numberInSurah}`);
      } catch { await ctx.reply('⚠️ Sorry, that ayah could not be found. Please check the reference, for example .ayah 2:255'); }
    },
  },
  {
    name: 'surah', aliases: [], category: 'Islamic',
    description: 'Get information about a Surah by its number (1-114).',
    use: '.surah 36',
    run: async (ctx) => {
      const n = parseInt(ctx.args[0], 10);
      if (!n || n < 1 || n > 114) { await ctx.reply('Usage: .surah <number from 1 to 114> - for example .surah 36'); return; }
      try {
        const data = await getJson(`https://api.alquran.cloud/v1/surah/${n}`);
        const d = data.data;
        await ctx.reply(`📖 *Surah ${d.number} - ${d.englishName}*\nArabic name: ${d.name}\nMeaning: ${d.englishNameTranslation}\nRevelation: ${d.revelationType === 'Meccan' ? 'Meccan' : 'Medinan'}\nAyahs: ${d.numberOfAyahs}`);
      } catch { await ctx.reply('⚠️ Sorry, the Surah information could not be loaded right now.'); }
    },
  },
  {
    name: 'hadith', aliases: [], category: 'Islamic',
    description: 'Get a hadith from a small built-in collection of well-known authentic hadith (online hadith APIs were unavailable).',
    use: '.hadith',
    run: async (ctx) => {
      const h = pick(HADITHS);
      await ctx.reply(`📜 *Hadith*\n\n"${h.text}"\n\n— ${h.source} (narrated from the Prophet Muhammad ﷺ)`);
    },
  },
  {
    name: 'asmaulhusna', aliases: ['99names'], category: 'Islamic',
    description: 'The 99 Names of Allah. Give a number for one name, or no number for a page of names.',
    use: '.asmaulhusna [number 1-99]',
    run: async (ctx) => {
      const n = parseInt(ctx.args[0], 10);
      if (n >= 1 && n <= 99) {
        const [name, meaning] = NAMES_99[n - 1];
        await ctx.reply(`✨ *${n}. ${name}*\n${meaning}`);
        return;
      }
      const page = Math.min(9, Math.max(0, (parseInt(ctx.args[0], 10) || 1) - 1));
      const slice = NAMES_99.slice(page * 11, page * 11 + 11);
      let out = `✨ *Asma ul Husna - 99 Names of Allah* (page ${page + 1}/9)\n`;
      slice.forEach(([name, meaning], i) => { out += `\n${page * 11 + i + 1}. *${name}* - ${meaning}`; });
      out += '\n\nUse .asmaulhusna <number> for one name, or .asmaulhusna <page 1-9>.';
      await ctx.reply(out);
    },
  },
  {
    name: 'prayer', aliases: ['namaz', 'salah'], category: 'Islamic',
    description: 'Get today\'s prayer times for a city (geocoded, then Aladhan by coordinates). Default: Matiari, Pakistan.',
    use: '.prayer [city]',
    run: async (ctx) => {
      const city = ctx.argText?.trim() || 'Matiari, Pakistan';
      try {
        const geo = await geocode(city);
        if (!geo) throw new Error('place not found');
        const now = new Date();
        const dd = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`;
        const data = await getJson(`https://api.aladhan.com/v1/timings/${dd}?latitude=${geo.lat}&longitude=${geo.lon}&method=1`);
        const t = data.data.timings;
        const date = data.data.date;
        const rows = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].map(k => `├ ${k}: ${String(t[k]).slice(0, 5)}`).join('\n');
        await ctx.reply(`🕌 *Prayer Times - ${geo.label}*\n📅 ${date.readable} (${date.hijri.day} ${date.hijri.month.en} ${date.hijri.year} AH)\n${rows}\n└ Source: Aladhan by coordinates (University of Islamic Sciences, Karachi method)`);
      } catch { await ctx.reply(`⚠️ Sorry, prayer times for "${city}" could not be loaded. Try a well-known city name.`); }
    },
  },
  {
    name: 'qibla', aliases: [], category: 'Islamic',
    description: 'Get the Qibla direction for a city (geocoded, then the Aladhan qibla endpoint).',
    use: '.qibla [city]',
    run: async (ctx) => {
      const city = ctx.argText?.trim() || 'Matiari, Pakistan';
      try {
        const geo = await geocode(city);
        if (!geo) throw new Error('place not found');
        const q = await getJson(`https://api.aladhan.com/v1/qibla/${geo.lat}/${geo.lon}`);
        const dir = q.data.direction;
        const compass = ['North', 'North-East', 'East', 'South-East', 'South', 'South-West', 'West', 'North-West'][Math.round(dir / 45) % 8];
        await ctx.reply(`🧭 *Qibla Direction - ${geo.label}*\n\nDirection: *${dir.toFixed(2)}°* from North (${compass})\nFace this bearing from your location to face the Kaaba in Makkah.`);
      } catch { await ctx.reply(`⚠️ Sorry, the Qibla direction for "${city}" could not be loaded. Try a well-known city name.`); }
    },
  },
  {
    name: 'dua', aliases: [], category: 'Islamic',
    description: 'Get a daily dua in Arabic with its English translation and source.',
    use: '.dua',
    run: async (ctx) => {
      const d = pick(DUAS);
      await ctx.reply(`🤲 *Dua*\n\n${d.arabic}\n\n"${d.translation}"\n\n— ${d.source}`);
    },
  },
];
