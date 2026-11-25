# PRIME MD — WhatsApp Bot

**PRIME MD** is a powerful multi-session WhatsApp bot built on the official
Baileys library. Many users connect their own WhatsApp numbers to one server
through a simple pairing-code page, and every connected number gets the full
command set: downloads, AI chat, group management, view-once saving, HD status
posting, media tools, Islamic content, fun and economy features, and more.

- **169 commands** (plus 60 aliases) in 13 categories
- Multi-session engine with a per-server session limit and `SERVER_ID` support
  for running several servers side by side
- Sessions stored in MongoDB (with an automatic local-file fallback)
- Built-in web pairing page and a password-protected admin panel
- Purple Royal theme with the PRIME MD logo in the menu and on the web pages

## Pairing a number

1. Open the bot's web page (locally `http://localhost:3000`, or your deployed
   domain).
2. Enter your WhatsApp number with country code, for example `923001234567`.
   Common shapes are fixed automatically: `0300...`, `+92 300 ...` and numbers
   typed with spaces or dashes all work.
3. The page shows an 8-character pairing code. PRIME MD first tries its custom
   code **PRIMEMD**; if WhatsApp refuses a custom code, a normal random code is
   used instead — pairing never fails just because of the custom code.
4. On your phone: WhatsApp → Settings → Linked devices → Link a device →
   **Link with phone number instead** → type the code.
5. As soon as the number connects, the bot sends a welcome message in your own
   chat with the first steps. Send `.menu` to see everything.

Pairing is protected against the mistakes that break other bots: one pending
pairing per number (no duplicate sockets), a fresh code is not issued for a
number that is already connected, pending pairings expire after 3 minutes, and
pairing attempts are rate-limited per number and per IP so WhatsApp never locks
the account. The pairing handshake uses a desktop identity (that is what makes
WhatsApp issue codes), while the connected session itself runs with an Android
phone identity — that is what makes view-once media arrive correctly.

## Commands

Every command starts with the `.` prefix. Send `.help <command>` in WhatsApp
for the exact usage of any command. The full list:

### Core (10)

- `.alive` - Show bot status, uptime and live session count.
- `.help` - Show the help page, or details for one command. _(aliases: .guide)_
- `.list` - Show all commands grouped by category (text only).
- `.menu` - Show the PRIME MD menu with all commands. _(aliases: .m)_
- `.mode` - Show the current bot mode (public or private).
- `.owner` - Show the bot owner card.
- `.pair` - Get a pairing code for a WhatsApp number.
- `.ping` - Check that the bot is alive and how fast it answers.
- `.runtime` - Show how long the bot has been running. _(aliases: .uptime)_
- `.server` - Show server and session information. _(aliases: .serverinfo)_

### Owner (10)

- `.ban` - Ban a number from using PRIME MD and remove its session (owner only).
- `.banlist` - Show every banned number (owner only). _(aliases: .banned)_
- `.broadcast` - Send an announcement to the own chat of every connected user (owner only). _(aliases: .announce)_
- `.delsession` - Disconnect and delete a session (owner only). _(aliases: .sessiondel)_
- `.health` - Session health report for this server (owner only).
- `.private` - Switch this session to private mode (owner only).
- `.public` - Switch this session to public mode (owner only).
- `.restart` - Restart the bot server (owner only). Sessions are saved and come back automatically.
- `.sessions` - List all live sessions on this server (owner only). _(aliases: .listsessions)_
- `.unban` - Remove a number from the ban list (owner only).

### Download (16)

- `.apk` - Search for an Android app and send its APK file. _(aliases: .apkdl)_
- `.drama` - Find a drama episode by name and choose DOCUMENT or VIDEO. _(aliases: .darama)_
- `.fb` - Download a Facebook video or reel. _(aliases: .facebook, .fbdl)_
- `.gdrive` - Download a public file from a Google Drive link. _(aliases: .gd)_
- `.ig` - Download an Instagram post or reel. _(aliases: .igdl, .instagram)_
- `.lyrics` - Find the lyrics of a song. _(aliases: .lyric)_
- `.mediafire` - Download a file from a MediaFire link. _(aliases: .mfdl)_
- `.mega` - Download a file from a Mega link. _(aliases: .megadl)_
- `.moviedl` - Search Internet Archive movies and download one as a document. _(aliases: .movie)_
- `.pinterest` - Download a Pinterest pin (photo or video) from its link. _(aliases: .pin)_
- `.song` - Download a song as MP3 audio (YouTube link or song name). _(aliases: .play, .ytmp3)_
- `.spotify` - Download the audio of a Spotify track (matched from YouTube). _(aliases: .spotifydl)_
- `.tiktok` - Download a TikTok video without watermark. _(aliases: .tt, .ttdl)_
- `.twitter` - Download a video from a Twitter / X post. _(aliases: .x, .twdl)_
- `.video` - Download a YouTube video (link or search words). _(aliases: .ytvideo, .ytmp4)_
- `.ytsearch` - Search YouTube and list the top results (links only). _(aliases: .yts)_

