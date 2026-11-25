// Phone number normalization for pairing.
// Rules: strip spaces/dashes/+/brackets; strip leading 00 (international
// prefix); a leading 0 with 11 digits is the Pakistani local format
// (03xx...) and becomes 92-prefixed; final result must be 10-15 digits.
function normalizeNumber(input) {
  if (input === undefined || input === null) return { ok: false, error: 'No number was provided.' };
  let n = String(input).replace(/[\s\-+()[\]]/g, '');
  if (!n) return { ok: false, error: 'No number was provided.' };
  if (!/^\d+$/.test(n)) return { ok: false, error: 'That number has letters or symbols in it. Please send digits only, with your country code.' };
  if (n.startsWith('00')) n = n.slice(2);
  if (n.startsWith('0') && n.length === 11) n = '92' + n.slice(1); // PK local 03xx -> 92 3xx
  if (n.length < 10 || n.length > 15) return { ok: false, error: 'That number does not look complete. Please send your full WhatsApp number with country code, for example 923138702477.' };
  return { ok: true, number: n };
}
module.exports = { normalizeNumber };
