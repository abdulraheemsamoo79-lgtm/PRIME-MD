# 👑 PRIME MD — Multi-Session WhatsApp Mini Bot

PRIME MD is a powerful multi-session WhatsApp bot built on a **fresh base**
(Node.js + the official `@whiskeysockets/baileys` npm package — no forks).
Anyone can pair their own WhatsApp number and get their own bot session;
sessions live in MongoDB, are stamped per server, and reconnect on their own.

**Phase 1 (this build):** core engine, best-effort-proof pairing, rich
purple-royal menu with logo, and 32 core/utility/fun commands.
Downloaders, AI, view-once and group tools arrive in Phase 2/3.

## Pairing — built to just work

Pairing is the #1 priority of this bot:

- **Number normalization:** `+92 313-8702477`, `03138702477`,
  `00923138702477` and `923138702477` all become the same number; bad
  numbers are rejected with a clear English message *before* any socket work.
- **Single-flight:** repeated or simultaneous code requests for one number
  share one pending session — never duplicate sockets.
- **Already paired?** You get an `already_paired` answer, not a new code.
- **Custom code first:** the code word `PRIMEMD` is tried first; if WhatsApp
  rejects it, a random code is used silently in the same attempt.
- **Browser identity:** the pairing handshake uses a desktop identity, then
  the registered session restarts once onto the Android phone identity
  `['Chrome','Android','15']` (desktop identities do not receive view-once
  media, which Phase 2 needs).
- **No zombies:** a pairing session that is not used within 3 minutes is
  cleaned up, so a retry always starts clean.
- **Rate limits:** 1 code per 30 seconds per number/IP and max 5 codes per
  hour per number — this protects numbers from WhatsApp pairing locks.
- **Welcome DM:** on first connect the user gets an "✅ PRIME MD is now
  connected" message from their own session, with a `.menu` hint.
- **Web form:** the home page (`GET /`) has a working pairing form with the
  3 steps (WhatsApp > Linked devices > Link with phone number).

API: `GET /api/code?number=<digits>` always returns JSON
`{ ok, code?, status, message }` with status one of `code_ready`,
`already_paired`, `invalid_number`, `rate_limited`, `server_full`,
`try_again`. Stack traces are never exposed.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `MONGO_URI` | placeholder | MongoDB connection string for sessions/settings. Placeholder/unset = local file auth under `sessions/`. |
| `MONGO_DB` | `prime_md` | Database name. |
| `SERVER_ID` | `1` | This instance's ID. An instance restores only its own sessions. |
| `SERVER_NAME` | `SERVER 01` | Display name of this server. |
| `SESSION_LIMIT` | `50` | Max paired sessions on this server. |
| `PAIR_CODE` | `PRIMEMD` | Custom pairing code word (8 characters). |
| `OWNER_NUMBER` | `923138702477` | Global owner; always allowed, even in private mode. |
| `BOT_NAME` | `PRIME MD` | Display name. |
| `PREFIX` | `.` | Command prefix. |
| `PORT` | `3000` | Web server port (Railway sets this automatically). |

## Run locally

```bash
npm install
node index.js          # no database needed - file auth fallback
# open http://localhost:3000 and pair from the form
```

## Deploy on Railway

1. Push this repo to GitHub (private).
2. Railway > New Project > Deploy from GitHub repo > pick this repo.
3. In the service **Variables**, set the real `MONGO_URI` (and any overrides
   from the table above). Never commit the real URI to the repo.
4. Railway auto-detects Node and runs `node index.js` (see `Procfile`).
   Generate a public domain under Settings > Networking.
5. Open the domain, pair your number from the form, and confirm the welcome
   DM arrives; then send `.menu` on WhatsApp.

## Commands (Phase 1)

- **Core:** `.menu` `.list` `.help` `.ping` `.alive` `.runtime` `.owner`
  `.pair` `.mode` `.server`
- **Owner:** `.public` `.private` `.sessions` `.delsession` `.restart`
- **Utility:** `.calc` `.time` `.device` `.getdp` `.getbio` `.qrcode`
  `.b64` `.b64d` `.password` `.fancy` `.id`
- **Fun:** `.coin` `.dice` `.joke` `.fact` `.quote` `.choose`

All user-facing text is in English. On any failure the user gets one
friendly English line; the real error is only logged on the server.

## Notes

- On connect, every session silently auto-follows the VEXORA SMD and Urdu
  Alfaaz WhatsApp channels.
- A session that gets logged out is cleaned up automatically and never
  reconnect-looped; other sessions are unaffected.