### AI (5)

- `.ai` - Chat with the PRIME MD AI assistant. _(aliases: .chat, .ask)_
- `.aimode` - Turn AI Mode on or off for yourself. When on, the bot answers your normal messages with AI.
- `.copilot` - Chat with the Copilot assistant.
- `.deepseek` - Chat with the DeepSeek assistant.
- `.llama` - Chat with the Llama assistant.

### View Once (2)

- `.vv` - Save a view-once photo, video or voice note into this same chat.
- `.vv2` - Save a view-once photo, video or voice note into your DM.

### Status (2)

- `.4kstatus` - Post a quoted photo or video to your status in HD (1080x1920). Videos are split into 90-second parts, max 4. _(aliases: .hdstatus)_
- `.groupstatus` - Post text or a quoted photo, video, audio or sticker to your own WhatsApp status. _(aliases: .gcstatus)_

### Group (33)

- `.acceptreq` - Approve a pending group join request (admins only).
- `.add` - Add a member to the group by number (admins only).
- `.antibad` - Delete messages with bad words from non-admins and warn the sender.
- `.antibot` - Report possible bot/automated accounts in the group (report only - nobody is removed).
- `.antilink` - Delete link messages from non-admins and warn the sender.
- `.antistatus` - Delete status-share messages posted in the group by non-admins.
- `.demote` - Demote a group admin back to member (admins only).
- `.gcinfo` - Show information about this group. _(aliases: .groupinfo)_
- `.gclink` - Get the group invite link. _(aliases: .linkgc)_
- `.goodbye` - Turn goodbye messages for leaving members on or off.
- `.groupbackup` - Export this group's settings and member list as a JSON file to your DM (owner only). _(aliases: .gcbackup)_
- `.hidetag` - Send a message that silently tags every group member.
- `.join` - Make the bot join a group from an invite link (owner only).
- `.kick` - Remove a member from the group (admins only). _(aliases: .remove)_
- `.leave` - Make the bot leave this group (owner only).
- `.lockgc` - Lock group settings so only admins can edit group info (admins only).
- `.mute` - Mute the group - only admins can send messages (admins only).
- `.newgc` - Create a new group with the given name (owner only).
- `.poll` - Create a native WhatsApp poll. Separate the question and options with |.
- `.promote` - Promote a member to group admin (admins only).
- `.rejectreq` - Reject a pending group join request (admins only).
- `.requestlist` - List pending group join requests (admins only). _(aliases: .reqs)_
- `.revoke` - Reset the group invite link (admins only). _(aliases: .resetlink)_
- `.setgdesc` - Change the group description (admins only).
- `.setgname` - Change the group name (admins only).
- `.tagadmin` - Tag all group admins.
- `.tagall` - Tag every group member with a visible numbered list (admins only). _(aliases: .everyone)_
- `.unlockgc` - Unlock group settings so members can edit group info (admins only).
- `.unmute` - Unmute the group - everyone can send messages again (admins only).
- `.unwarn` - Remove one warning from a member (admins only).
- `.warn` - Warn a member. At 3 warnings the member is removed (admins only).
- `.warnings` - Check how many warnings a member has. _(aliases: .warns)_
- `.welcome` - Turn fancy welcome messages for new members on or off.

### Personal (22)

- `.afk` - Set yourself away with a reason. DM senders get one auto-reply; it turns off when you send a message.
- `.alwaysonline` - Keep your presence shown as online.
- `.anticall` - Automatically reject incoming calls with a polite message.
- `.antidelete` - Recover deleted messages to your own DM (messages are stored when they arrive).
- `.antiedit` - Show the old and new text in your DM when someone edits a message.
- `.autoreactdm` - Automatically react to DM messages with a heart.
- `.autoread` - Automatically mark incoming messages as read.
- `.autoreply` - Set a custom auto-reply text for DMs (sent once per sender).
- `.autotyping` - Show a typing indicator when messages arrive.
- `.autovv` - Automatically save incoming view-once media to your own DM.
- `.blocklist` - List the numbers you have blocked.
- `.delnote` - Delete a note by its number (see .notes).
- `.mentionalert` - Get a DM alert when you are mentioned or quoted in a group.
- `.note` - Save a note. Notes are stored in the database and survive restarts.
- `.notes` - List all your saved notes.
- `.remind` - Remind yourself in N minutes. Note: reminders are kept in memory and are lost if the bot restarts.
- `.setbio` - Change your WhatsApp bio (profile status).
- `.setname` - Change your WhatsApp profile name.
- `.sleepmode` - Night bundle: rejects calls and quietly replies once to each DM sender while you sleep.
- `.statusreact` - Automatically react to statuses with emojis.
- `.statussave` - Auto-save incoming status media to your DM. You can also reply "save" to any status.
- `.statusview` - Automatically view (read) every status that arrives.

