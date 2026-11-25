// Unit tests for lib/normalizeNumber.js
const assert = require('assert');
const { normalizeNumber } = require('../lib/normalizeNumber');
const cases = [
  ['+92 313-8702477', '923138702477'],
  ['03138702477', '923138702477'],
  ['00923138702477', '923138702477'],
  ['923138702477', '923138702477'],
  ['+1 (555) 123-4567', '15551234567'],
  ['123', null],
  ['abc', null],
  ['', null],
  ['92-313', null],
];
let pass = 0;
for (const [input, expected] of cases) {
  const r = normalizeNumber(input);
  if (expected === null) {
    assert.strictEqual(r.ok, false, `expected invalid: ${input}`);
    console.log(`PASS  "${input}" -> invalid (${r.error.slice(0, 40)}...)`);
  } else {
    assert.strictEqual(r.ok, true, `expected ok: ${input} (${r.error || ''})`);
    assert.strictEqual(r.number, expected);
    console.log(`PASS  "${input}" -> ${r.number}`);
  }
  pass++;
}
console.log(`normalizeNumber: ${pass}/${cases.length} cases passed`);
