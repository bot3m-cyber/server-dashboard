'use strict';
// Einstellungen des Dashboards selbst (nicht eines Minecraft-Servers): Adresse und Port, Zugangspasswort,
// HTTPS mit Let’s Encrypt, Betriebsart (lokal / Mehrbenutzer). Alles wird in data/ gespeichert.
const path = require('path');
const { spawn } = require('child_process');
const netconf = require('./netconf');
const hosted = require('./hosted');
const access = require('./access');
const certs = require('./certs');
const listeners = require('./listeners');
const mcRegistry = require('./mc');
const runstate = require('./runstate');
const legal = require('./legal');
const updater = require('./updater');
const jobs = require('./jobs');
const config = require('./config');
const { DATA_DIR } = require('./paths');
const { UserError } = require('./util');

const wrap = (fn) => async (req, res, next) => {
  try {
    const r = await fn(req, res);
    if (!res.headersSent) res.json(r === undefined ? { ok: true } : r);
  } catch (e) { next(e); }
};

/** Wer darf die Einstellungen ändern? Mehrbenutzer: Administratoren. Lokal: dieser PC oder ein angemeldetes Gerät. */
function guard(req, HOSTED) {
  if (HOSTED) {
    if (req.user?.role !== 'admin') throw new UserError('Dafür brauchst du Administrator-Rechte.', 403);
    return;
  }
  if (netconf.isLoopback(req) || (access.enabled() && access.isAuthed(req))) return;
  throw new UserError('Diese Einstellungen kannst du nur direkt am Rechner des Dashboards ändern, oder nachdem ein Zugangspasswort gesetzt ist und du dich damit angemeldet hast. Auf einem Server ohne Oberfläche setzt du das Passwort mit „node set-password.js“ (oder öffnest das Dashboard per SSH-Tunnel).', 403);
}

function warnings(HOSTED, req) {
  const n = netconf.get();
  const out = [];
  const exposed = n.bind !== 'local' && !certs.usable();
  if (!HOSTED && n.bind !== 'local' && !access.enabled()) {
    out.push({ level: 'warn', text: 'Das Dashboard ist im Netzwerk erreichbar, aber ohne Zugangspasswort. Jeder in deinem Netzwerk kann deine Server steuern. Setze ein Zugangspasswort oder stelle die Adresse auf „Nur dieser PC“.' });
  }
  if (exposed && !HOSTED && access.enabled()) out.push({ level: 'info', text: 'Der Zugriff von anderen Geräten läuft unverschlüsselt (HTTP). Das Passwort ließe sich im Netzwerk mitlesen. Mit HTTPS (siehe unten) ist es geschützt.' });
  if (HOSTED && !hosted.isHttps() && !netconf.isLoopback(req)) out.push({ level: 'warn', text: 'Die Seite wird ohne HTTPS ausgeliefert. Anmeldedaten laufen unverschlüsselt. Richte HTTPS ein oder nutze einen Reverse-Proxy mit Zertifikat.' });
  return out;
}

function overview(HOSTED, req) {
  const n = netconf.get();
  return {
    hosted: HOSTED,
    modeLockedByEnv: hosted.get().envLocked?.includes('enabled') || false,
    isLoopbackRequest: netconf.isLoopback(req),
    net: {
      bind: n.bind, customBind: n.customBind, port: n.port, envLocked: n.envLocked, publicDomain: n.publicDomain || '', ownAddresses: netconf.ownAddresses(),
      passwordSet: access.enabled(), urls: listeners.urls(),
    },
    https: { ...n.https, status: certs.status(), listeners: listeners.state() },
    hostedSettings: hosted.publicView(),
    warnings: warnings(HOSTED, req),
    dataDir: DATA_DIR,
    platform: process.platform,
    legal: legal.get(),
    runningServers: mcRegistry.runningCount(),
    autostart: { enabled: runstate.get().autoStart, servers: runstate.get().running.map((id) => config.list().find((p) => p.id === id)).filter(Boolean).map((p) => ({ id: p.id, name: p.name })) },
    service: { systemd: !!process.env.INVOCATION_ID, pm2: !!process.env.PM2_HOME, uptimeSec: Math.round(process.uptime()) },
  };
}

