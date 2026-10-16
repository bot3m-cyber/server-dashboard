'use strict';
// Benutzer und Sitzungen (Mehrbenutzer-Modus). Gespeichert in data/users.json und data/sessions.json.
// Sitzungs-Token werden nur als Hash gespeichert, Passwörter nur als scrypt-Hash.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./paths');
const hosted = require('./hosted');
const { readJson, writeJsonAtomic } = require('./util');

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const SESSION_TTL = 14 * 24 * 3600e3;

let users = null;
let sessions = null;
let saveTimer = null;

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  users = readJson(USERS_FILE, { users: [] });
  if (!Array.isArray(users.users)) users.users = [];
  sessions = readJson(SESSIONS_FILE, {});
  const now = Date.now();
  for (const [k, v] of Object.entries(sessions)) if (!v || v.exp < now) delete sessions[k];
}

const ensure = () => { if (!users) load(); };

function saveUsers() {
  writeJsonAtomic(USERS_FILE, users);
  try { fs.chmodSync(USERS_FILE, 0o600); } catch { /* Windows */ }
}

function saveSessionsSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeJsonAtomic(SESSIONS_FILE, sessions);
    try { fs.chmodSync(SESSIONS_FILE, 0o600); } catch { /* Windows */ }
  }, 500);
  saveTimer.unref();
}

const newId = () => crypto.randomBytes(6).toString('hex');

/** Grenzen eines Benutzers: eigene Werte, sonst die Standardwerte des Betreibers. */
function effectiveQuota(u) {
  return { ...hosted.get().defaultQuota, ...(u.quota || {}) };
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, email: u.email, name: u.name, role: u.role, provider: u.provider, disabled: !!u.disabled,
    createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || null, hasPassword: !!u.passHash, quota: effectiveQuota(u), customQuota: !!u.quota,
  };
}

const list = () => { ensure(); return users.users; };
const count = () => list().length;
const byId = (id) => list().find((u) => u.id === id) || null;
const byEmail = (email) => list().find((u) => u.email === String(email).toLowerCase()) || null;

function create(fields) {
  ensure();
  const u = {
    id: newId(), email: String(fields.email).toLowerCase(), name: String(fields.name || '').slice(0, 60) || String(fields.email).split('@')[0],
    role: fields.role || 'user', provider: fields.provider || 'local', passHash: fields.passHash || null, emailVerified: !!fields.emailVerified,
    disabled: false, createdAt: Date.now(), lastLoginAt: null, quota: null,
  };
  users.users.push(u);
  saveUsers();
  return u;
}

function update(id, patch) {
  const u = byId(id);
  if (!u) return null;
  Object.assign(u, patch);
  saveUsers();
  return u;
}

function remove(id) {
  ensure();
  users.users = users.users.filter((u) => u.id !== id);
  saveUsers();
  destroyAllFor(id);
}

// ---------------------------------------------------------------- Sitzungen

function createSession(userId) {
  ensure();
  const token = crypto.randomBytes(32).toString('base64url');
  sessions[sha(token)] = { userId, created: Date.now(), exp: Date.now() + SESSION_TTL, serverId: null };
  saveSessionsSoon();
  return token;
}

/** { session, user } oder null. Verlängert die Sitzung bei Nutzung. */
function lookupSession(token) {
  ensure();
  if (!token || typeof token !== 'string' || token.length > 100) return null;
  const rec = sessions[sha(token)];
  if (!rec) return null;
  if (rec.exp < Date.now()) { delete sessions[sha(token)]; saveSessionsSoon(); return null; }
  const user = byId(rec.userId);
  if (!user || user.disabled) return null;
  if (rec.exp - Date.now() < SESSION_TTL - 3600e3) { rec.exp = Date.now() + SESSION_TTL; saveSessionsSoon(); }
  return { session: rec, user };
}

function setSessionServer(token, serverId) {
  const rec = sessions[sha(token)];
  if (rec) { rec.serverId = serverId; saveSessionsSoon(); }
}

function destroySession(token) {
  ensure();
  delete sessions[sha(token)];
  saveSessionsSoon();
}

function destroyAllFor(userId) {
  ensure();
  for (const [k, v] of Object.entries(sessions)) if (v.userId === userId) delete sessions[k];
  saveSessionsSoon();
}

module.exports = {
  load, list, count, byId, byEmail, create, update, remove, publicUser, effectiveQuota,
  createSession, lookupSession, setSessionServer, destroySession, destroyAllFor,
};
