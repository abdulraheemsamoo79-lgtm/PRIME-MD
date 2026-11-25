# PRIME MD — Phase 1 Build Record
Date: 2026-11-25 · Scope: core engine + pairing + menu + core commands ONLY.
Fresh code written from scratch in `~/workspace/prime-md-bot/` — no files were
copied from `~/workspace/mini-bot` or `~/workspace/vexora-repo-latest`
(architecture ideas only). `assets/logo.png` (the user's final purple king
logo, 2,566,369 bytes) was preserved untouched.

## Files created
- `package.json` (name `prime-md`, start `node index.js`, node >=20), `package-lock.json`
- `config.js` — all env-driven, placeholder MONGO_URI, NO real password anywhere
- `index.js` — Express server + WhatsApp message handler
- `lib/mongo.js` — shared Mongo access, placeholder detection, null fallback
- `lib/mongoAuthState.js` — Baileys auth in Mongo (`auth_creds`/`auth_keys`), file fallback via `useMultiFileAuthState` under `sessions/<number>/`
- `lib/sessionManager.js` — per-number sessions, SERVER_ID stamp, SESSION_LIMIT, backoff reconnect, loggedOut cleanup, channel auto-follow, pairing orchestration
- `lib/normalizeNumber.js` — pairing number normalization (tested utility)
- `lib/browserIdentity.js` — `pairingBrowser` (desktop) / `sessionBrowser` (`['Chrome','Android','15']`)
- `lib/pairing.js` — single-flight lock map + pairing rate limits + `formatCode`
- `lib/settings.js` — per-session settings (Mongo, else in-memory + `data/settings.json`)
- `lib/commandLoader.js` — registry by name+aliases, duplicate detection
- `commands/core.js` (15 commands), `commands/utility.js` (11), `commands/fun.js` (6)
- `tests/normalize.test.js`, `tests/pairing.test.js`, `tests/loader.test.js`
- `README.md`, `app.json`, `Procfile` (`web: node index.js`), `.gitignore` (node_modules, sessions/, .env, tmp)

## Dependencies (installed, exact versions)
- `@whiskeysockets/baileys` **7.0.0-rc14** — this is what `npm view @whiskeysockets/baileys version` returned as the latest official npm release on 2026-11-25; pinned in package.json as `^7.0.0-rc14`, installed exactly 7.0.0-rc14. Official npm package only, no GitHub fork.
- mongodb 6.22.0 · express 4.22.3 · pino 9.14.0 · axios 1.21.1 · fluent-ffmpeg 2.1.3 · ffmpeg-static 5.3.0 · sharp 0.35.5 · yt-search 2.13.1 · qrcode-terminal 0.12.0 · qrcode 1.5.4 (added: generates the `.qr` images; qrcode-terminal only renders to terminals)

## Commands: 32 primary + 12 aliases, 0 duplicates
- Core (10): menu, list, help, ping, alive, runtime, owner, pair, mode, server
- Owner (5): public, private, sessions, delsession, restart
- Utility (11): calc, time, device, getdp, getbio, qrcode, b64, b64d, password, fancy, id
- Fun (6): coin, dice, joke, fact, quote, choose

## Pairing system (priority build)
- Normalization BEFORE any socket work; invalid numbers get a friendly English JSON error.
- Single-flight per number (shared pending promise); already-paired numbers return `already_paired`.
- Desktop identity only for the handshake socket; on first open, after the welcome DM, the session restarts once onto the Android identity (a per-process guard prevents repeat switches; later boots load registered creds and use Android directly).
- Code requested only after the socket signals readiness (connection update or 10s ceiling); custom code `PRIMEMD` first, silent random fallback in the SAME attempt; `creds.update` always persists.
- Pending pairing sessions are cleaned up after 3 minutes if not opened — retries start clean.
- Rate limit: 1 code / 30s per number and per IP, max 5/hour per number; `trust proxy` is set so Railway's proxy does not make all web users share one IP bucket.
- Welcome DM on first connect: "✅ PRIME MD is now connected..." + `.menu` hint.
- `GET /` is a working pairing form (number input, Get Code button, big XXXX-XXXX display, 3 English steps, live server count, logo, purple branding) using fetch() to `/api/code`.
- `/api/code` always returns `{ ok, code?, status, message }`; statuses: code_ready, already_paired, invalid_number, rate_limited, server_full, try_again. No stack traces anywhere.