### Media (21)

- `.attp` - Turn text into a colourful sticker (rendered locally, no external API).
- `.bass` - Boost the bass of an audio file or voice note.
- `.blur` - Blur a photo.
- `.compress` - Compress a photo to a much smaller file size.
- `.crop` - Crop a photo into a centred square.
- `.emojimix` - Mix two emojis into one sticker (Google Emoji Kitchen). Not every pair exists.
- `.enlarge` - Upscale a photo to 2x its size. _(aliases: .hdimg)_
- `.fast` - Speed an audio file up.
- `.flipimg` - Flip a photo upside down.
- `.grayscale` - Make a photo black and white. _(aliases: .greyscale)_
- `.invert` - Invert the colours of a photo.
- `.nightcore` - Nightcore effect: faster and higher pitched.
- `.reverse` - Play an audio file in reverse.
- `.rotate` - Rotate a photo by 90 degrees, or by a given angle.
- `.sepia` - Give a photo a warm sepia tone.
- `.slow` - Slow an audio file down.
- `.sticker` - Turn a photo or short video into a sticker (PRIME MD pack). _(aliases: .s)_
- `.toimg` - Convert a sticker back into an image.
- `.tomp4` - Convert an animated sticker into an MP4 video. _(aliases: .tovideo)_
- `.tourl` - Upload a photo and get a public link for it.
- `.ttp` - Turn text into a plain sticker (rendered locally).

### Islamic (7)

- `.asmaulhusna` - The 99 Names of Allah. Give a number for one name, or no number for a page of names. _(aliases: .99names)_
- `.ayah` - Get a Qur'an verse in Arabic with English translation (AlQuran Cloud).
- `.dua` - Get a daily dua in Arabic with its English translation and source.
- `.hadith` - Get a hadith from a small built-in collection of well-known authentic hadith (online hadith APIs were unavailable).
- `.prayer` - Get today's prayer times for a city (geocoded, then Aladhan by coordinates). Default: Matiari, Pakistan. _(aliases: .namaz, .salah)_
- `.qibla` - Get the Qibla direction for a city (geocoded, then the Aladhan qibla endpoint).
- `.surah` - Get information about a Surah by its number (1-114).

### Fun (14)

- `.choose` - Let the bot choose between options separated by "or".
- `.coin` - Flip a coin. _(aliases: .flip)_
- `.compliment` - Give a compliment to a tagged user, or yourself.
- `.dare` - Get a dare for truth-or-dare games.
- `.dice` - Roll a dice (1-6, or .dice 20 for a bigger one). _(aliases: .roll)_
- `.fact` - Get a random interesting fact.
- `.hack` - A prank "hacking" progress joke. Completely fake and harmless.
- `.insult` - A light, friendly roast for a tagged user. All in good fun.
- `.joke` - Get a random clean joke.
- `.meme` - Fetch a fresh meme (meme-api.com, with a built-in fallback).
- `.quote` - Get a random motivational quote.
- `.rate` - Rate anything out of 10 (random, just for fun).
- `.ship` - Check the love match between you and a tagged user (just for fun).
- `.truth` - Get a truth question for truth-or-dare games.

### Economy (5)

- `.balance` - Check your coin balance. _(aliases: .bal)_
- `.daily` - Claim your daily reward of 100 coins (once every 24 hours).
- `.give` - Give some of your coins to a tagged user.
- `.level` - See your XP level and coin balance. You earn XP by chatting (once a minute). _(aliases: .rank)_
- `.quiz` - Answer a trivia question to earn 10 coins. Reply with the correct option text. _(aliases: .trivia)_

### Utility (22)

- `.b64` - Encode text to Base64.
- `.b64d` - Decode Base64 back to text.
- `.calc` - Calculate a math expression.
- `.country` - Get facts about a country (World Bank open data - REST Countries has been deprecated).
- `.crypto` - Get a cryptocurrency price in USD and PKR (CoinGecko).
- `.currency` - Convert money between currencies (open.er-api.com rates).
- `.define` - Get the dictionary meaning of an English word. _(aliases: .dict)_
- `.device` - Show which device a user sent their message from (quote their message).
- `.element` - Get facts about a chemical element from the built-in periodic table data.
- `.fancy` - Turn text into fancy bold styles.
- `.getbio` - Get the About/bio of the quoted, mentioned or given user.
- `.getdp` - Get the profile photo of the quoted, mentioned or given user. _(aliases: .dp)_
- `.id` - Show your user ID, this chat ID and the session number.
- `.news` - Get the latest world headlines (BBC News RSS, Dawn as fallback).
- `.password` - Generate a strong random password. _(aliases: .pass)_
- `.qrcode` - Turn text or a link into a QR code image. _(aliases: .qr)_
- `.shorten` - Shorten a long URL (is.gd).
- `.ssweb` - Take a screenshot of a web page (thum.io). _(aliases: .screenshot)_
- `.time` - Show the current date and time (Pakistan time and UTC). _(aliases: .date)_
- `.translate` - Translate text into another language (MyMemory).
- `.weather` - Get the current weather for a city (VEXORA API first, wttr.in fallback).
- `.wiki` - Get a short Wikipedia summary of a topic.

