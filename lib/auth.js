'use strict';
// Anmeldung (Mehrbenutzer-Modus): E-Mail + Passwort und Google. Sitzungen per Cookie.
const crypto = require('crypto');
const { promisify } = require('util');
const users = require('./users');
const hosted = require('./hosted');
const { UserError, netError } = require('./util');

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'sid';

const GOOGLE = {
  auth: process.env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth',
  token: process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token',
  userinfo: process.env.GOOGLE_USERINFO_URL || 'https://openidconnect.googleapis.com/v1/userinfo',
};

// ---------------------------------------------------------------- Hilfen

function clientIp(req) {
  if (hosted.get().trustProxy) {
    const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xf) return xf;
  }
  return req.socket.remoteAddress || '?';
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ungültig */ }
  }
  return out;
}

function setCookie(res, name, value, { maxAgeSec, path: p = '/' } = {}) {
  const attrs = [`${name}=${encodeURIComponent(value)}`, `Path=${p}`, 'HttpOnly', 'SameSite=Lax'];
  if (maxAgeSec != null) attrs.push(`Max-Age=${maxAgeSec}`);
  if (hosted.isHttps()) attrs.push('Secure');
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', [...(Array.isArray(prev) ? prev : prev ? [prev] : []), attrs.join('; ')]);
}

const clearCookie = (res, name, p = '/') => setCookie(res, name, '', { maxAgeSec: 0, path: p });

// ---------------------------------------------------------------- Schutz gegen Ausprobieren

const buckets = new Map();

/** Zählt einen Versuch. Wirft einen Fehler, wenn das Limit erreicht ist. */
function hit(key, max, windowMs, message) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < now) { b = { n: 0, reset: now + windowMs }; buckets.set(key, b); }
  b.n++;
  if (b.n > max) {
    const min = Math.max(1, Math.ceil((b.reset - now) / 60000));
    throw new UserError(`${message} Bitte versuche es in etwa ${min} Minute${min > 1 ? 'n' : ''} noch einmal.`, 429);
  }
}

const clearHits = (key) => buckets.delete(key);

setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
}, 600000).unref();

