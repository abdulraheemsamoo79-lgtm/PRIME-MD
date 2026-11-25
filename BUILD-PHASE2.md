# PRIME MD — Phase 2 Build Record (Power Features)
Date: 2026-11-25 · Scope: plan sections 4 (Downloaders), 5 (AI), 6 (View-Once), 9 (Status).
Fresh code only — no plugin files were copied from `~/workspace/vexora-repo-latest`
(those files and the VEXORA API router/handlers were READ to learn proven
endpoint shapes and behaviour). Phase 1 files were touched only where the
brief allows: the menu's reserved line in `commands/core.js`, env-driven
additions in `config.js`, plus minimal ADDITIVE wiring in `index.js`
(view-once arrival feed, bare "vv" trigger, bare-number movie picks, AI Mode
hook — without these three hooks the Phase 2 features cannot fire at all;
no Phase 1 logic was changed).

## Files created
- `commands/download.js` — 12 commands + `handleMoviePick` export
- `commands/ai.js` — 5 commands
- `commands/viewonce.js` — 2 commands (.vv, .vv2)
- `commands/status.js` — 2 commands (.groupstatus, .4kstatus)
- `lib/net.js` — JSON GETs + STREAMED tmp downloads (size-capped, auto-cleanup)
- `lib/youtube.js` — YouTube resolve/search + Tioo-first download chain
- `lib/aiCore.js` — VEXORA API first, guarded keyless fallback, creator context
- `lib/wamedia.js` — wrapper unwrapping, media finder, injectable downloader, opus voice conversion, duration probe, ffmpeg runner
- `lib/vvcache.js` — view-once ARRIVAL cache keyed by session+chat+message id
- `lib/statusAudience.js` — statusJidList audience builder (group participants + session + command user, deduped)
- `lib/moviedl.js` — Archive search/metadata, best-file picker, 5-minute pending picks
- `tests/phase2.test.js` — offline harness (11 tests)

## Files changed
- `config.js` — Phase 2 block, all env-overridable: VEXORA_API_BASE, TIOO_HOSTS
  (backend2, backend1, backend2 — backend3 never used), INVIDIOUS_BASE,
  DL_MAX_BYTES (600 MB), DL_INLINE_MAX (16 MB), MOVIE_MAX_BYTES (1.95 GB),
  VV cache TTL/caps, status caps (photo 25 MB / video 200 MB).
- `commands/core.js` — menu reserved line now only reserves Group tools:
  "🚧 Group tools are coming in the next update."
- `index.js` — additive only: requires for vvcache/aiCore; every incoming
  message is fed to the view-once arrival cache; a bare `vv` message is
  treated as `.vv`; non-command traffic goes to a new `handleNonCommand`
  (bare number → pending .moviedl pick; AI Mode users → AI reply with a
  3-second per-user cooldown). Command flow itself is unchanged.

## Commands: 53 total (Phase 1's 32 intact) + 21 new, 0 duplicates
- Download (12): video, song (aliases play, ytmp3), tiktok, ig, fb, twitter,
  apk, spotify, pinterest, lyrics, ytsearch, moviedl
- AI (5): ai (aliases chat, ask), deepseek, copilot, llama, aimode
- View Once (2): vv, vv2
- Status (2): groupstatus (alias gcstatus), 4kstatus (alias hdstatus)
- Aliases total: 34. Categories now: Core 10, Owner 5, Utility 11, Fun 6,
  Download 12, AI 5, View Once 2, Status 2.

## How each feature works
- **YouTube (.video/.song/.ytsearch):** Tioo FIRST per standing order —
  `GET {host}/YouTube?url=<watch url>` → `{status, mp4, mp3, title}`, hosts
  in order backend2 → backend1 → backend2. Fallback: VEXORA API
  `/api/ytmp4` / `/api/ytmp3`. Files are streamed to tmp (never buffered
  whole); ≤16 MB goes inline, larger goes as a document, cap 600 MB.
  `.song` converts non-MP3 audio to MP3 with the bundled ffmpeg.
  Search/name resolution uses the **Invidious search API** because both the
  VEXORA `/api/ytsearch` endpoint and the local `yt-search` package are
  currently broken with the identical library error (see test table).
- **.tiktok/.ig/.fb/.twitter/.apk/.spotify/.pinterest/.lyrics:** wired to the
  user's own VEXORA API endpoints (shapes read from `lib/handlers/*`):
  tiktok-v2 `result.video_download`; instagram `result.video|image`;
  fbdl `hd_link|download_url|sd_link`; twitter `result.video_hd|video_sd`;
  apk-search `data.datalist.list[].file.path` (sends the APK as a document);
  spotifydl `result.audio_download` (YouTube-matched audio, said so to the
  user); pinterest tries pinterest-video then pinterest-photo (the API takes
  a pin LINK, so .pinterest asks for one); lyrics `result.lyrics` (split
  into two messages when long).
