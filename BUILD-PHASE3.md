# PRIME MD — Phase 3 Build Record (Full Features)
Date: 2026-11-25 · Scope: plan sections 7 (Group), 8 (Personal automation),
10 (Media/Sticker), 11 (Islamic), 12 (Fun & Economy), 13 (Utility 2).
Fresh code only — no plugin files were copied from other bots; proven
behaviour was re-implemented. Phase 1/2 logic was NOT changed: the only
edits to earlier files are (a) additive wiring in `index.js` and
`lib/sessionManager.js` for the arrival/event hooks these features cannot
work without, (b) removal of the now-stale "🚧 Group tools are coming in
the next update." line from the menu in `commands/core.js`, and (c)
`form-data` promoted to a direct dependency in `package.json` (it was
already installed transitively via axios; `.tourl` requires it directly).

## Files created
- `commands/group.js` — 33 commands (Group)
- `commands/personal.js` — 22 commands (Personal)
- `commands/media.js` — 21 commands (Media)
- `commands/islamic.js` — 7 commands (Islamic)
- `commands/fun2.js` — 8 Fun + 5 Economy commands, plus the XP-award and
  quiz-answer hooks used by `index.js`
- `commands/utility2.js` — 11 commands (Utility)
- `lib/msgstore.js` — bounded per-session arrival store (300 msgs/session,
  24h TTL) that antidelete/antiedit depend on
- `lib/groupUtil.js` — group metadata (30s cache), admin checks, per-group
  settings + warns on top of the settings layer
- `lib/sticker.js` — webp sticker conversion + pack-exif embedding written
  directly into the RIFF container (no extra dependency), SVG text stickers
- `lib/automation.js` — the hook engine: status automations, group
  moderation, antidelete/antiedit recovery, AFK/sleep/autoreply,
  mention alerts, autovv, presence tools, welcome/goodbye events,
  call rejection
- `tests/phase3.test.js` — offline harness (13 tests)

## Files changed (additive only)
- `lib/sessionManager.js` — new `setEventHandler` export; each socket now
  forwards `group-participants.update`, `messages.update` and `call`
  events to it. No existing behaviour touched.
- `index.js` — every incoming message is also fed to `lib/msgstore` and
  `lib/automation.onMessage` (this is what lets status@broadcast traffic
  reach the status tools; the command flow still skips it exactly as
  before, and view-once capture still runs before the hooks so autovv can
  read the cache); `sessions.setEventHandler(...)` registered;
  `handleNonCommand` additionally routes messages through the quiz-answer
  check and the XP award (both Phase 3 hooks, after the existing moviedl
  pick handling, before AI Mode).
- `commands/core.js` — stale reserved menu line removed (1 line).
- `package.json` / `package-lock.json` — `form-data@^4.0.6` direct dep.

## Commands: 160 total (Phase 1+2's 53 intact) + 107 new, 0 duplicates
- Group (33): welcome, goodbye, antilink, antibad, antistatus, tagall,
  hidetag, tagadmin, kick, add, promote, demote, mute, unmute, lockgc,
  unlockgc, gclink, revoke, gcinfo, setgname, setgdesc, join, leave,
  newgc, requestlist, acceptreq, rejectreq, poll, warn, unwarn, warnings,
  antibot, groupbackup
- Personal (22): antidelete, antiedit, autovv, statussave, statusview,
  statusreact, anticall, alwaysonline, autotyping, autoread, autoreactdm,
  afk, autoreply, mentionalert, remind, note, notes, delnote, setbio,
  setname, blocklist, sleepmode
- Media (21): sticker, toimg, tomp4, emojimix, attp, ttp, blur, grayscale,
  invert, sepia, rotate, flipimg, crop, enlarge, compress, tourl, bass,
  slow, fast, reverse, nightcore
- Islamic (7): ayah, surah, hadith, asmaulhusna, prayer, qibla, dua
- Fun (8 new): ship, hack, rate, truth, dare, compliment, insult, meme
- Economy (5): level (alias rank), daily, balance, give, quiz (alias trivia)
- Utility (11 new): weather, news, crypto, define, wiki, shorten,
  translate, ssweb, currency, country, element
- Aliases total: 54. All toggles reply with their new ON/OFF state; group
  admin commands are gated on group-admin/owner/session-owner; join,
  leave, newgc, antibot and groupbackup are owner-gated.

## Design decisions worth knowing
- **Join requests are supported**: the installed Baileys 7.0.0-rc14 type
  definitions expose `groupRequestParticipantsList` and
  `groupRequestParticipantsUpdate` (verified in
  `node_modules/@whiskeysockets/baileys/lib/Socket/groups.d.ts`), so
  `.requestlist` / `.acceptreq` / `.rejectreq` are real, not stubs.
- **`.poll`** sends a native WhatsApp poll (`{ poll: { name, values,
  selectableCount } }`) — the group's own poll, which is allowed.
- **`.antibot` is report-only by design**: it lists hidden-number (@lid)
  participants as *possible* automated accounts and removes nobody; its
  reply says exactly that.
