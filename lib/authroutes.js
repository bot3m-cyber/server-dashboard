'use strict';
// Routen für Anmeldung, Konto und Administration (Mehrbenutzer-Modus).
const auth = require('./auth');
const users = require('./users');
const hosted = require('./hosted');
const quota = require('./quota');
const config = require('./config');
const registry = require('./mc');
const { UserError } = require('./util');

const wrap = (fn) => async (req, res, next) => {
  try {
    const r = await fn(req, res);
    if (!res.headersSent && r !== undefined) res.json(r);
  } catch (e) {
    next(e);
  }
};

/** Routen, die ohne Anmeldung erreichbar sein müssen. */
function mountPublic(app) {
  app.get('/auth/config', wrap(async () => ({
    hosted: true, google: auth.googleConfigured(), registration: users.count() === 0 || hosted.get().registration === 'open',
    firstUser: users.count() === 0,
  })));

  app.post('/auth/register', wrap(async (req, res) => {
    const u = await auth.register(req, req.body || {});
    auth.startSession(res, u);
    return { ok: true, user: users.publicUser(u) };
  }));

  app.post('/auth/login', wrap(async (req, res) => {
    const u = await auth.login(req, req.body || {});
    auth.startSession(res, u);
    return { ok: true, user: users.publicUser(u) };
  }));

  app.post('/auth/logout', wrap(async (req, res) => {
    if (req.sid) users.destroySession(req.sid);
    auth.clearCookie(res, auth.COOKIE);
    return { ok: true };
  }));

  app.get('/auth/google', (req, res, next) => { try { auth.googleStart(req, res); } catch (e) { next(e); } });
  app.get('/auth/google/callback', async (req, res) => {
    try {
      await auth.googleCallback(req, res);
    } catch (e) {
      if (!e.userFacing) console.error(e);
      res.redirect(`/login?error=${encodeURIComponent(e.userFacing ? e.message : 'Anmeldung fehlgeschlagen.')}`);
    }
  });
}

const needAdmin = (req) => { if (req.user?.role !== 'admin') throw new UserError('Dafür brauchst du Administrator-Rechte.', 403); };

