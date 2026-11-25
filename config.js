// PRIME MD - central config. Everything comes from environment variables
// with safe placeholder defaults. NO real passwords live in this file.
module.exports = {
  BOT_NAME: process.env.BOT_NAME || 'PRIME MD',
  PREFIX: process.env.PREFIX || '.',
  // Placeholder only - set the real MONGO_URI in Railway variables / .env.
  // When this stays a placeholder, the bot runs on local file auth instead.
  MONGO_URI: process.env.MONGO_URI || 'mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/prime_md',
  MONGO_DB: process.env.MONGO_DB || 'prime_md',
  SERVER_ID: parseInt(process.env.SERVER_ID || '1', 10),
  SERVER_NAME: process.env.SERVER_NAME || 'SERVER 01',
  SESSION_LIMIT: parseInt(process.env.SESSION_LIMIT || '50', 10),
  PAIR_CODE: (process.env.PAIR_CODE || 'PRIMEMDX').toUpperCase(), // WhatsApp custom pairing codes must be EXACTLY 8 chars ('PRIMEMD' is 7 and is always rejected)
  OWNER_NUMBER: (process.env.OWNER_NUMBER || '923138702477').replace(/\D/g, ''),
  OWNER_NAME: process.env.OWNER_NAME || 'AR PRIME',
  PORT: parseInt(process.env.PORT || '3000', 10),
  // WhatsApp channels auto-followed (silently) when a session connects.
  CHANNEL_JIDS: [
    '120363411508686944@newsletter', // VEXORA SMD
    '120363430772860134@newsletter', // Urdu Alfaaz
  ],
  PAIRING_TIMEOUT_MS: 3 * 60 * 1000, // half-created pairing sessions live max 3 minutes
  PAIRING_COOLDOWN_MS: 30 * 1000,    // 1 code request per 30s per number / IP
  PAIRING_HOURLY_LIMIT: 5,           // max 5 codes per hour per number
  // ---- Downloads, AI & media - all env-overridable, safe defaults ----
  VEXORA_API_BASE: (process.env.VEXORA_API_BASE || 'https://vexora-api-orcin.vercel.app').replace(/\/$/, ''),
  // YouTube backend order: Tioo backend2 first (backend1 may 402; backend3
  // returns no media and is never used), then the VEXORA API as fallback.
  TIOO_HOSTS: ['https://backend2.tioo.eu.org', 'https://backend1.tioo.eu.org', 'https://backend2.tioo.eu.org'],
  INVIDIOUS_BASE: (process.env.INVIDIOUS_BASE || 'https://yt.chocolatemoo53.com').replace(/\/$/, ''),
  DL_MAX_BYTES: parseInt(process.env.DL_MAX_BYTES || String(600 * 1024 * 1024), 10), // 600 MB mux/document cap
  DL_INLINE_MAX: 16 * 1024 * 1024,   // at or under this, media goes inline; above it, as a document
  MOVIE_MAX_BYTES: Math.floor(1.95 * 1024 * 1024 * 1024), // Internet Archive movie cap
  VV_CACHE_TTL_MS: 30 * 60 * 1000,   // view-once arrival cache lifetime
  VV_CACHE_MAX_ITEMS: 200,
  VV_MAX_BYTES: 25 * 1024 * 1024,    // do not cache view-once items larger than this
  STATUS_PHOTO_MAX: 25 * 1024 * 1024,
  STATUS_VIDEO_MAX: 200 * 1024 * 1024,
  // ---- Server control ----
  // Admin panel password. Empty (the default) = the panel is disabled.
  // There is NO built-in default password - set ADMIN_PASS to enable it.
  ADMIN_PASS: process.env.ADMIN_PASS || '',
  BROADCAST_DELAY_MS: parseInt(process.env.BROADCAST_DELAY_MS || '1500', 10), // pause between broadcast sends
};