- **Antidelete/antiedit**: messages are stored on arrival (msgstore);
  revokes/edits are handled on BOTH paths Baileys exposes — a
  `protocolMessage` (type 0 = REVOKE, 14 = MESSAGE_EDIT) arriving via
  `messages.upsert`, and via `messages.update`. Recovered content goes to
  the session's own DM with who sent it and which chat it was in.
- **`.prayer` / `.qibla`**: Aladhan's `timingsByCity` returns placeholder
  coordinates (8.888…, 7.777…) for smaller Pakistani cities, so places are
  geocoded with OpenStreetMap Nominatim (Matiari → 25.5971858, 68.4454874,
  verified) and timings are requested BY coordinates
  (`/v1/timings/{DD-MM-YYYY}?latitude&longitude&method=1`) — the
  coordinate route even differed by a minute from the city route,
  confirming it is the accurate one. Qibla uses the Aladhan qibla endpoint
  on the same real coordinates (Matiari → 266.96°).
- **`.country`**: REST Countries is deprecated (v3.1 returns a deprecation
  error, v2 301s, the new host demands an API key), so country data comes
  from the World Bank open API (country list + population indicator, both
  verified live).
- **`.remind` is in-memory on purpose** and its own reply says reminders
  are lost on restart; `.note/.notes/.delnote` use the settings layer and
  DO survive restarts (harness-proven across a module reload).
- **Sleep mode** is one settings flag the automation hooks respect:
  calls are rejected (same path as anticall) and each DM sender gets one
  quiet reply; it reuses the AFK once-per-sender tracking store.
- **`.tourl`** tries catbox then litterbox with an honest failure reply —
  see the API table: every upload host returned an empty response from
  this sandbox, so uploads are NOT verified from here.
- **`.hack`** edits its own message through the prank steps where the
  connection supports message editing, and falls back to plain replies.

## Live API test table (all run 2026-11-25 from this sandbox)
| Endpoint | Pattern | Result |
|---|---|---|
| AlQuran Cloud ayah | `/v1/ayah/2:255/editions/quran-uthmani,en.asad` | ✅ 200 — full Arabic + Asad translation returned through the real `.ayah` command |
| AlQuran Cloud surah | `/v1/surah/36` | ✅ 200 — `.surah 36` → Yaseen, Meccan, 83 ayahs |
| Nominatim geocode | `nominatim.openstreetmap.org/search?q=Matiari, Pakistan` | ✅ 200 — lat 25.5971858, lon 68.4454874 |
| Aladhan timings by coords | `/v1/timings/25-11-2026?latitude=…&longitude=…&method=1` | ✅ 200 — `.prayer` (Matiari) Fajr 05:30 … Isha 18:56; Karachi differs correctly (Fajr 05:35) |
| Aladhan qibla | `/v1/qibla/24.6/67.0` and by real coords | ✅ 200 — `.qibla` Matiari → 266.96° (West) |
| Aladhan timingsByCity | `?city=Matiari&country=Pakistan` | ⚠️ 200 but meta coordinates are placeholders (8.888…, 7.777…) — NOT used; see geocode route above |
| Hadith gading.dev | `/books/muslim?range=1-5` | ❌ connection failed (000) |
| Hadith alternates | hadithapi.vercel.app (404), api.sunnah.com (403, key) | ❌ — `.hadith` therefore serves the planned built-in collection of 12 well-known hadith with sources |
| meme-api.com | `/gimme` | ✅ 200 — `.meme` sent a real meme image through the command |
| OpenTDB | `/api.php?amount=1&type=multiple` | ✅ 200 — `.quiz` produced a real question with shuffled options |
| VEXORA API weather | `/api/weather?q=Karachi` | ✅ 200 — full shape (temp/feels/humidity/wind/high/low/sunrise/sunset) through `.weather` |
| wttr.in (fallback) | `/Karachi?format=j1` | ✅ 200, 39 KB JSON |
| BBC News RSS | `feeds.bbci.co.uk/news/world/rss.xml` | ✅ 200 — `.news` listed real headlines with links |
| Dawn RSS (fallback) | `dawn.com/feeds/home` | ✅ 200, 388 KB XML |
| CoinGecko | `/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,pkr` | ✅ 200 — `.crypto bitcoin` → $59,440 / Rs 16,423,570 at test time |
| DictionaryAPI | `/api/v2/entries/en/hello` (+ serendipity via command) | ✅ 200 |
| Wikipedia summary | `/api/rest_v1/page/summary/Pakistan` | ✅ 200 — real extract through `.wiki` |
| is.gd | `/create.php?format=simple&url=…` | ✅ 200 — real short link created: https://is.gd/q0jCDH |
| MyMemory translate | `/get?q=…&langpair=en|ur` | ⚠️ 200 on the first test, HTTP 429 later (anonymous shared-IP quota) — wired; the failure reply now says the service may be rate-limiting. Google gtx fallback tested and blocked (HTML block page), not wired |
| thum.io | `/get/width/1200/<url>` | ✅ 200 image/png (29 KB) |
| open.er-api | `/v6/latest/USD` | ✅ 200 — `.currency 100 USD PKR` → 27,639.19 PKR |
| REST Countries | v3.1 / v2 / v5 / api.restcountries.com | ❌ deprecated or key-gated — replaced by World Bank (below) |
| World Bank countries | `/v2/country/all?format=json&per_page=400` | ✅ 200 — `.country Pakistan` → Islamabad, region, income level, coords |
| World Bank population | `/v2/country/PAK/indicator/SP.POP.TOTL` | ✅ 200 — 255,219,554 (2025) |
| IMDb keyless sources | search.imdbot.workers.dev (500, twice), api.imdbapi.dev (unreachable) | ❌ — **`.imdb` and `.movie` were left out on purpose**; results must never be faked |
| Emoji Kitchen CDN | `gstatic.com/android/keyboard/emojikitchen/{date}/{code}/{a}_{b}.png` | ✅ pattern verified — 😀+🤩 → 200 PNG (20201001 folder) through the real fetch code; most pairs 404, `.emojimix` scans the known date folders and fails friendly |
| Upload hosts (.tourl) | catbox, litterbox, 0x0.st, uguu, tmpfiles | ❌ all returned empty responses from this sandbox — catbox→litterbox wired with an honest failure reply; NOT verified from here |