// ---------------------------------------------------------------- Passwörter

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$${salt.toString('base64')}$${hash.toString('base64')}`;
}

async function verifyPassword(pw, stored) {
  const [alg, n, saltB64, hashB64] = String(stored || '').split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hashB64 || '', 'base64');
  const got = await scrypt(pw, Buffer.from(saltB64 || '', 'base64'), expected.length || 64, { N: Number(n) || 16384, r: 8, p: 1 });
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

const COMMON = new Set(['password', 'passwort', '1234567890', '12345678910', 'qwertzuiop', 'qwertyuiop', 'password123', 'passwort123', 'minecraft', 'minecraft123', 'iloveyou123']);

function checkPassword(pw, email) {
  if (typeof pw !== 'string' || pw.length < 10) throw new UserError('Das Passwort muss mindestens 10 Zeichen lang sein.');
  if (pw.length > 200) throw new UserError('Das Passwort ist zu lang (höchstens 200 Zeichen).');
  if (COMMON.has(pw.toLowerCase()) || new Set(pw).size < 4 || pw.toLowerCase().includes(String(email || '').split('@')[0].toLowerCase()) && String(email).split('@')[0].length > 3) {
    throw new UserError('Dieses Passwort ist zu leicht zu erraten. Bitte nimm ein anderes.');
  }
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

function cleanEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(e) || e.length > 254) throw new UserError('Bitte eine gültige E-Mail-Adresse angeben.');
  return e;
}

// ---------------------------------------------------------------- Registrieren und Anmelden

function roleFor(email, viaGoogleVerified) {
  if (users.count() === 0) return 'admin'; // der erste Benutzer verwaltet die Seite
  if (viaGoogleVerified && hosted.get().adminEmails.includes(email)) return 'admin';
  return 'user';
}

function assertRegistrationOpen() {
  if (users.count() > 0 && hosted.get().registration !== 'open') throw new UserError('Neue Registrierungen sind gerade nicht möglich.', 403);
}

async function register(req, { email, name, password }) {
  const ip = clientIp(req);
  hit(`reg:${ip}`, 5, 3600e3, 'Zu viele Registrierungen von diesem Anschluss.');
  assertRegistrationOpen();
  const e = cleanEmail(email);
  checkPassword(password, e);
  if (users.byEmail(e)) throw new UserError('Mit dieser E-Mail-Adresse gibt es schon ein Konto. Bitte melde dich an.', 409);
  const u = users.create({ email: e, name: String(name || '').trim(), passHash: await hashPassword(password), provider: 'local', role: roleFor(e, false) });
  return u;
}

// Zeitkonstante Vergleichsarbeit, auch wenn es das Konto nicht gibt (verrät sonst, welche E-Mails existieren)
const DUMMY_HASH = `scrypt$16384$${crypto.randomBytes(16).toString('base64')}$${crypto.randomBytes(64).toString('base64')}`;

async function login(req, { email, password }) {
  const ip = clientIp(req);
  const e = String(email || '').trim().toLowerCase();
  hit(`login-ip:${ip}`, 30, 15 * 60e3, 'Zu viele Anmeldeversuche von diesem Anschluss.');
  hit(`login:${e}`, 6, 15 * 60e3, 'Zu viele falsche Versuche für dieses Konto.');
  const u = users.byEmail(e);
  const ok = await verifyPassword(String(password || '').slice(0, 200), u?.passHash || DUMMY_HASH);
  if (!u || !u.passHash || !ok) throw new UserError('E-Mail oder Passwort stimmt nicht.', 401);
  if (u.disabled) throw new UserError('Dieses Konto ist gesperrt.', 403);
  clearHits(`login:${e}`);
  users.update(u.id, { lastLoginAt: Date.now() });
  return u;
}

function startSession(res, user) {
  const token = users.createSession(user.id);
  setCookie(res, COOKIE, token, { maxAgeSec: 14 * 24 * 3600 });
  return token;
}

// ---------------------------------------------------------------- Google

const googleConfigured = () => !!(hosted.get().google.clientId && hosted.get().google.clientSecret);
const redirectUri = () => `${hosted.get().publicUrl.replace(/\/$/, '')}/auth/google/callback`;
const b64url = (buf) => Buffer.from(buf).toString('base64url');

function googleStart(req, res) {
  if (!googleConfigured()) throw new UserError('Die Anmeldung mit Google ist auf dieser Seite nicht eingerichtet.', 404);
  hit(`g-start:${clientIp(req)}`, 30, 15 * 60e3, 'Zu viele Anmeldeversuche.');
  const state = crypto.randomBytes(24).toString('base64url');
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  setCookie(res, 'oauth_state', state, { maxAgeSec: 600, path: '/auth' });
  setCookie(res, 'oauth_pkce', verifier, { maxAgeSec: 600, path: '/auth' });
  const q = new URLSearchParams({
    client_id: hosted.get().google.clientId, redirect_uri: redirectUri(), response_type: 'code', scope: 'openid email profile',
    state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account',
  });
  res.redirect(`${GOOGLE.auth}?${q}`);
}

async function postForm(url, params) {
  let r;
  try {
    r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params), signal: AbortSignal.timeout(15000) });
  } catch (e) {
    throw netError(e, 'Google');
  }
  if (!r.ok) throw new UserError('Die Anmeldung bei Google hat nicht geklappt. Bitte versuche es noch einmal.', 401);
  return r.json();
}

async function googleCallback(req, res) {
  hit(`g-cb:${clientIp(req)}`, 30, 15 * 60e3, 'Zu viele Anmeldeversuche.');
  const cookies = parseCookies(req);
  clearCookie(res, 'oauth_state', '/auth');
  clearCookie(res, 'oauth_pkce', '/auth');
  const { code, state, error } = req.query;
  if (error) throw new UserError('Die Anmeldung bei Google wurde abgebrochen.', 400);
  if (!state || !cookies.oauth_state || String(state) !== cookies.oauth_state || !cookies.oauth_pkce || !code) {
    throw new UserError('Die Anmeldung ist abgelaufen oder ungültig. Bitte starte sie noch einmal.', 400);
  }
  const tok = await postForm(GOOGLE.token, {
    code: String(code), client_id: hosted.get().google.clientId, client_secret: hosted.get().google.clientSecret,
    redirect_uri: redirectUri(), grant_type: 'authorization_code', code_verifier: cookies.oauth_pkce,
  });
  if (!tok.access_token) throw new UserError('Google hat keinen Zugang geliefert.', 401);
  let info;
  try {
    const r = await fetch(GOOGLE.userinfo, { headers: { Authorization: `Bearer ${tok.access_token}` }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    info = await r.json();
  } catch (e) {
    throw new UserError(`Die Daten von Google konnten nicht gelesen werden (${e.message}).`, 502);
  }
  const email = String(info.email || '').toLowerCase();
  if (!EMAIL_RE.test(email) || info.email_verified !== true) throw new UserError('Deine Google-E-Mail-Adresse ist nicht bestätigt.', 403);

  let u = users.byEmail(email);
  if (u) {
    if (u.disabled) throw new UserError('Dieses Konto ist gesperrt.', 403);
    if (!u.emailVerified) {
      // Ein Konto mit dieser Adresse wurde per Passwort angelegt, ohne dass die Adresse bestätigt war.
      // Das Passwort wird entwertet, damit niemand ein Konto "vorbereiten" und später übernehmen kann.
      users.update(u.id, { passHash: null, emailVerified: true, provider: 'google' });
      users.destroyAllFor(u.id);
    }
    users.update(u.id, { lastLoginAt: Date.now(), name: u.name || info.name });
    u = users.byId(u.id);
  } else {
    assertRegistrationOpen();
    u = users.create({ email, name: info.name || email.split('@')[0], provider: 'google', emailVerified: true, role: roleFor(email, true) });
    users.update(u.id, { lastLoginAt: Date.now() });
  }
  startSession(res, u);
  res.redirect('/');
}

// ---------------------------------------------------------------- Middleware

/** Liest die Sitzung aus dem Cookie und setzt req.user / req.sid. */
function sessionMiddleware(req, res, next) {
  const token = parseCookies(req)[COOKIE];
  const found = token ? users.lookupSession(token) : null;
  if (found) {
    req.user = found.user;
    req.sid = token;
    req.sessionRec = found.session;
  }
  next();
}

module.exports = {
  COOKIE, clientIp, parseCookies, setCookie, clearCookie, hit, register, login, startSession, googleStart, googleCallback, googleConfigured,
  sessionMiddleware, hashPassword, verifyPassword, cleanEmail, checkPassword,
};