/** Routen nach der Anmeldung. */
function mountApi(app) {
  app.get('/api/me', wrap(async (req) => ({
    hosted: true, user: users.publicUser(req.user), usage: await quota.usage(req.user),
    publicHost: hosted.publicHost(), platform: process.platform,
  })));

  app.post('/api/me/password', wrap(async (req) => {
    const u = users.byId(req.user.id);
    const { current, next: pw } = req.body || {};
    if (u.passHash && !(await auth.verifyPassword(String(current || ''), u.passHash))) throw new UserError('Das aktuelle Passwort stimmt nicht.', 403);
    auth.checkPassword(pw, u.email);
    users.update(u.id, { passHash: await auth.hashPassword(pw) });
    return { ok: true };
  }));

  // ---- Administration
  app.get('/api/admin/users', wrap(async (req) => {
    needAdmin(req);
    const rows = [];
    for (const u of users.list()) {
      const mine = quota.owned(u.id);
      rows.push({
        ...users.publicUser(u), servers: mine.length, running: mine.filter((p) => registry.all().some((i) => i.id === p.id && i.isRunning())).length,
        ramAllocatedGb: mine.reduce((a, p) => a + (p.xmxGb || 0), 0), diskBytes: await quota.diskBytes(u.id),
      });
    }
    return { users: rows, settings: hosted.publicView(), budgetGb: quota.budgetGb(), runningTotalGb: quota.runningRamGb() };
  }));

  app.post('/api/admin/users/update', wrap(async (req) => {
    needAdmin(req);
    const { id, role, disabled, quota: q } = req.body || {};
    const u = users.byId(String(id || ''));
    if (!u) throw new UserError('Benutzer nicht gefunden.', 404);
    const patch = {};
    if (role !== undefined) {
      if (!['admin', 'user'].includes(role)) throw new UserError('Unbekannte Rolle.');
      if (role !== 'admin' && u.role === 'admin' && users.list().filter((x) => x.role === 'admin' && !x.disabled).length <= 1) throw new UserError('Es muss mindestens einen Administrator geben.');
      patch.role = role;
    }
    if (disabled !== undefined) {
      if (disabled && u.id === req.user.id) throw new UserError('Du kannst dein eigenes Konto nicht sperren.');
      if (disabled && u.role === 'admin' && users.list().filter((x) => x.role === 'admin' && !x.disabled).length <= 1) throw new UserError('Es muss mindestens einen Administrator geben.');
      patch.disabled = !!disabled;
    }
    if (q !== undefined) {
      if (q === null) patch.quota = null;
      else {
        const n = (v, min, max, what) => { const x = Number(v); if (!Number.isFinite(x) || x < min || x > max) throw new UserError(`${what}: bitte einen Wert zwischen ${min} und ${max} angeben.`); return x; };
        patch.quota = {
          maxServers: n(q.maxServers, 0, 50, 'Server'), maxRamGb: n(q.maxRamGb, 1, 256, 'RAM'), maxDiskGb: n(q.maxDiskGb, 1, 10000, 'Speicher'),
        };
      }
    }
    users.update(u.id, patch);
    if (patch.disabled) users.destroyAllFor(u.id);
    return { user: users.publicUser(users.byId(u.id)) };
  }));

  app.post('/api/admin/users/delete', wrap(async (req) => {
    needAdmin(req);
    const u = users.byId(String(req.body?.id || ''));
    if (!u) throw new UserError('Benutzer nicht gefunden.', 404);
    if (u.id === req.user.id) throw new UserError('Du kannst dich nicht selbst löschen.');
    if (u.role === 'admin' && users.list().filter((x) => x.role === 'admin' && !x.disabled).length <= 1) throw new UserError('Es muss mindestens einen Administrator geben.');
    const mine = quota.owned(u.id);
    if (mine.some((p) => registry.all().some((i) => i.id === p.id && i.isRunning()))) throw new UserError('Dieser Benutzer hat noch laufende Server. Bitte zuerst stoppen.', 409);
    const fs = require('fs');
    const path = require('path');
    const base = path.resolve(config.SERVERS_DIR) + path.sep;
    for (const p of config.removeOwnedBy(u.id)) {
      const dir = p.serverDir && path.resolve(p.serverDir);
      if (dir && (dir + path.sep).startsWith(base)) fs.rmSync(dir, { recursive: true, force: true });
    }
    users.remove(u.id);
    return { ok: true };
  }));

  app.post('/api/admin/settings', wrap(async (req) => {
    needAdmin(req);
    const b = req.body || {};
    const patch = {};
    if (b.registration !== undefined) {
      if (!['open', 'closed'].includes(b.registration)) throw new UserError('Ungültige Einstellung.');
      patch.registration = b.registration;
    }
    if (b.defaultQuota) {
      const n = (v, min, max, what) => { const x = Number(v); if (!Number.isFinite(x) || x < min || x > max) throw new UserError(`${what}: bitte einen Wert zwischen ${min} und ${max} angeben.`); return x; };
      patch.defaultQuota = { maxServers: n(b.defaultQuota.maxServers, 0, 50, 'Server'), maxRamGb: n(b.defaultQuota.maxRamGb, 1, 256, 'RAM'), maxDiskGb: n(b.defaultQuota.maxDiskGb, 1, 10000, 'Speicher') };
    }
    if (b.totalRamGb !== undefined) patch.totalRamGb = b.totalRamGb === null || b.totalRamGb === '' ? null : Math.min(1024, Math.max(1, Number(b.totalRamGb) || 1));
    if (b.reserveRamGb !== undefined) patch.reserveRamGb = Math.min(64, Math.max(0, Number(b.reserveRamGb) || 0));
    hosted.save(patch);
    return { settings: hosted.publicView() };
  }));
}

module.exports = { mountPublic, mountApi };