## Verification — all run 2026-11-25
1. **`node --check` on all 39 project .js files**: **39/39 OK**.
2. **Loader test**: **160 commands** (Core 10, Owner 5, Utility 22, Fun 14,
   Download 12, AI 5, View Once 2, Status 2, Group 33, Personal 22,
   Media 21, Islamic 7, Economy 5), **54 aliases, duplicates: 0**.
   Phase 1+2 commands all intact.
3. **Offline harness** (`node tests/phase3.test.js`): **13/13 PASS** —
   welcome fires on participant add with @mention + member count (+
   goodbye stays silent while off); warn ×3 triggers exactly one remove
   call and resets the counter; antilink deletes a non-admin's link
   message but not an admin's; sticker pipeline produces a real 512px
   webp with the PRIME MD pack exif; attp renders a real webp sticker;
   XP increments once then the 60s cooldown blocks; daily pays 100 coins
   once and refuses the second claim; quiz flow awards +10 coins for a
   correct answer and 0 for a wrong one; antidelete store returns the
   exact stored message; a revoke event re-sends the stored message to
   the owner DM and consumes the entry; emojimix resolves the live
   😀+🤩 combo (and fails gracefully on an unknown pair); notes survive
   a full settings-module reload from the file-backed store.
4. **Live command pass**: every API-backed Phase 3 command was run
   end-to-end against the real services (outputs in the table above) —
   ayah, surah, prayer (Matiari + Karachi), qibla, weather, news, crypto,
   define, wiki, shorten, currency, country, element, quiz, meme all
   returned real data; translate hit the MyMemory quota (429) after its
   first verified 200.
5. **Regression**: Phase 1 suites still pass (normalize 9/9, pairing
   suite pass) and the Phase 2 harness still passes **11/11**.
6. **Boot smoke test** (MONGO_URI unset, PORT=3999): booted clean,
   `[commands] loaded 160 commands, 0 duplicates`,
   `GET /api/status` → `{"ok":true,...,"commands":160,...}`,
   `GET /api/sessions` → `{"ok":true,"sessions":[]}`. Killed cleanly.

## NOT tested (stated plainly)
- **Real group events on a live session** — welcome/goodbye, kicks,
  promotes, join-request approvals, poll delivery and groupbackup depend
  on a paired WhatsApp session and real groups; they are harness-proven
  against stub sockets and code-reviewed against the Baileys 7 API.
- **Call rejection** (`.anticall` / sleep mode) — `rejectCall` exists in
  the installed Baileys types and the event wiring is in place, but no
  real call can be received in this sandbox.
- **Status automations on live statuses** — statusview/statusreact/
  statussave and the 'save' reply trigger are wired to status@broadcast
  arrivals and unit-reviewed; WhatsApp's acceptance of status reactions
  and reads can only be proven on the deployed bot.
- **Profile changes** — `.setbio` / `.setname` call the real Baileys
  methods (`updateProfileStatus` / `updateProfileName`, verified in the
  type definitions) but were not executed against a live account.
- **Antidelete/antiedit against real revoke/edit payloads** — both
  Baileys delivery paths are implemented and the store + recovery flow
  is harness-proven; the exact payload shape WhatsApp sends on a live
  session can differ (e.g. stub-type revokes), which only a live test
  can confirm.
- **`.tourl` uploads** — all free upload hosts returned empty responses
  from this sandbox (the same sandbox behaviour recorded for VORTEX);
  the command is wired catbox → litterbox and reports failure honestly.
- **Animated-sticker → MP4 on a real sticker** — the ffmpeg webp decode
  path is the same verified ffmpeg build; no real animated sticker was
  available in the sandbox to convert end-to-end.