/** Startet das Dashboard neu (laufende Minecraft-Server müssen vorher aus sein). */
function scheduleRestart() {
  if (mcRegistry.runningCount()) throw new UserError('Bitte zuerst alle Minecraft-Server stoppen. Beim Neustart des Dashboards würden sie sonst beendet.', 409);
  setTimeout(async () => {
    try { await listeners.stopAll(); } catch { /* egal */ }
    if (process.env.INVOCATION_ID) process.exit(1); // unter systemd startet "Restart=on-failure" das Dashboard neu
    const args = process.argv.slice(1).filter((a) => a !== '--open');
    const child = spawn(process.execPath, args, { cwd: process.cwd(), detached: true, stdio: 'ignore', env: process.env, windowsHide: false });
    child.unref();
    process.exit(0);
  }, 700);
}

function mount(app, HOSTED, hooks = {}) {
  const g = (fn) => wrap(async (req, res) => { guard(req, HOSTED); return fn(req, res); });

  app.get('/api/system', g(async (req) => overview(HOSTED, req)));

  // Adresse und Port. Wird sofort angewendet; scheitert das, bleibt die alte Einstellung.
  app.post('/api/system/network', g(async (req) => {
    const before = { ...netconf.get() };
    const b = req.body || {};
    const patch = {};
    for (const k of ['bind', 'customBind', 'port', 'publicDomain']) if (k in b) patch[k] = b[k];
    if (before.envLocked.length && ['bind', 'port'].some((k) => k in patch && before.envLocked.includes(k))) {
      throw new UserError('Adresse oder Port sind über eine Umgebungsvariable (BIND/PORT) festgelegt und lassen sich hier nicht ändern.');
    }
    netconf.save(patch);
    try {
      await listeners.reload();
    } catch (e) {
      netconf.save({ bind: before.bind, customBind: before.customBind, port: before.port, publicDomain: before.publicDomain || '' });
      await listeners.reload().catch(() => {});
      throw new UserError(e.code === 'EADDRINUSE' ? `Port ${patch.port || before.port} ist schon belegt. Die alte Einstellung bleibt.` : `Das hat nicht geklappt (${e.message}). Die alte Einstellung bleibt.`, 409);
    }
    return overview(HOSTED, req);
  }));

  app.post('/api/system/password', g(async (req) => {
    if (HOSTED) throw new UserError('Im Mehrbenutzer-Modus melden sich Benutzer mit ihrem Konto an.');
    await access.setPassword(req.body?.password ? String(req.body.password) : null);
    return { passwordSet: access.enabled() };
  }));

  // HTTPS-Einstellungen speichern (das Zertifikat wird mit /https/issue geholt)
  app.post('/api/system/https', g(async (req) => {
    const b = req.body || {};
    const patch = {};
    for (const k of ['domain', 'email', 'staging', 'enabled', 'redirect', 'httpPort', 'httpsPort']) if (k in b) patch[k] = b[k];
    netconf.save({ https: patch });
    await listeners.reload().catch((e) => { throw new UserError(`Die Zugänge konnten nicht neu gestartet werden: ${e.message}`, 500); });
    return overview(HOSTED, req);
  }));

  app.post('/api/system/https/issue', g(async () => {
    const s = netconf.get().https;
    if (certs.status().working) throw new UserError('Es läuft schon eine Zertifikats-Anfrage.', 409);
    // Vorab die einfachen Fehler abfangen, den Rest erledigt der Hintergrund-Auftrag (Ergebnis siehe /api/system)
    if (!s.domain) throw new UserError('Bitte zuerst die Domain eintragen und speichern.');
    if (!s.email) throw new UserError('Bitte eine E-Mail-Adresse eintragen und speichern.');
    certs.issue({ log: (m) => console.log(`[HTTPS] ${m}`) }).catch((e) => console.error(`[HTTPS] ${e.message}`));
    return { started: true };
  }));

  app.post('/api/system/https/remove', g(async (req) => {
    netconf.save({ https: { enabled: false } });
    certs.remove();
    await listeners.reload();
    return overview(HOSTED, req);
  }));

  // Mehrbenutzer: Adresse, Proxy, Google-Anmeldung
  app.post('/api/system/hosted', g(async (req) => {
    const b = req.body || {};
    const cur = hosted.get();
    const patch = {};
    const url = (v) => {
      const s = String(v || '').trim();
      if (!s) return null;
      try {
        const u = new URL(s);
        if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
        return u.origin;
      } catch { throw new UserError('Die öffentliche Adresse muss mit http:// oder https:// beginnen, z. B. https://dashboard.meine-domain.de'); }
    };
    if ('publicUrl' in b) { const u = url(b.publicUrl); if (u) patch.publicUrl = u; }
    if ('publicHost' in b) patch.publicHost = String(b.publicHost || '').trim().toLowerCase().slice(0, 253) || null;
    if ('trustProxy' in b) patch.trustProxy = !!b.trustProxy;
    if ('google' in b && b.google) {
      const clientId = String(b.google.clientId ?? cur.google.clientId ?? '').trim();
      const secretIn = String(b.google.clientSecret || '').trim();
      patch.google = { clientId: clientId || null, clientSecret: secretIn || cur.google.clientSecret || null };
      if (b.google.clear) patch.google = { clientId: null, clientSecret: null };
    }
    hosted.save(patch);
    return { ok: true, restartNeeded: true, hostedSettings: hosted.publicView() };
  }));

  // Betriebsart umschalten (gilt nach einem Neustart)
  app.post('/api/system/mode', g(async (req) => {
    if (hosted.get().envLocked?.includes('enabled')) throw new UserError('Die Betriebsart ist über die Umgebungsvariable HOSTED festgelegt und lässt sich hier nicht ändern.');
    const want = !!req.body?.hosted;
    if (mcRegistry.runningCount()) throw new UserError('Bitte zuerst alle Minecraft-Server stoppen.', 409);
    hosted.save({ enabled: want });
    return { ok: true, restartNeeded: true, hosted: want };
  }));

  // ---- Updates des Dashboards
  app.get('/api/update', g(async () => updater.status()));
  app.post('/api/update/check', g(async () => { await updater.check(); return updater.status(); }));
  app.post('/api/update/settings', g(async (req) => { updater.setAutoCheck(!!req.body?.autoCheck); return updater.status(); }));
  app.post('/api/update/install', g(async () => {
    if (mcRegistry.runningCount()) throw new UserError('Bitte zuerst alle Minecraft-Server stoppen. Nach dem Update startet das Dashboard neu und würde sie beenden.', 409);
    return {
      job: jobs.run('update', 'Dashboard aktualisieren', async (jctx) => {
        const r = await updater.install(jctx);
        setTimeout(() => { try { scheduleRestart(); } catch (e) { console.error('Neustart nach dem Update:', e.message); } }, 1500);
        return r;
      }),
    };
  }));

  app.get('/api/legal/:page', wrap(async (req) => {
    const c = legal.content(req.params.page, String(req.query.lang || 'de'));
    if (!c) throw new UserError('Diese Seite gibt es nicht.', 404);
    return c;
  }));

  app.post('/api/system/legal', g(async (req) => ({ legal: legal.save(req.body?.operator) })));

  app.post('/api/system/autostart', g(async (req) => {
    runstate.setAutoStart(!!req.body?.enabled);
    return { enabled: runstate.get().autoStart };
  }));

  app.post('/api/system/restart', g(async () => {
    scheduleRestart();
    return { ok: true, restarting: true };
  }));

}

module.exports = { mount, scheduleRestart, guard };