## Code review pass (bugs found and fixed before testing)
1. `waitReady` left stale resolver entries in the waiter list after timeout — fixed (self-removing waiters).
2. If `makeWASocket` threw, a dead entry stayed in the session map occupying a limit slot — fixed (entry removed, error rethrown).
3. Express `trust proxy` was missing — on Railway every web pairing request would share the proxy IP and trip the per-IP cooldown for unrelated users — fixed.

## Verification — all run 2026-11-25, all passed
1. **`node --check` on all 16 project .js files** (config, index, 8 lib files, 3 command files, 3 test files): **16/16 OK**.
2. **Command loader test** (`node tests/loader.test.js`): Total 32 — Core 10, Owner 5, Utility 11, Fun 6; Aliases 12; **Duplicates: 0**.
3. **Normalization tests** (`node tests/normalize.test.js`): **9/9 PASS** —
   `+92 313-8702477` → 923138702477 · `03138702477` → 923138702477 · `00923138702477` → 923138702477 · `923138702477` → 923138702477 · `+1 (555) 123-4567` → 15551234567 · `123` → invalid · `abc` → invalid · `` → invalid · `92-313` → invalid.
4. **Pairing module tests** (`node tests/pairing.test.js`): **7/7 PASS** — formatCode XXXX-XXXX; single-flight (2 concurrent calls, factory ran exactly 1 time, same result, lock cleared); different numbers run separately; failed run clears the lock; per-number 30s cooldown blocks with retryAfter; per-IP cooldown applies across numbers; 6th request in an hour blocked (cap 5).
5. **Smoke test** (MONGO_URI unset, PORT=3999, no database): server booted, log showed `loaded 32 commands, 0 duplicates` and `[restore] 0 stored session(s)`. Responses:
   - `GET /api/status` → `{"ok":true,"bot":"PRIME MD","serverId":1,"serverName":"SERVER 01","sessions":0,"limit":50,"pairingPending":0,"commands":32,"uptimeSec":2}`
   - `GET /api/sessions` → `{"ok":true,"sessions":[]}`
   - `GET /api/code?number=abc` → `{"ok":false,"status":"invalid_number","message":"That number has letters or symbols in it. Please send digits only, with your country code."}`
   - `GET /` → pairing page served (form + Get Code present); `GET /logo.png` → HTTP 200, 2,566,369 bytes. Server then killed cleanly.
6. **Offline command harness** (stub socket, real command code): menu sent as logo image with a 60-line caption in the purple-royal format; `.calc 12 * (3 + 4)` = 84; division by zero and a `process.exit()` injection attempt both rejected with the friendly message (the calculator is a hand-written parser, no eval); `.help pign` → "Did you mean: .ping, .list, .pair?"; fancy/password/b64/b64d/pair-validation/alive/list all produced correct output.

## Phase 2 extension points (documented choice)
The menu reserves Download / AI / Group / Status with a single line —
"🚧 Download, AI, Group and Status tools are coming in the next update." —
instead of empty categories. The loader auto-groups any new `commands/*.js`
file by its `category` field, so Phase 2 files (`download.js`, `ai.js`,
`group.js`, `status.js`) drop in with no menu or loader changes, and the
reserved line can then be removed.

## NOT tested (stated plainly)
- **Real WhatsApp pairing cannot be tested from this sandbox** — no live
  number was paired. The pairing *logic* (normalization, locks, rate limits,
  response shapes, code formatting) is unit-tested; the socket flow itself
  (custom code acceptance by WhatsApp, welcome DM delivery, identity-switch
  restart, channel auto-follow, reconnect after a real drop, loggedOut
  cleanup) is code-reviewed but needs the user's spare-number phone test
  after Railway deployment to be proven.
- MongoDB-backed auth/settings paths were not exercised (no real MONGO_URI
  available here); they share the same code paths as the tested file
  fallback and are guarded so a Mongo failure falls back instead of crashing.
- `.getdp`, `.getbio`, `.device` depend on live WhatsApp responses and were
  only verified to load and handle their error paths in code review.
