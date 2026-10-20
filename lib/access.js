'use strict';
// Optionales Zugangspasswort für den lokalen Modus. Gilt nur für Zugriffe von anderen Geräten:
// Vom eigenen PC (localhost) braucht man nie ein Passwort. Im Mehrbenutzer-Modus übernimmt die Anmeldung diese Aufgabe.
const crypto = require('crypto');
const auth = require('./auth');
const netconf = require('./netconf');
const { UserError } = require('./util');

const COOKIE = 'dash_access';
const MAX_AGE_SEC = 14 * 24 * 3600;
const sessions = new Map(); // sha256(token) -> { exp, h }  (h = Merkmal des Passworts, damit eine Passwort-Änderung alle Sitzungen beendet)
const fingerprint = () => String(netconf.get().accessPasswordHash || '').slice(-24);

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const enabled = () => !!netconf.get().accessPasswordHash;

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of sessions) if (v.exp < now) sessions.delete(k);
}, 600000).unref();

function isAuthed(req) {
  const token = auth.parseCookies(req)[COOKIE];
  if (!token) return false;
  const rec = sessions.get(sha(token));
  if (!rec || rec.exp < Date.now() || rec.h !== fingerprint()) return false;
  rec.exp = Date.now() + MAX_AGE_SEC * 1000; // gleitend verlängern
  return true;
}

function cookie(req, res, value, maxAge) {
  const attrs = [`${COOKIE}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (req.secure || String(req.headers['x-forwarded-proto'] || '').includes('https')) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

async function login(req, res, password) {
  const ip = auth.clientIp(req);
  auth.hit(`access:${ip}`, 8, 15 * 60e3, 'Zu viele falsche Versuche.');
  const stored = netconf.get().accessPasswordHash;
  const ok = stored && await auth.verifyPassword(String(password || '').slice(0, 200), stored);
  if (!ok) throw new UserError('Das Passwort stimmt nicht.', 401);
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(sha(token), { exp: Date.now() + MAX_AGE_SEC * 1000, h: fingerprint() });
  cookie(req, res, token, MAX_AGE_SEC);
}

function logout(req, res) {
  const token = auth.parseCookies(req)[COOKIE];
  if (token) sessions.delete(sha(token));
  cookie(req, res, '', 0);
}

/** Setzt oder entfernt das Passwort. Alle anderen Geräte müssen sich danach neu anmelden. */
async function setPassword(password) {
  if (!password) {
    netconf.save({ accessPasswordHash: null });
  } else {
    auth.checkPassword(password, '');
    netconf.save({ accessPasswordHash: await auth.hashPassword(password) });
  }
  sessions.clear();
}

const PUBLIC_PATHS = new Set(['/login', '/login.html', '/login.js', '/login.css', '/style.css', '/legal.css', '/i18n.js', '/impressum', '/datenschutz', '/auth/config', '/auth/password-login']);

/** Middleware: lässt den eigenen PC durch, verlangt von anderen Geräten das Passwort. */
function middleware(req, res, next) {
  if (!enabled() || netconf.isLoopback(req)) return next();
  if (PUBLIC_PATHS.has(req.path) || req.path.startsWith('/assets/') || isAuthed(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Bitte melde dich an.', code: 'LOGIN' });
  return res.redirect('/login');
}

function mountRoutes(app) {
  app.get('/auth/config', (req, res) => res.json({ hosted: false, passwordOnly: true, google: false, registration: false, firstUser: false }));
  app.post('/auth/password-login', async (req, res, next) => {
    try {
      await login(req, res, req.body?.password);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
  app.post('/auth/logout', (req, res) => { logout(req, res); res.json({ ok: true }); });
  app.get('/login', (req, res) => {
    if (!enabled() || netconf.isLoopback(req) || isAuthed(req)) return res.redirect('/');
    return res.sendFile(require('path').join(__dirname, '..', 'public', 'login.html'));
  });
}

module.exports = { enabled, isAuthed, middleware, mountRoutes, setPassword };
