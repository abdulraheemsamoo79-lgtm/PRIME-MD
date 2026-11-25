// Pairing support layer: single-flight locks + rate limiting. Kept separate
// from the socket code so it can be unit-tested offline.
// - Single-flight: concurrent getCode work for the same number shares ONE
//   pending entry/factory run - never two sockets for one number.
// - Rate limit: 1 request per cooldown per number AND per IP, plus an
//   hourly cap per number (protects against WhatsApp pairing locks).
const config = require('../config');

class PairingService {
  constructor(opts = {}) {
    this.cooldownMs = opts.cooldownMs ?? config.PAIRING_COOLDOWN_MS;
    this.hourlyLimit = opts.hourlyLimit ?? config.PAIRING_HOURLY_LIMIT;
    this.windowMs = opts.windowMs ?? 60 * 60 * 1000;
    this.pending = new Map();       // number -> { promise, createdAt }
    this.lastByNumber = new Map();  // number -> ts
    this.lastByIp = new Map();      // ip -> ts
    this.hourly = new Map();        // number -> [ts]
  }

  hasPending(number) { return this.pending.has(number); }
  pendingCount() { return this.pending.size; }

  // Returns null when allowed, or { retryAfterSec, message } when limited.
  checkRate(number, ip) {
    const now = Date.now();
    const waitFor = (ts) => Math.ceil((this.cooldownMs - (now - ts)) / 1000);
    const ln = this.lastByNumber.get(number);
    if (ln && now - ln < this.cooldownMs) return { retryAfterSec: waitFor(ln), message: `Please wait ${waitFor(ln)} seconds before asking for a new code for this number.` };
    if (ip) {
      const li = this.lastByIp.get(ip);
      if (li && now - li < this.cooldownMs) return { retryAfterSec: waitFor(li), message: `Please wait ${waitFor(li)} seconds before asking for another pairing code.` };
    }
    const stamps = (this.hourly.get(number) || []).filter(t => now - t < this.windowMs);
    this.hourly.set(number, stamps);
    if (stamps.length >= this.hourlyLimit) return { retryAfterSec: Math.ceil((this.windowMs - (now - stamps[0])) / 1000), message: 'Too many pairing codes were requested for this number in the last hour. Please wait a while and try again - this protects your number from a WhatsApp pairing lock.' };
    return null;
  }

  recordRequest(number, ip) {
    const now = Date.now();
    this.lastByNumber.set(number, now);
    if (ip) this.lastByIp.set(ip, now);
    const stamps = this.hourly.get(number) || [];
    stamps.push(now);
    this.hourly.set(number, stamps);
  }

  // Runs factory() once per number while a run is in flight; every other
  // caller for the same number receives the same promise/result.
  singleFlight(number, factory) {
    const existing = this.pending.get(number);
    if (existing) return existing.promise;
    const promise = (async () => {
      try { return await factory(); }
      finally { this.pending.delete(number); }
    })();
    this.pending.set(number, { promise, createdAt: Date.now() });
    return promise;
  }
}

function formatCode(code) {
  const raw = String(code || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
  return raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
}

module.exports = { PairingService, formatCode };