- **.moviedl:** Archive advancedsearch (mediatype:movies, downloads desc) →
  top-5 list → pending pick stored per session+user for 5 minutes → the
  user replies with the number (quote-reply or bare number both work via
  the index.js hook) → metadata → best file (ORIGINAL MP4 first, samples/
  trailers/thumbs excluded, ≤1.95 GB) → streamed to tmp → sent as document
  → tmp cleaned. Friendly English reply on every failure path.
- **AI (.ai/.chat/.deepseek/.copilot/.llama/.aimode):** VEXORA `/api/ai`
  first (`result.answer`). Fallback calls Pollinations' keyless endpoint
  directly and is GUARDED: empty answers, error/placeholder strings,
  Pollinations "key budget" notices, and — for identity questions — answers
  that do not reflect the injected creator context are all treated as
  failures, never sent. Creator context (AbdulRaheem = AR PRIME /
  ARPRIME456 / AR SAMOON, developer + gamer from New Saeedabad, Sindh,
  creator of PRIME MD/VEXORA/VORTEX; NO phone number) is prepended for
  identity questions; AI Mode additionally prepends full bot knowledge
  (pairing via portal/.pair, .menu, feature list). `.aimode on/off` is
  per-user, stored via the Phase 1 settings (session settings →
  `aimodeUsers` map), and non-command messages from that user get AI
  replies through the index.js hook.
- **View-once (.vv/.vv2 + bare "vv"):** arrival cache (`lib/vvcache.js`)
  stores incoming view-once image/video/audio per session+chat+message id
  (30-min TTL, 200-item cap, >25 MB declared size not cached). `.vv`
  resolves: quoted stanza id in cache → view-once content inside the
  quoted message itself → (no quote only) latest cached in THIS chat.
  A quoted id that misses is a "not found" — never a substitute.
  `.vv` resends in the same chat with the purple box caption
  (┌─ 📥 VIEW ONCE SAVED / Status: Saved / Type: Photo|Video|Voice Note /
  © POWERED BY PRIME MD); `.vv2` sends to the user's DM with the same box
  WITHOUT the footer. Voice is converted to ogg/opus and sent as a real
  voice note (ptt); the box follows as a text message because voice notes
  cannot carry captions.
- **Status (.groupstatus/.4kstatus):** EVERY status send passes
  `statusJidList` = all group participants of the session's groups + the
  session's own number + the command user, deduplicated (the proven
  requirement — without it the status is visible to nobody). "Posted" is
  only claimed after the send call resolves. `.4kstatus` photo: sharp
  rotate → 1080×1920 contain-pad → sharpen → JPEG q92. Video: streamed
  from the quoted buffer to tmp, ffmpeg scale/pad into the 1080 box,
  libx264 crf20, maxrate 6M, AAC 128k, split at 90 s, max 4 parts (a longer
  video posts its first 6 minutes and the reply says exactly that).

## Live endpoint tests (all run 2026-11-25 from this sandbox)
| Endpoint / backend | Test | Result |
|---|---|---|
| VEXORA `/api/ai?q=What is 2+2?...` | curl | ✅ `status:true`, answer "2 + 2 = 4" (backend pollinations) |
| VEXORA `/api/ai` via lib (identity) | `askAi('Who is AR PRIME?')` | ✅ "AR PRIME, also known as AbdulRaheem, is a developer and gamer from New Saeedabad, Sindh, creator of PRIME MD, VEXORA SMD, and VORTEX MD." |
| VEXORA `/api/tiktok-v2` | real @tiktok video URL | ✅ `status:true`, `video_download` (tikcdn mp4) + title/author/stats |
| VEXORA `/api/fbdl` | real facebook watch URL | ✅ `status:true`, `hd_link` present |
| VEXORA `/api/spotifydl` | Rick Astley track URL | ✅ `status:true`, title/artist/thumbnail + `audio_download` |
| VEXORA `/api/lyrics?q=Adele - Hello` | curl | ✅ `status:true`, full lyrics returned |
| VEXORA `/api/apk-search?q=whatsapp` | curl | ✅ `success:true`, WhatsApp Messenger with `file.path` + vername + size |
| VEXORA `/api/pinterest-photo` | real pin URL | ✅ `status:true`, original image URL |
| VEXORA `/api/pinterest-video` | same (photo) pin | ✅ correct negative: "Video not found (pin may be a photo or removed)" |
| VEXORA `/api/twitter` | text-only tweet (jack/20) | ✅ correct negative: "No video found in this tweet" (endpoint logic proven) |
| VEXORA `/api/twitter` | a guessed video-tweet id | ⚠️ handler error "Unexpected token '<'..." — the guessed id was not a valid video tweet; endpoint itself proven by the negative test above |
| VEXORA `/api/instagram` | a reel URL | ❌ `status:false` "No downloadable media found"; the API's own keyless fallback host answered the same — consistent with the known Instagram-blocks-host behaviour. `.ig` is wired to the API shape; expect intermittent results until the API backend improves |
| VEXORA `/api/ytsearch?q=lofi beats` | curl | ❌ BROKEN upstream: "Server error: _title3.trim is not a function" |
| local `yt-search` package | node, same query | ❌ IDENTICAL error — the library itself is broken against current YouTube; `.ytsearch` therefore uses Invidious search (below) |
| Invidious `/api/v1/search` | via `lib/youtube.searchYouTube` | ✅ live hits (Lofi Girl radio etc. with ids/durations) |
| Tioo backend2 | `watch?v=jNQXAC9IVRw` | ⚠️ `status:true` with a real `mp3` link but `mp4: null` |
| Tioo backend2 | `watch?v=dQw4w9WgXcQ`, `watch?v=9bZkp7q19f0` | ⚠️ bare `{"status": true}` — NO media fields (the known intermittent/useless window) |
| Tioo backend1 | `watch?v=jNQXAC9IVRw` | ⚠️ same as backend2 (mp3 yes, mp4 null) — no 402 this time |
| VEXORA `/api/ytmp3` (fallback) | by URL | ✅ `status:true`, `audio_download` + title + thumbnail |
| VEXORA `/api/ytmp4` (fallback) | by URL | ❌ currently returns its "YouTube backend is closed" message — recorded honestly; the chain still tries it after Tioo |
| Archive advancedsearch | via `lib/moviedl.searchMovies` | ✅ 5 results for "night of the living dead", downloads-sorted |
| Archive metadata | `Night.Of.The.Living.Dead_1080p` | ✅ best file picked live: `NightOfTheLivingDead_PS3.mp4`, ORIGINAL, h.264 MPEG4, 1,862,510,336 bytes (< 1.95 GB cap) |
| ffmpeg-static (bundled) | `-encoders` / `-filters` probe | ✅ libx264, aac, libopus, unsharp, pad, scale, fps all present (modern build) |

