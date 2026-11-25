// Browser identity matters for WhatsApp pairing:
// - The initial pairing handshake uses a DESKTOP identity (pairing codes are
//   a desktop/linked-device flow and this handshakes most reliably).
// - A registered, running session uses an ANDROID PHONE identity
//   ['Chrome','Android','15'] - on desktop/Safari identities WhatsApp
//   withholds view-once media, which PRIME MD needs for its view-once tools.
const pairingBrowser = ['Windows', 'Chrome', '10'];
const sessionBrowser = ['Chrome', 'Android', '15'];
module.exports = { pairingBrowser, sessionBrowser };
