// Offline tests for the pairing support layer (lib/pairing.js):
// single-flight sharing and rate limiting. No WhatsApp socket is created.
const assert = require('assert');
const { PairingService, formatCode } = require('../lib/pairing');

(async () => {
  // formatCode
  assert.strictEqual(formatCode('primemd1'), 'PRIM-EMD1');
  assert.strictEqual(formatCode('ABCD1234'), 'ABCD-1234');
  console.log('PASS  formatCode formats XXXX-XXXX');

  // Single-flight: two concurrent runs for one number share one factory call
  const svc = new PairingService({ cooldownMs: 30000, hourlyLimit: 5 });
  let factoryCalls = 0;
  const factory = async () => { factoryCalls++; await new Promise(r => setTimeout(r, 60)); return { code: 'ABCD-1234' }; };
  const [a, b] = await Promise.all([svc.singleFlight('923100000001', factory), svc.singleFlight('923100000001', factory)]);
  assert.strictEqual(factoryCalls, 1, 'factory must run exactly once');
  assert.deepStrictEqual(a, b);
  assert.strictEqual(svc.hasPending('923100000001'), false, 'pending entry must be cleared after completion');
  assert.strictEqual(svc.pendingCount(), 0);
  console.log('PASS  singleFlight: 2 concurrent calls, factory ran 1 time, same result, lock cleared');

  // Different numbers do not share
  let calls2 = 0;
  const f2 = async () => { calls2++; return calls2; };
  await Promise.all([svc.singleFlight('923100000002', f2), svc.singleFlight('923100000003', f2)]);
  assert.strictEqual(calls2, 2);
  console.log('PASS  singleFlight: different numbers run separately');

  // A failing factory clears the lock so a retry starts clean
  await assert.rejects(svc.singleFlight('923100000004', async () => { throw new Error('boom'); }));
  assert.strictEqual(svc.hasPending('923100000004'), false);
  console.log('PASS  singleFlight: failed run clears the lock for a clean retry');

  // Rate limit: cooldown per number
  const rl = new PairingService({ cooldownMs: 30000, hourlyLimit: 5 });
  assert.strictEqual(rl.checkRate('923100000009', '1.2.3.4'), null);
  rl.recordRequest('923100000009', '1.2.3.4');
  const limited = rl.checkRate('923100000009', '9.9.9.9');
  assert.ok(limited && limited.retryAfterSec > 0 && limited.retryAfterSec <= 30);
  console.log(`PASS  rate limit: second request inside 30s cooldown blocked (retry after ${limited.retryAfterSec}s)`);

  // Rate limit: cooldown per IP (different number, same IP)
  const ipLimited = rl.checkRate('923100000010', '1.2.3.4');
  assert.ok(ipLimited, 'same IP inside cooldown must be limited');
  console.log('PASS  rate limit: per-IP cooldown applies across numbers');

  // Rate limit: hourly cap per number
  const hourly = new PairingService({ cooldownMs: 0, hourlyLimit: 5 });
  for (let i = 0; i < 5; i++) { assert.strictEqual(hourly.checkRate('923100000011', null), null); hourly.recordRequest('923100000011', null); }
  assert.ok(hourly.checkRate('923100000011', null), '6th request within the hour must be limited');
  console.log('PASS  rate limit: 6th request within an hour blocked (cap 5)');

  console.log('pairing service: all tests passed');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