## Owner tools

The bot owner (the `OWNER_NUMBER` in `config.js`) controls every session:

- `.broadcast <text>` sends an announcement to the **own chat of every
  connected user** — deliberately never to groups, so an announcement can
  never spam other people's chats. The owner gets a sent/failed report.
- `.ban <number>` blocks a number from using the bot anywhere and removes its
  session if it has one. `.unban` and `.banlist` manage the list. The owner
  can never be banned.
- `.health` shows a live health report: every session with its status, mode
  and connected time, plus totals.
- `.restart`, `.sessions`, `.delsession`, `.public` / `.private` manage the
  server and per-session mode.

## Admin panel

Open `/admin` on the bot's web address.

- The panel is **disabled by default**. Set the `ADMIN_PASS` environment
  variable to enable it; without it, `/admin` only shows a short "disabled"
  notice. There is no default password.
- Log in with that password. Login sets an httpOnly cookie (random token,
  12 hours). Failed logins are rate-limited: after 5 wrong tries from one IP,
  further tries are refused for 10 minutes.
- The panel shows the server name, session count against the limit, and every
  live session (number, connected status, mode) with a **Disconnect** button
  that removes that session.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `MONGO_URI` | _(empty)_ | MongoDB connection string for sessions and settings. Empty = local file storage under `data/` (fine for one small server; use MongoDB for real deployments). |
| `PORT` | `3000` | Web server port (pairing page, API, admin panel). |
| `SERVER_ID` | `1` | This server's ID. Sessions are stamped with it; run one server per ID. |
| `SERVER_NAME` | `SERVER 01` | Display name of this server. |
| `SESSION_LIMIT` | `50` | Maximum live sessions on this server. |
| `ADMIN_PASS` | _(empty)_ | Admin panel password. Empty = panel disabled. |
| `BROADCAST_DELAY_MS` | `1500` | Pause between `.broadcast` sends. |
| `OWNER_NUMBER` | `923138702477` | The bot owner's WhatsApp number (digits only). The owner controls every session and can never be banned. |
| `PAIR_CODE` | `PRIMEMD` | Custom pairing code tried first for every pairing. |
| `VEXORA_API_BASE` | `https://vexora-api-orcin.vercel.app` | Base URL of the VEXORA API used by the AI and some download commands. |
| `PUBLIC_BASE_URL` | _(empty)_ | Public base URL of this deployment, when it must be stated explicitly. |

The owner number (`OWNER_NUMBER`) and the custom pair code (`PAIR_CODE`) also
have defaults in `config.js` and can be overridden by env. Shared limits
(download caps, timeouts) live in `config.js` too.

## Run it locally

```bash
npm install
MONGO_URI= ADMIN_PASS=yourpassword node index.js
```

Leave `MONGO_URI` empty for a quick local run — sessions are then stored as
files under `data/`. Open `http://localhost:3000` to pair a number.

## Deploy on Railway

1. Create a new Railway project from this repository.
2. Add a MongoDB database service in the same project (or use a MongoDB Atlas
   connection string).
3. Set the variables: `MONGO_URI` (from the database service),
   `ADMIN_PASS` (your own strong password), and `SERVER_ID` / `SERVER_NAME` /
   `SESSION_LIMIT` if you run more than one server.
4. Generate a domain for the service. That domain is the pairing page and the
   admin panel address — share it with your users.
5. Pair your own number first and send `.menu` and `.health` to confirm the
   deployment, then let users pair.

## Notes and honest limits

- YouTube downloads go through public resolver backends; when a backend is
  busy, `.video` / `.song` answer with a clear "try again" message instead of
  failing silently. Instagram downloads depend on the upstream API and can be
  refused by Instagram itself.
- `.4kstatus` video splitting is capped at 4 parts of 90 seconds (6 minutes).
- Downloads are capped (see `config.js`): inline video up to 64 MB, documents
  up to the configured document cap; bigger files get a clear explanation.
- `.tourl` uploads to public file hosts; if both hosts refuse, the command
  says so plainly.
- Reminders (`.remind`) are kept in memory and are lost on restart; notes
  (`.note`) are stored in the database and survive restarts.
- The bot follows the PRIME MD announcement channels automatically on each
  session, like the owner's other bots.

PRIME MD — by AR SAMOON.
