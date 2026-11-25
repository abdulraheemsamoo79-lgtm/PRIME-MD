// Password-protected admin panel for PRIME MD.
// - Disabled unless ADMIN_PASS is set (environment variable). There is
//   NO default password: with ADMIN_PASS unset, /admin only explains how
//   to enable it.
// - POST /admin/login checks the password and sets an httpOnly cookie
//   holding a random in-memory token (12-hour expiry). Failed logins are
//   rate-limited: 5 failures per 10 minutes per IP, then HTTP 429.
// - The panel lists live sessions (number, status, mode) and can
//   disconnect/remove one (POST /admin/disconnect, login required).
const crypto = require('crypto');
const express = require('express');
const config = require('../config');

const COOKIE = 'prime_admin';
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;

const tokens = new Map();   // token -> expiresAt
const failures = new Map(); // ip -> [timestamps]

function adminPass() { return process.env.ADMIN_PASS || config.ADMIN_PASS || ''; }
function enabled() { return !!adminPass(); }

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}
function isAuthed(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return false;
  const exp = tokens.get(token);
  if (!exp || exp < Date.now()) { tokens.delete(token); return false; }
  return true;
}
function recentFailures(ip) {
  const now = Date.now();
  const list = (failures.get(ip) || []).filter(t => now - t < LOGIN_WINDOW_MS);
  failures.set(ip, list);
  return list;
}
function passwordMatches(given) {
  const want = Buffer.from(adminPass());
  const got = Buffer.from(String(given || ''));
  if (want.length !== got.length) return false;
  return crypto.timingSafeEqual(want, got);
}

const page = (title, body) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} - ${config.BOT_NAME} Admin</title>
<style>
 body{font-family:system-ui,Arial,sans-serif;background:#12001f;color:#f3eaff;margin:0;padding:22px}
 .card{max-width:640px;margin:0 auto;background:#1e0733;border:2px solid #8b2fc9;border-radius:18px;padding:22px;box-shadow:0 0 32px #8b2fc966}
 img{width:84px;height:84px;object-fit:cover;border-radius:14px;border:2px solid #b45cff}
 h1{color:#d9a5ff;margin:8px 0} h2{color:#d9a5ff}
 input{width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid #8b2fc9;background:#12001f;color:#fff;font-size:16px}
 button{margin-top:10px;padding:10px 16px;border:0;border-radius:10px;background:#8b2fc9;color:#fff;font-size:15px;font-weight:700;cursor:pointer}
 button.danger{background:#a02040}
 table{width:100%;border-collapse:collapse;margin-top:10px}
 td,th{padding:8px;border-bottom:1px solid #4a2166;text-align:left;font-size:15px}
 .err{color:#ff9d9d}.muted{color:#bfa8e0}
</style></head><body><div class="card">${body}</div></body></html>`;

function loginPage(error = '') {
  return page('Login', `
 <img src="/logo.png" alt="${config.BOT_NAME}">
 <h1>👑 ${config.BOT_NAME} - Admin</h1>
 ${error ? `<p class="err">${error}</p>` : ''}
 <form method="POST" action="/admin/login">
  <input type="password" name="password" placeholder="Admin password" autocomplete="current-password" required>
  <button type="submit">Log in</button>
 </form>`);
}

function registerAdmin(app, { sessions, settings }) {
  const router = express.Router();
  router.use(express.urlencoded({ extended: false }));

  router.get('/admin', async (req, res) => {
    if (!enabled()) {
      return res.type('html').send(page('Disabled', `
 <h1>👑 ${config.BOT_NAME} - Admin</h1>
 <p>Admin panel is disabled. Set ADMIN_PASS to enable it.</p>`));
    }
    if (!isAuthed(req)) return res.type('html').send(loginPage());
    try {
      const list = sessions.list();
      const rows = [];
      for (const s of list) {
        let mode = 'public';
        try { mode = await settings.getMode(s.number); } catch {}
        rows.push(`<tr><td>${s.number}</td><td>${s.status}</td><td>${String(mode).toUpperCase()}</td>
<td><form method="POST" action="/admin/disconnect" onsubmit="return confirm('Disconnect and remove session ${s.number}?')">
<input type="hidden" name="number" value="${s.number}"><button class="danger" type="submit">Disconnect</button></form></td></tr>`);
      }
      return res.type('html').send(page('Panel', `
 <img src="/logo.png" alt="${config.BOT_NAME}">
 <h1>👑 ${config.BOT_NAME} - Admin Panel</h1>
 <p class="muted">Server: ${config.SERVER_NAME} (ID ${config.SERVER_ID}) - Sessions: ${sessions.count()}/${config.SESSION_LIMIT}</p>
 ${list.length ? `<table><tr><th>Number</th><th>Status</th><th>Mode</th><th></th></tr>${rows.join('')}</table>` : '<p>No live sessions right now.</p>'}`));
    } catch (e) {
      console.error('[admin] panel error:', e.message);
      return res.status(500).type('html').send(page('Error', '<p class="err">Something went wrong while loading the panel.</p>'));
    }
  });

  router.post('/admin/login', (req, res) => {
    if (!enabled()) return res.status(404).send('Admin panel is disabled.');
    const ip = req.ip || 'unknown';
    if (recentFailures(ip).length >= LOGIN_MAX_FAILURES) {
      return res.status(429).type('html').send(loginPage('Too many failed login attempts. Please wait a few minutes and try again.'));
    }
    if (!passwordMatches(req.body?.password)) {
      recentFailures(ip).push(Date.now());
      return res.status(401).type('html').send(loginPage('Wrong password.'));
    }
    failures.delete(ip);
    const token = crypto.randomBytes(24).toString('hex');
    tokens.set(token, Date.now() + TOKEN_TTL_MS);
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; Path=/admin; Max-Age=${TOKEN_TTL_MS / 1000}; SameSite=Lax`);
    return res.redirect('/admin');
  });

  router.post('/admin/disconnect', async (req, res) => {
    if (!enabled() || !isAuthed(req)) return res.status(403).send('Not authorized.');
    const number = String(req.body?.number || '').replace(/\D/g, '');
    if (number) {
      try {
        if (typeof sessions.cleanupSession === 'function') await sessions.cleanupSession(number);
        else if (typeof sessions.stopSession === 'function') await sessions.stopSession(number);
      } catch (e) { console.error('[admin] disconnect error:', e.message); }
    }
    return res.redirect('/admin');
  });

  app.use(router);
  return router;
}

module.exports = { registerAdmin, _tokens: tokens, _failures: failures, _isAuthed: isAuthed };