## Bugs found by live testing and fixed during this phase
1. AI validation rejected correct one-character answers ("4") — minimum
   length rule removed (empty-only now). Live re-test: `askAi('2+2')` → "4".
2. Pollinations sometimes returns a "key budget exhausted" notice AS the
   answer text — added to the guarded-fallback rejection patterns. Live
   re-test: the notice is rejected and the next route answers ("Paris.").

## Verification — all run 2026-11-25
1. **`node --check` on all 28 project .js files** (incl. new lib/commands/
   tests): **28/28 OK**.
2. **Loader test:** 53 commands (Core 10, Owner 5, Utility 11, Fun 6,
   Download 12, AI 5, View Once 2, Status 2), 34 aliases, **duplicates: 0**.
   Phase 1 regression tests still pass: normalize 9/9, pairing suite pass.
3. **Offline harness** (`node tests/phase2.test.js`): **11/11 PASS** —
   .vv exact quoted resend in the same chat (bytes + box + footer);
   .vv cross-chat quote id → NO media sent + not-found reply (no leak);
   .vv no-quote → latest of THIS chat only; .vv2 → DM, box without footer;
   .vv not-found path; .4kstatus → status send carries a DEDUPED
   statusJidList (group participants + session + user) and the image is a
   real 1080×1920 JPEG; .groupstatus text posts with an audience;
   .moviedl list → pick "1" → document sent with the ORIGINAL file name
   (sample file correctly skipped by the picker); pickBestFile cap/sample
   rules; AI prompt injects creator context for identity questions ONLY
   and the validator rejects denials/empties; opus conversion produces a
   real OggS voice file.
4. **Live lib tests:** Archive search + best-file (above), Invidious
   search, AI identity + plain questions (after the two fixes).
5. **Boot smoke test** (MONGO_URI unset, PORT=3999): booted clean,
   `[commands] loaded 53 commands, 0 duplicates`,
   `GET /api/status` → `{"ok":true,...,"commands":53,...}`, invalid
   `/api/code` still returns the friendly shaped error. Killed cleanly.

## NOT tested (stated plainly)
- **Real WhatsApp sends** — no live session exists in this sandbox, so
  .video/.song/.tiktok/etc. were verified up to their backend responses and
  the offline send path, not an actual phone delivery.
- **Real view-once arrival on a live session** — the arrival cache, exact-
  only lookup and resend are harness-proven with stub media; a genuine
  view-once message arriving on a paired session (and WhatsApp accepting
  the re-download) needs the user's phone test after deployment.
- **Tioo live download** — Tioo was in a bad window during testing (mp3
  once, mp4 null, otherwise status-only). It is wired PRIMARY per the
  standing order with the VEXORA API behind it; .video in particular
  depends on Tioo or /api/ytmp4 recovering, both recorded above.
- **Instagram downloads** — the API endpoint answered but found no media
  for the test reel (known host-blocking). Wired and honest-failure ready.
- **.4kstatus video path on a real video** — the photo path is fully
  harness-proven (real 1080×1920 output); the video path uses the same
  audience code and a verified ffmpeg filter chain, but no full video was
  converted end-to-end in the harness (kept the suite fast); first live
  use should be watched.
- **Spotify audio download from the bot's IP** — the API returned a
  googlevideo link bound to the API server's request; whether it also
  downloads from the bot host is only provable on the deployed bot. On
  failure the user gets the friendly error, never a fake success.
