'use strict';
// Minecraft Server-Dashboard
//  - Lokal (Standard): http://localhost:3000, nur 127.0.0.1, ohne Anmeldung.
//  - Mehrbenutzer-Modus (HOSTED=1): Anmeldung, jeder Nutzer nur mit seinen Servern, mehrere Server gleichzeitig.
const express = require('express');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { pipeline } = require('stream/promises');
const { exec } = require('child_process');

const config = require('./lib/config');
const ctx = require('./lib/context');
const hosted = require('./lib/hosted');
const auth = require('./lib/auth');
const authRoutes = require('./lib/authroutes');
const users = require('./lib/users');
const quota = require('./lib/quota');
const events = require('./lib/events');
const jobs = require('./lib/jobs');
const setup = require('./lib/setup');
const java = require('./lib/java');
const mods = require('./lib/mods');
const mcRegistry = require('./lib/mc');
const properties = require('./lib/properties');
const players = require('./lib/players');
const crash = require('./lib/crash');
const backup = require('./lib/backup');
const network = require('./lib/network');
const modinstall = require('./lib/modinstall');
const modrinth = require('./lib/modrinth');
const bedrock = require('./lib/bedrock');
const modmeta = require('./lib/modmeta');
const heads = require('./lib/heads');
const overview = require('./lib/overview');
const servers = require('./lib/servers');
const serverTypes = require('./lib/servertypes');
const cloud = require('./lib/cloud');
const files = require('./lib/files');
const notify = require('./lib/notify');
const scheduler = require('./lib/scheduler');
const modupdate = require('./lib/modupdate');
const modpacks = require('./lib/modpacks');
const world = require('./lib/world');
const presets = require('./lib/presets');
const curseforge = require('./lib/curseforge');
const properties2 = require('./lib/properties');
const { UserError, sleep } = require('./lib/util');

const netconf = require('./lib/netconf');
const access = require('./lib/access');
const certs = require('./lib/certs');
const listeners = require('./lib/listeners');
const systemRoutes = require('./lib/system');
const runstate = require('./lib/runstate');

const HOSTED = hosted.enabled();
const PORT = netconf.get().port; // Standard 3000, einstellbar im Reiter „Netzwerk & Betrieb“ (oder per Umgebungsvariable PORT)
const STARTED_AT = Date.now();

// Erlaubte Adressen (Schutz gegen DNS-Rebinding): dieser PC, die IP-Adressen und der Name dieses Rechners,
// die eingestellte Domain und im Mehrbenutzer-Modus die öffentliche Adresse. Wird bei jeder Anfrage frisch geprüft.
function extraHosts() {
  const out = [];
  if (HOSTED) {
    try { out.push(new URL(hosted.get().publicUrl).hostname); } catch { /* ungültige Adresse */ }
    const ph = hosted.publicHost();
    if (ph) out.push(ph);
  }
  return out;
}
const hostAllowed = (hostHeader) => netconf.allowedHostnames(extraHosts()).has(netconf.hostnameOf(hostHeader));
function originAllowed(origin) {
  try {
    const u = new URL(origin);
    return ['http:', 'https:'].includes(u.protocol) && hostAllowed(u.host);
  } catch { return false; }
}

config.load();

// "mc" ist immer der Server der aktuellen Anfrage (Mehrbenutzer) bzw. der aktive Server (lokal)
const mc = new Proxy({}, {
  get(_t, prop) {
    const inst = mcRegistry.current();
    const v = inst[prop];
    return typeof v === 'function' ? v.bind(inst) : v;
  },
  set(_t, prop, val) {
    mcRegistry.current()[prop] = val;
    return true;
  },
});

const app = express();
app.disable('x-powered-by');

// Schutz gegen DNS-Rebinding: nur Aufrufe an die erlaubten Adressen annehmen
// Von anderen Geräten ist jede Adresse (IP oder Domain) erlaubt, sobald ein Zugangspasswort gesetzt ist.
// Dann schützt die Anmeldung. Ohne Passwort gelten nur die bekannten Adressen.
const passwordProtected = (req) => !HOSTED && access.enabled() && !netconf.isLoopback(req);

function blockedPage(res, why) {
  res.status(403).type('html').send(`<!doctype html><meta charset="utf-8"><title>Zugriff verweigert</title>
<body style="font:16px/1.5 system-ui,sans-serif;max-width:560px;margin:12vh auto;padding:0 20px;color:#222">
<h1>Zugriff verweigert</h1><p>${why}</p></body>`);
}
app.use((req, res, next) => {
  if (!hostAllowed(req.headers.host) && !passwordProtected(req)) {
    return blockedPage(res, 'Das Dashboard antwortet nicht auf diese Adresse. Der Besitzer kann sie im Dashboard unter „Netzwerk &amp; Betrieb“ als Domain eintragen oder ein Zugangspasswort setzen (<code>node set-password.js</code> auf dem Server).');
  }
  // Aus dem Internet nur mit Zugangspasswort (Mehrbenutzer-Modus: mit Anmeldung)
  if (!HOSTED && netconf.isPublicSource(req) && !access.enabled()) {
    return blockedPage(res, 'Aus dem Internet ist das Dashboard nur mit Zugangspasswort erreichbar. Der Besitzer kann es im Dashboard unter „Netzwerk &amp; Betrieb“ setzen, oder auf dem Server mit <code>node set-password.js</code>.');
  }
  next();
});
// Schutz gegen fremde Webseiten, die im Hintergrund Befehle schicken wollen
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.origin;
    let sameSite = false;
    try { sameSite = !!origin && new URL(origin).host.toLowerCase() === String(req.headers.host || '').toLowerCase(); } catch { /* ungültiger Origin */ }
    if (origin && !originAllowed(origin) && !(passwordProtected(req) && sameSite)) return res.status(403).json({ error: 'Anfrage von einer fremden Webseite blockiert.' });
    if (!origin && req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') {
      return res.status(403).json({ error: 'Anfrage von einer fremden Webseite blockiert.' });
    }
  }
  next();
});
// Sicherheits-Header: im Mehrbenutzer-Modus und sobald das Dashboard im Netzwerk erreichbar ist
app.use((req, res, next) => (HOSTED || req.secure || netconf.get().bind !== 'local' ? hardenHeaders(req, res, next) : next()));
function hardenHeaders(req, res, next) {
  {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https://cdn.modrinth.com https://media.forgecdn.net; "
      + "style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://api.modrinth.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if (req.secure || hosted.isHttps()) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  }
}
app.use(express.json({ limit: '2mb' }));

// Für die Wartezeit nach einem Neustart: die Seite fragt (ohne Anmeldung), ob das Dashboard wieder da ist
app.get('/api/system/ping', (req, res) => res.json({ ok: true, hosted: HOSTED, startedAt: STARTED_AT }));

const PUBLIC_DIR = path.join(__dirname, 'public');
const PUBLIC_PAGES = new Set(['/login.html', '/login.js', '/login.css', '/style.css']);

if (HOSTED) {
  // Ohne Anmeldung ist nur die Anmeldeseite erreichbar
  app.use(auth.sessionMiddleware);
  authRoutes.mountPublic(app);
  app.get('/login', (req, res) => (req.user ? res.redirect('/') : res.sendFile(path.join(PUBLIC_DIR, 'login.html'))));
  app.use((req, res, next) => {
    if (PUBLIC_PAGES.has(req.path) || req.path.startsWith('/assets/')) return express.static(PUBLIC_DIR)(req, res, next);
    if (req.user) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Bitte melde dich an.', code: 'LOGIN' });
    return res.redirect('/login');
  });
  // Ab hier: Anfrage gehört zu einem Benutzer und zu dessen gerade gewähltem Server
  app.use(async (req, res, next) => {
    try {
      const mine = config.listFor(req.user);
      let id = req.sessionRec?.serverId;
      let p = id && mine.find((s) => s.id === id);
      if (!p) p = mine.find((s) => s.ownerId === req.user.id);
      if (!p) {
        // Neue Nutzer bekommen einen leeren Server, den sie einrichten können
        try {
          p = await ctx.run({ id: null, user: req.user }, () => servers.create({ name: 'Mein Server', type: 'modpack' }));
        } catch (e) { console.error('Standard-Server konnte nicht angelegt werden:', e.message); p = null; }
      }
      if (p && p.id !== id) users.setSessionServer(req.sid, p.id);
      ctx.run({ id: p ? p.id : null, user: req.user }, next);
    } catch (e) {
      next(e);
    }
  });
}
// Lokaler Modus: Zugriffe von anderen Geräten brauchen das Zugangspasswort (falls eines gesetzt ist). Der eigene PC nie.
if (!HOSTED) {
  access.mountRoutes(app);
  app.use(access.middleware);
}
app.use('/icons', express.static(modmeta.ICON_DIR, { maxAge: '7d', fallthrough: true }));
app.use(express.static(PUBLIC_DIR, { index: 'index.html' }));
if (HOSTED) authRoutes.mountApi(app);
systemRoutes.mount(app, HOSTED, { startedAt: STARTED_AT });

/** Diese Routen darf im Mehrbenutzer-Modus nur ein Administrator benutzen (sie greifen auf beliebige Pfade zu oder gelten für alle). */
const ADMIN_ONLY = [/^\/api\/setup\/(serverdir|path)$/, /^\/api\/servers\/(detect|adopt)$/, /^\/api\/curseforge\/key$/];
const HOSTED_DISABLED = [/^\/api\/cloud(\/|$)/];
if (HOSTED) {
  app.use((req, res, next) => {
    if (HOSTED_DISABLED.some((re) => re.test(req.path))) return res.status(404).json({ error: 'Das gibt es in dieser Version nicht.' });
    if (req.method === 'POST' && req.path === '/api/java') return req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Dafür brauchst du Administrator-Rechte.' });
    if (ADMIN_ONLY.some((re) => re.test(req.path)) && req.user.role !== 'admin') return res.status(403).json({ error: 'Dafür brauchst du Administrator-Rechte.' });
    next();
  });
}

const api = (fn) => async (req, res, next) => {
  try {
    const r = await fn(req, res);
    if (!res.headersSent) res.json(r === undefined ? { ok: true } : r);
  } catch (e) {
    next(e);
  }
};

function requireStopped(what = 'Das') {
  if (mc.isRunning()) throw new UserError(`${what} geht nur, wenn der Server aus ist. Bitte zuerst den Server stoppen.`, 409);
}

// ---------------------------------------------------------------- Server wählen (lokal: aktiver Server, hosted: pro Sitzung)

/** Macht diesen Server zum gewählten Server des Benutzers. */
function selectServer(req, id) {
  if (HOSTED) users.setSessionServer(req.sid, id);
  else config.setActive(id);
}

/** Führt fn im Kontext dieses Servers aus (nötig, wenn gerade ein anderer Server gewählt war). */
function inServer(req, id, fn) {
  return HOSTED ? ctx.run({ id, user: req.user }, fn) : fn();
}

function switchedTo(req) {
  if (HOSTED) { events.broadcast('switched', { id: ctx.id() }, { userId: req.user.id }); return; }
  mc.reset();
  events.broadcast('switched', { id: config.activeId() });
}

// ---------------------------------------------------------------- Live-Ereignisse (SSE)

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  const pid = ctx.id() || (HOSTED ? null : config.activeId());
  const uid = req.user?.id || null;
  if (pid) {
    events.send(res, 'status', mc.info());
    events.send(res, 'history', mc.lines);
    events.send(res, 'job', jobs.snapshot());
  }
  events.addClient(res, (t) => (t.userId ? HOSTED && t.userId === uid : t.pid ? t.pid === pid : !HOSTED));
});

/** Verteilt die Ereignisse jedes Servers (auch künftiger) an die richtigen Browser. */
mcRegistry.onCreate((inst) => {
  const tgt = { pid: inst.id };
  const inCtx = (fn) => ctx.run({ id: inst.id, user: null }, fn);
  inst.on('lines', (lines) => events.broadcast('lines', lines, tgt));
  inst.on('status', (s) => events.broadcast('status', s, tgt));
  // Merken, was läuft: Wer bewusst gestoppt wird, bleibt nach einem Neustart aus. Beim Herunterfahren des Dashboards bleibt der Eintrag erhalten.
  inst.on('status', (s) => {
    if (s.state === 'startet' || s.state === 'läuft') runstate.markRunning(inst.id, { exclusive: !HOSTED });
    else if (s.state === 'aus' && !shuttingDown) runstate.markStopped(inst.id);
  });
  inst.on('players', (p) => events.broadcast('players', p, tgt));
  inst.on('activity', (a) => {
    events.broadcast('activity', a, tgt);
    if (a.type === 'join') inCtx(() => notify.event('join', `${a.name} ist beigetreten`, `Jetzt online: ${inst.players.size}`));
  });
  inst.on('crash', (c) => {
    events.broadcast('crash', { at: c.at }, tgt);
    const what = (c.issues || []).map((i) => `• ${i.modId || i.modFile}`).slice(0, 8).join('\n');
    inCtx(() => {
      notify.event('crash', 'Server abgestürzt 🔴', what ? `Mögliche Ursache:\n${what}` : 'Der Server ist abgestürzt.');
      scheduler.onCrash(inst);
    });
  });
  // Discord-Meldungen für Start und Stopp
  let lastNotifyState = 'aus';
  inst.on('status', (s) => {
    if (s.state === 'läuft' && lastNotifyState !== 'läuft') inCtx(() => notify.event('start', 'Server ist online 🟢', 'Der Server ist gestartet. Spieler können sich verbinden.'));
    if (s.state === 'aus' && lastNotifyState !== 'aus' && !s.crashed) inCtx(() => notify.event('stop', 'Server ist aus', 'Der Server wurde gestoppt.'));
    lastNotifyState = s.state;
  });
  // Nach dem ersten Start eines Presets mit Bedrock: Spieler ohne Java-Account zulassen
  inst.on('status', (s) => {
    if (s.state !== 'läuft') return;
    inCtx(() => {
      if (!config.get().presetBedrock) return;
      setTimeout(() => inCtx(() => {
        try {
          bedrock.setAuthType('floodgate');
          config.update({ presetBedrock: false });
          inst.sys('Bedrock: Spieler brauchen keinen Java-Account (Floodgate). Bitte den Server einmal neu starten, damit das gilt.');
        } catch { /* Geyser hat seine Einstellungen noch nicht angelegt: beim nächsten Start erneut */ }
      }), 4000);
    });
  });
});

// ---------------------------------------------------------------- Einrichtung

app.get('/api/app-info', api(async () => ({ hosted: HOSTED, platform: process.platform })));

app.get('/api/setup', api(async () => {
  const st = setup.status();
  let plan = null;
  let planError = null;
  if (st.pack) {
    try {
      const p = setup.buildPlan();
      plan = {
        summary: p.summary, modrinthChecked: p.modrinthChecked, modrinthError: p.modrinthError,
        notInstalled: p.items.filter((i) => i.action !== 'install')
          .map((i) => ({ fileName: i.fileName, title: i.title, action: i.action, reason: i.reason })),
      };
    } catch (e) {
      planError = e.message;
    }
  }
  return { ...st, plan, planError, java: await java.detect(), running: mc.isRunning() };
}));

app.post('/api/setup/upload', async (req, res, next) => {
  try {
    jobs.assertIdle();
    requireStopped('Ein neues Modpack einlesen');
    let name = 'modpack.mrpack';
    try { name = decodeURIComponent(String(req.headers['x-filename'] || name)); } catch { /* Standardname */ }
    name = path.basename(name);
    if (!/\.mrpack$/i.test(name)) throw new UserError('Bitte eine .mrpack-Datei wählen.');
    if (HOSTED) await quota.assertDisk(req.user, Number(req.headers['content-length']) || 0);
    const tmp = path.join(config.DATA_DIR, `upload-${config.get().id}.mrpack`);
    await pipeline(req, fs.createWriteStream(tmp));
    const job = jobs.run('unpack', 'Modpack einlesen', async (ctx) => {
      try {
        return await setup.importMrpack(tmp, ctx, name);
      } finally {
        await fsp.rm(tmp, { force: true });
      }
    });
    res.json({ ok: true, job });
  } catch (e) {
    next(e);
  }
});

app.post('/api/setup/path', api(async (req) => {
  requireStopped('Ein neues Modpack einlesen');
  const p = String(req.body?.path || '').trim().replace(/^"|"$/g, '');
  if (!p) throw new UserError('Bitte einen Pfad zur .mrpack-Datei angeben.');
  if (!path.isAbsolute(p)) throw new UserError('Bitte den vollständigen Pfad angeben, z. B. C:\\Users\\Name\\Downloads\\Modpack.mrpack');
  if (!/\.mrpack$/i.test(p)) throw new UserError('Die Datei muss auf .mrpack enden.');
  if (!fs.existsSync(p)) throw new UserError(`Datei nicht gefunden: ${p}`, 404);
  return { job: jobs.run('unpack', 'Modpack einlesen', (ctx) => setup.importMrpack(p, ctx)) };
}));

app.post('/api/setup/serverdir', api(async (req) => {
  requireStopped('Den Server-Ordner ändern');
  jobs.assertIdle();
  return { serverDir: setup.setServerDir(req.body?.path, req.body?.force === true) };
}));

app.post('/api/setup/clientonly', api(async (req) => {
  config.update({ skipClientOnly: req.body?.enabled !== false });
}));

app.post('/api/setup/download', api(async () => {
  requireStopped('Mods herunterladen');
  return { job: jobs.run('download', 'Mods herunterladen', (ctx) => setup.installPack(ctx)) };
}));

app.get('/api/java', api(async () => java.detect(true)));
app.post('/api/java', api(async (req) => java.setManualPath(req.body?.path)));

app.post('/api/setup/neoforge', api(async () => {
  requireStopped('NeoForge installieren');
  await java.requireFor(config.get().javaMajor);
  return { job: jobs.run('neoforge', 'NeoForge installieren', (ctx) => setup.installNeoForge(ctx)) };
}));

app.post('/api/setup/eula', api(async (req) => {
  setup.setEula(req.body?.accepted);
}));

// ---------------------------------------------------------------- Mods

app.get('/api/mods', api(async () => {
  const list = await mods.list();
  const info = await modmeta.forFiles();
  const pending = modmeta.isPending();
  modmeta.refresh(); // holt fehlende Logos/Infos im Hintergrund, meldet danach "modmeta"
  return {
    mods: list.map((m) => {
      const x = info[m.file.toLowerCase()];
      return x ? { ...m, title: x.title, iconUrl: x.iconUrl, server: x.server, client: x.client } : m;
    }),
    excludes: config.get().excludes, running: mc.isRunning(), metaPending: pending,
  };
}));

// "Mods verbessern": reine Client-Mods und Ausschlussliste deaktivieren (apply=false zeigt nur die Vorschau)
app.post('/api/mods/improve', api(async (req) => {
  const apply = req.body?.apply === true;
  if (apply) requireStopped('Mods verbessern');
  return modmeta.improve(apply);
}));

app.post('/api/mods/delete', api(async (req) => {
  requireStopped('Mods löschen');
  return mods.remove(Array.isArray(req.body?.files) ? req.body.files.map(String) : []);
}));

app.post('/api/mods/toggle', api(async (req) => {
  requireStopped('Mods ein- oder ausschalten');
  await mods.setEnabled(req.body?.file, req.body?.enabled === true);
}));

app.post('/api/mods/disable', api(async (req) => {
  requireStopped('Mods ausschalten');
  await mods.setEnabled(req.body?.file, false);
}));

app.post('/api/excludes', api(async (req) => {
  const list = req.body?.excludes;
  if (!Array.isArray(list)) throw new UserError('Ungültige Liste.');
  const clean = [...new Set(list.map((s) => String(s).trim()).filter((s) => s && s.length <= 100))].slice(0, 200);
  config.update({ excludes: clean });
  return { excludes: clean };
}));

app.post('/api/excludes/apply', api(async () => {
  requireStopped('Die Ausschlussliste anwenden');
  return { changed: await mods.applyExcludes() };
}));

// ---------------------------------------------------------------- Server-Steuerung

app.get('/api/server', api(async () => ({ ...mc.info(), setupComplete: setup.status().complete })));
app.post('/api/server/start', api(async () => { jobs.assertIdle(); await mc.start(); }));
app.post('/api/server/stop', api(async () => { mc.stop(); }));
app.post('/api/server/restart', api(async () => { jobs.assertIdle(); await mc.restart(); }));
app.post('/api/server/command', api(async (req) => {
  const cmd = req.body?.command;
  if (typeof cmd !== 'string' || !cmd.trim()) throw new UserError('Bitte einen Befehl eingeben.');
  mc.command(cmd);
}));

app.get('/api/crash', api(async () => {
  if (mc.lastCrash) {
    // Mod-Status neu einlesen (z. B. nach "Diese Mod deaktivieren")
    const fresh = await crash.analyze({ sinceMs: mc.startedAt, logLines: mc.lines.slice(-800) });
    return { crashed: true, at: mc.lastCrash.at, code: mc.lastCrash.code, ...fresh };
  }
  const report = await crash.latestReport(0);
  if (!report) return { crashed: false };
  const fresh = await crash.analyze({ sinceMs: 0, logLines: [] });
  return { crashed: false, old: true, ...fresh };
}));

// ---------------------------------------------------------------- Einstellungen

app.get('/api/settings/ram', api(async (req) => {
  const cfg = config.get();
  const total = Math.floor(os.totalmem() / 1024 ** 3);
  if (HOSTED) {
    const maxGb = Math.max(2, Math.min(users.effectiveQuota(req.user).maxRamGb, quota.budgetGb()));
    return { xmsGb: cfg.xmsGb, xmxGb: cfg.xmxGb, totalGb: quota.budgetGb(), maxGb };
  }
  return { xmsGb: cfg.xmsGb, xmxGb: cfg.xmxGb, totalGb: total, maxGb: Math.max(2, total - 1) };
}));

app.post('/api/settings/ram', api(async (req) => {
  const xms = Number(req.body?.xmsGb);
  const xmx = Number(req.body?.xmxGb);
  const total = Math.floor(os.totalmem() / 1024 ** 3);
  if (!Number.isInteger(xms) || !Number.isInteger(xmx) || xms < 1 || xmx < 2) throw new UserError('Ungültige RAM-Werte.');
  if (xms > xmx) throw new UserError('Der Start-RAM (Xms) darf nicht größer als der Maximal-RAM (Xmx) sein.');
  if (HOSTED) quota.assertRamSetting(req.user, xmx);
  else if (xmx > Math.max(2, total - 1)) throw new UserError(`Dein PC hat ${total} GB RAM. Bitte höchstens ${Math.max(2, total - 1)} GB für den Server nehmen.`);
  config.update({ xmsGb: xms, xmxGb: xmx });
  setup.writeJvmArgs();
  return { xmsGb: xms, xmxGb: xmx, restartNeeded: mc.isRunning() };
}));

app.get('/api/properties', api(async () => ({ ...properties.getForm(), raw: properties.readRaw() })));
// Minecraft schreibt server.properties beim Stoppen (und bei manchen Befehlen) mit seinen Werten zurück.
// Was bei laufendem Server gespeichert wird, merken wir uns und tragen es nach dem Stoppen erneut ein.
const pendingProps = new Map();
function rememberProps(entry) {
  if (!mc.isRunning()) return;
  const id = config.get().id;
  const prev = pendingProps.get(id) || {};
  pendingProps.set(id, entry.raw !== undefined ? { raw: entry.raw } : { values: { ...(prev.values || {}), ...entry.values } });
}
mcRegistry.onCreate((inst) => {
  inst.on('status', (st) => {
    if (st.state !== 'aus' || !pendingProps.has(inst.id)) return;
    const p = pendingProps.get(inst.id);
    pendingProps.delete(inst.id);
    setTimeout(() => ctx.run({ id: inst.id, user: null }, () => {
      try {
        if (p.raw !== undefined) properties.saveRaw(p.raw);
        else properties.saveForm(p.values);
      } catch (e) { console.error('Einstellungen konnten nach dem Stoppen nicht eingetragen werden:', e.message); }
    }), 1500);
  });
});

app.post('/api/properties', api(async (req) => {
  setup.ensureServerDir();
  const form = properties.saveForm(req.body?.values);
  rememberProps({ values: req.body?.values || {} });
  return { ...form, raw: properties.readRaw(), restartNeeded: mc.isRunning() };
}));
app.post('/api/properties/raw', api(async (req) => {
  setup.ensureServerDir();
  properties.saveRaw(req.body?.text);
  rememberProps({ raw: req.body?.text });
  return { ...properties.getForm(), raw: properties.readRaw(), restartNeeded: mc.isRunning() };
}));

// ---------------------------------------------------------------- Spieler

app.get('/api/players', api(async () => ({
  online: [...mc.players], maxPlayers: mc.maxPlayers, running: mc.state === 'läuft',
  whitelist: players.readList('whitelist'), ops: players.readList('ops'),
  whitelistEnabled: properties.get('white-list', 'false') === 'true',
  onlineMode: properties.get('online-mode', 'true') !== 'false',
})));

app.post('/api/players/refresh', api(async () => {
  if (mc.state === 'läuft') {
    const wait = mc.waitForLine(/players online/, 5000).catch(() => null);
    mc.command('list', true);
    await wait;
  }
  return { online: [...mc.players], maxPlayers: mc.maxPlayers };
}));

// Server, die für Spieler-Aktionen über mehrere Server in Frage kommen
function playerServers(req) {
  const list = HOSTED ? config.listFor(req.user) : config.list();
  const currentId = config.get().id; // außerhalb von ctx.run lesen, sonst ist jeder Server "aktuell"
  return list.map((p) => ctx.run({ id: p.id, user: req.user || null }, () => {
    let whitelistEnabled = false;
    let ready = false;
    try {
      ready = !!p.serverDir && fs.existsSync(p.serverDir);
      whitelistEnabled = ready && properties.get('white-list', 'false') === 'true';
    } catch { /* Server noch nicht eingerichtet */ }
    return { id: p.id, name: p.name, type: p.type, ready, whitelistEnabled, running: mcRegistry.get(p.id).isRunning(), current: p.id === currentId };
  }));
}

app.get('/api/players/servers', api(async (req) => ({ servers: playerServers(req) })));

// Spieler auf einmal zu mehreren Servern hinzufügen oder entfernen (Whitelist und/oder OP)
app.post('/api/players/bulk', api(async (req) => {
  const b = req.body || {};
  const action = b.action === 'remove' ? 'remove' : 'add';
  const kinds = [b.whitelist ? 'whitelist' : null, b.op ? 'ops' : null].filter(Boolean);
  if (!kinds.length) throw new UserError('Bitte mindestens „Whitelist“ oder „Operator“ auswählen.');
  const name = String(b.name || '').trim();
  if (!name) throw new UserError('Bitte einen Spielernamen eingeben.');
  const all = playerServers(req);
  const currentId = config.get().id;
  let targets;
  if (b.scope === 'all') targets = all;
  else if (b.scope === 'whitelisted') targets = all.filter((s) => s.whitelistEnabled);
  else if (b.scope === 'selected') {
    const ids = new Set(Array.isArray(b.servers) ? b.servers.map(String) : []);
    targets = all.filter((s) => ids.has(s.id));
  } else targets = all.filter((s) => s.id === currentId);
  if (!targets.length) throw new UserError(b.scope === 'whitelisted' ? 'Kein Server hat gerade die Whitelist eingeschaltet.' : 'Bitte mindestens einen Server auswählen.');

  const results = [];
  for (const s of targets) {
    if (!s.ready) { results.push({ id: s.id, server: s.name, ok: true, skipped: true, message: 'noch nicht eingerichtet, übersprungen' }); continue; }
    for (const kind of kinds) {
      const label = kind === 'ops' ? 'OP' : 'Whitelist';
      try {
        // eslint-disable-next-line no-await-in-loop
        const r = await ctx.run({ id: s.id, user: req.user || null }, () => players.modify(kind, action, name, mcRegistry.get(s.id), { bedrock: !!b.bedrock }));
        results.push({ id: s.id, server: s.name, kind: label, ok: true, message: action === 'add' ? (r.viaConsole ? 'hinzugefügt (über die Konsole)' : 'hinzugefügt') : 'entfernt' });
      } catch (e) {
        const already = e.status === 409 && /schon auf der Liste/.test(e.message);
        const missing = e.status === 404 && /nicht auf der Liste/.test(e.message);
        results.push({ id: s.id, server: s.name, kind: label, ok: already || missing, message: already ? 'war schon eingetragen' : missing ? 'war nicht eingetragen' : e.message });
        if (e.status === 404 && /gibt es nicht/.test(e.message)) return { results, error: e.message }; // falscher Name: nicht bei jedem Server erneut versuchen
      }
    }
  }
  return { results };
}));

// Whitelist direkt im Spieler-Bereich ein- und ausschalten
app.post('/api/players/whitelist-mode', api(async (req) => {
  setup.ensureServerDir();
  const on = !!req.body?.enabled;
  if (mc.isRunning()) {
    // Der laufende Server schreibt die Einstellung selbst in server.properties
    if (mc.state !== 'läuft') throw new UserError('Bitte warten, bis der Server fertig gestartet ist.', 409);
    mc.command(`whitelist ${on ? 'on' : 'off'}`);
    const pending = pendingProps.get(config.get().id);
    if (pending?.values && 'white-list' in pending.values) pending.values['white-list'] = on ? 'true' : 'false';
    await sleep(1200);
  } else {
    properties.set({ 'white-list': on ? 'true' : 'false' });
  }
  return { enabled: on };
}));

// Nachricht an alle Spieler im Spiel
app.post('/api/players/broadcast', api(async (req) => {
  const text = String(req.body?.text || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
  if (!text) throw new UserError('Bitte eine Nachricht eingeben.');
  if (mc.state !== 'läuft') throw new UserError('Dafür muss der Server laufen.', 409);
  mc.command(`say ${text}`);
  return { ok: true };
}));

app.post('/api/players/:list', api(async (req) => {
  const kind = req.params.list;
  if (kind !== 'whitelist' && kind !== 'ops') throw new UserError('Unbekannte Liste.', 404);
  setup.ensureServerDir();
  return players.modify(kind, req.body?.action, req.body?.name, mc, { bedrock: !!req.body?.bedrock });
}));

// ---------------------------------------------------------------- Freunde einladen

app.get('/api/network', api(async () => {
  const cfg = config.get();
  if (HOSTED) return { ips: [{ address: hosted.publicHost(), adapter: 'Adresse dieser Seite', likelyLan: true }], port: cfg.port, bedrockPort: cfg.bedrockPort, publicHost: hosted.publicHost(), hosted: true };
  return { ips: network.localIps(), port: Number(properties.get('server-port', '25565')) || 25565, domain: netconf.get().publicDomain || null };
}));
app.get('/api/network/public', api(async () => (HOSTED ? { ip: hosted.publicHost() } : { ip: await network.publicIp() })));

// ---------------------------------------------------------------- Backups

app.get('/api/backups', api(async () => ({
  backups: await backup.list(), world: backup.worldName(), running: mc.isRunning(),
  dir: config.serverPath('backups'),
})));
app.post('/api/backups', api(async (req) => {
  if (HOSTED) await quota.assertDisk(req.user);
  return { job: jobs.run('backup', 'Welt sichern', (jctx) => backup.create(jctx, mc)) };
}));
app.post('/api/backups/restore', api(async (req) => {
  requireStopped('Wiederherstellen');
  const name = req.body?.name;
  return { job: jobs.run('restore', 'Backup wiederherstellen', (ctx) => backup.restore(ctx, mc, name)) };
}));
app.post('/api/backups/delete', api(async (req) => { await backup.remove(req.body?.name); }));



// ---------------------------------------------------------------- Mehrere Server

app.get('/api/servers', api(async () => ({
  servers: servers.list(),
  types: Object.entries(serverTypes.TYPES).map(([id, t]) => ({ id, label: t.label, desc: t.desc, kind: t.kind, versions: t.versions })),
  runningId: HOSTED ? null : (mc.isRunning() ? config.activeId() : null),
  hosted: HOSTED,
})));

app.get('/api/versions', api(async (req) => {
  const type = String(req.query.type || '');
  return { versions: await serverTypes.listVersions(type, req.query.snapshots === '1') };
}));

app.post('/api/servers', api(async (req) => {
  if (!HOSTED) { requireStopped('Einen neuen Server anlegen'); jobs.assertIdle(); }
  const body = req.body || {};
  const p = await servers.create(body);
  selectServer(req, p.id);
  switchedTo(req);
  if (p.type === 'modpack') return { id: p.id };
  const accept = body.acceptEula === true;
  const job = inServer(req, p.id, () => jobs.run('install', `${p.name} installieren`, async (jctx) => {
    const r = await serverTypes.installServer(jctx);
    if (accept) setup.setEula(true);
    return r;
  }));
  return { id: p.id, job };
}));

app.post('/api/servers/activate', api(async (req) => {
  const id = String(req.body?.id || '');
  const p = config.list().find((s) => s.id === id);
  if (!p || (HOSTED && !config.canAccess(req.user, p))) throw new UserError('Server nicht gefunden.', 404);
  if (!HOSTED) { requireStopped('Den Server wechseln'); jobs.assertIdle(); }
  selectServer(req, id);
  switchedTo(req);
}));

// ---------------------------------------------------------------- Presets

app.get('/api/presets', api(async () => ({ presets: presets.PRESETS.map(presets.publicInfo) })));

app.get('/api/presets/suggest', api(async (req) => {
  const p = presets.byId(String(req.query.preset || ''));
  if (!p) throw new UserError('Unbekanntes Preset.', 404);
  return presets.suggest(p, req.query.bedrock === '1');
}));

app.post('/api/presets/create', api(async (req) => {
  if (!HOSTED) { requireStopped('Ein Preset installieren'); jobs.assertIdle(); }
  const body = req.body || {};
  const p = presets.byId(String(body.preset || ''));
  if (!p) throw new UserError('Unbekanntes Preset.', 404);
  const bedrockWanted = body.bedrock === true;
  const profile = await servers.create({ name: body.name || p.name, type: p.type, mcVersion: body.mcVersion, ramGb: body.ramGb ?? p.ramGb });
  selectServer(req, profile.id);
  if (bedrockWanted) config.update({ presetBedrock: true }, profile.id);
  switchedTo(req);
  const accept = body.acceptEula === true;
  const job = inServer(req, profile.id, () => jobs.run('install', `Preset „${p.name}“ installieren`, async (jctx) => {
    jctx.log(`1/4  Server installieren (${serverTypes.TYPES[p.type].label} ${profile.mcVersion})`);
    await serverTypes.installServer(jctx);
    if (accept) setup.setEula(true);
    jctx.log('2/4  Einstellungen schreiben');
    properties2.set(p.props);
    jctx.log(`3/4  ${serverTypes.TYPES[p.type].kind === 'plugins' ? 'Plugins' : 'Mods'} installieren`);
    const r = await modinstall.installMany(p.content.map(([s]) => s), jctx);
    if (bedrockWanted) {
      jctx.log('4/4  Bedrock-Support (Geyser + Floodgate) installieren');
      try { await bedrock.install(jctx); } catch (e) { jctx.log(`⚠ Bedrock-Support konnte nicht installiert werden: ${e.message}`); }
    }
    jctx.log(r.skipped.length ? `Fertig. Übersprungen: ${r.skipped.join(', ')}` : 'Fertig! Du kannst den Server jetzt starten.');
    return { id: profile.id, skipped: r.skipped };
  }));
  return { id: profile.id, job };
}));

// Modpack bei Modrinth suchen und als kompletten Server installieren (ein Klick)
app.post('/api/modpacks/create', api(async (req) => {
  if (!HOSTED) { requireStopped('Ein Modpack-Server anlegen'); jobs.assertIdle(); }
  const body = req.body || {};
  const id = String(body.id || '');
  if (!/^[A-Za-z0-9_-]{2,64}$/.test(id)) throw new UserError('Ungültige Modpack-ID.');
  const profile = await servers.create({ name: body.name || 'Modpack-Server', type: 'modpack', ramGb: body.ramGb ?? 8 });
  selectServer(req, profile.id);
  switchedTo(req);
  const accept = body.acceptEula === true;
  const job = inServer(req, profile.id, () => jobs.run('install', 'Modpack-Server installieren', async (jctx) => {
    jctx.log('1/5  Modpack von Modrinth laden und einlesen');
    await modpacks.install(jctx, id);
    jctx.log('2/5  Mods herunterladen (Client-Mods werden gleich deaktiviert abgelegt)');
    await setup.installPack(jctx);
    jctx.log('3/5  NeoForge installieren');
    await setup.installNeoForge(jctx);
    jctx.log('4/5  Übrige Client-Mods aussortieren');
    try {
      const r = await modmeta.improve(true);
      jctx.log(r.changed.length ? `${r.changed.length} weitere Mod(s) deaktiviert, die auf einem Server nichts tun.` : 'Es gab nichts mehr auszusortieren.');
      if (r.mismatch.length) jctx.log(`Hinweis: ${r.mismatch.length} Mod(s) passen laut Modrinth vielleicht nicht zur Version.`);
    } catch (e) {
      jctx.log(`⚠ Aussortieren übersprungen: ${e.message}`);
    }
    if (accept) { jctx.log('5/5  EULA gespeichert'); setup.setEula(true); }
    jctx.log('Fertig! Du kannst den Server jetzt starten.');
    return { id: profile.id };
  }));
  return { id: profile.id, job };
}));

app.post('/api/servers/detect', api(async (req) => {
  const p = String(req.body?.path || '').trim().replace(/^"|"$/g, '');
  if (!path.isAbsolute(p)) throw new UserError('Bitte den vollständigen Pfad angeben, z. B. C:\\MinecraftServer');
  return servers.detectExisting(path.resolve(p));
}));

app.post('/api/servers/adopt', api(async (req) => {
  requireStopped('Einen Server übernehmen');
  jobs.assertIdle();
  const p = await servers.adopt({ name: req.body?.name, path: req.body?.path });
  selectServer(req, p.id);
  switchedTo(req);
  return { id: p.id };
}));

app.post('/api/servers/rename', api(async (req) => { servers.rename(String(req.body?.id || ''), req.body?.name); }));

app.post('/api/servers/delete', api(async (req) => {
  const id = String(req.body?.id || '');
  if (!HOSTED) {
    if (id === config.activeId()) requireStopped('Den aktiven Server entfernen');
    jobs.assertIdle();
  }
  const wasSelected = HOSTED ? id === ctx.id() : id === config.activeId();
  servers.remove(id, req.body?.deleteFiles === true);
  if (wasSelected) switchedTo(req);
}));

app.post('/api/servers/upgrade', api(async (req) => {
  requireStopped('Die Version wechseln');
  const v = String(req.body?.mcVersion || '');
  return { job: jobs.run('install', 'Version wechseln', (ctx) => servers.upgrade(ctx, mc, v)) };
}));

app.post('/api/setup/install', api(async () => {
  requireStopped('Den Server installieren');
  if (config.get().type === 'modpack') throw new UserError('Ein Modpack-Server wird über die Einrichtung installiert.');
  return { job: jobs.run('install', 'Server installieren', (ctx) => serverTypes.installServer(ctx)) };
}));

// ---------------------------------------------------------------- Mods hinzufügen

app.post('/api/mods/upload', async (req, res, next) => {
  try {
    let name = '';
    try { name = decodeURIComponent(String(req.headers['x-filename'] || '')); } catch { /* ungültig */ }
    if (HOSTED) await quota.assertDisk(req.user, Number(req.headers['content-length']) || 0);
    res.json({ ok: true, ...(await modinstall.saveUpload(req, path.basename(name))) });
  } catch (e) {
    next(e);
  }
});

app.get('/api/modrinth/search', api(async (req) => {
  const mcv = modinstall.mcVersion();
  const r = await modrinth.search(String(req.query.q || '').slice(0, 100), mcv, modinstall.loadersFor(), { offset: req.query.offset, allVersions: req.query.all === '1', sort: String(req.query.sort || '') });
  return { results: r.hits, total: r.total, mc: mcv };
}));

app.post('/api/modrinth/install', api(async (req) => {
  const id = String(req.body?.id || '');
  if (!/^[A-Za-z0-9_-]{2,64}$/.test(id)) throw new UserError('Ungültige Mod-ID.');
  return { job: jobs.run('modinstall', 'Mod installieren', (ctx) => modinstall.installFromModrinth([id], ctx)) };
}));


// ---------------------------------------------------------------- Übersicht: Köpfe, Kennzahlen, Icon, Aktionen

app.get('/api/head/:name', async (req, res) => {
  const name = req.params.name;
  if (!/^[A-Za-z0-9_]{1,16}$/.test(name)) return res.status(404).end();
  const file = await heads.get(name);
  if (!file) return res.status(404).end();
  res.set('Cache-Control', 'public, max-age=86400');
  res.type('png').sendFile(file);
});

app.get('/api/activity', api(async () => ({ activity: mc.activity })));
app.get('/api/overview', api(async () => overview.summary()));

app.get('/api/server/icon', (req, res) => {
  let p;
  try { p = overview.iconPath(); } catch { return res.status(404).end(); }
  if (!fs.existsSync(p)) return res.status(404).end();
  res.set('Cache-Control', 'no-cache');
  res.type('png').sendFile(p);
});
app.post('/api/server/icon', express.raw({ type: 'image/png', limit: '300kb' }), api(async (req) => {
  overview.saveIcon(req.body);
  return { restartNeeded: mc.isRunning() };
}));

const PLAYER_ACTIONS = {
  kick: 'kick', ban: 'ban', pardon: 'pardon', op: 'op', deop: 'deop',
  survival: 'gamemode survival', creative: 'gamemode creative', spectator: 'gamemode spectator', adventure: 'gamemode adventure',
};
app.post('/api/player-action', api(async (req) => {
  const { name, action } = req.body || {};
  const bare = typeof name === 'string' && players.floodgatePrefix() && name.startsWith(players.floodgatePrefix()) ? name.slice(players.floodgatePrefix().length) : name;
  if (typeof name !== 'string' || !/^[A-Za-z0-9_]{1,16}$/.test(bare)) throw new UserError('Ungültiger Spielername.');
  if (!PLAYER_ACTIONS[action]) throw new UserError('Unbekannte Aktion.');
  if (mc.state !== 'läuft') throw new UserError('Dafür muss der Server laufen.', 409);
  const reason = String(req.body?.reason || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 100);
  mc.command(`${PLAYER_ACTIONS[action]} ${name}${reason && (action === 'kick' || action === 'ban') ? ` ${reason}` : ''}`);
}));

// ---------------------------------------------------------------- Bedrock (Geyser)

app.get('/api/bedrock', api(async () => ({ ...(await bedrock.status()), running: mc.isRunning() })));
app.post('/api/bedrock/install', api(async () => {
  requireStopped('Bedrock-Support installieren');
  return { job: jobs.run('modinstall', 'Bedrock-Support installieren', (ctx) => bedrock.install(ctx)) };
}));
app.post('/api/bedrock/auth', api(async (req) => {
  requireStopped('Diese Einstellung ändern');
  bedrock.setAuthType(req.body?.type);
}));

// ---------------------------------------------------------------- Übersicht & Auto-Backup

app.get('/api/server/stats', api(async () => ({ memMb: await mc.stats() })));

app.get('/api/settings/autobackup', api(async () => {
  const c = config.get();
  return { hours: c.autoBackupHours, keep: c.autoBackupKeep };
}));
app.post('/api/settings/autobackup', api(async (req) => {
  const hours = Number(req.body?.hours);
  const keep = Number(req.body?.keep);
  if (!Number.isFinite(hours) || hours < 0 || hours > 168) throw new UserError('Ungültiges Intervall.');
  if (!Number.isInteger(keep) || keep < 1 || keep > 200) throw new UserError('Bitte 1 bis 200 Backups behalten.');
  config.update({ autoBackupHours: hours, autoBackupKeep: keep });
}));

const lastAuto = new Map();
setInterval(() => {
  for (const p of [...config.list()]) {
    ctx.run({ id: p.id, user: null }, () => {
      const inst = mcRegistry.get(p.id);
      if (!p.autoBackupHours || inst.state !== 'läuft' || jobs.busy()) return;
      const last = Math.max(lastAuto.get(p.id) || 0, inst.readyAt || 0);
      if (Date.now() - last < p.autoBackupHours * 3600e3) return;
      lastAuto.set(p.id, Date.now());
      try {
        jobs.run('backup', 'Automatisches Backup', async (jctx) => {
          const r = await backup.create(jctx, inst, 'auto');
          await backup.pruneAuto(config.get().autoBackupKeep);
          return r;
        });
      } catch { /* beschäftigt: beim nächsten Durchlauf erneut */ }
    });
  }
}, 60000).unref();

// ---------------------------------------------------------------- Cloud-Sync (synchronisierter Ordner)

app.get('/api/cloud', api(async () => cloud.status()));
app.post('/api/cloud/folder', api(async (req) => { cloud.setFolder(req.body?.path); }));
app.post('/api/cloud/settings', api(async (req) => {
  const m = Number(req.body?.autoMinutes);
  if (!Number.isFinite(m) || m < 0 || m > 10080) throw new UserError('Ungültiges Intervall.');
  config.setGlobal({ cloudAutoMinutes: m, cloudWithBackups: req.body?.withBackups === true });
}));
app.post('/api/cloud/push', api(async (req) => ({
  job: jobs.run('cloud', 'In die Cloud sichern', (ctx) => cloud.push(ctx, { all: req.body?.all !== false, withBackups: req.body?.withBackups === true })),
})));
app.post('/api/cloud/pull', api(async (req) => ({
  job: jobs.run('cloud', 'Aus der Cloud holen', (ctx) => cloud.pull(ctx, req.body?.folder)),
})));

if (!HOSTED) setInterval(() => {
  const g = config.global();
  if (!g.cloudDir || !g.cloudAutoMinutes || jobs.busy()) return;
  if (Date.now() - (g.cloudLastSync || 0) < g.cloudAutoMinutes * 60000) return;
  if (!fs.existsSync(g.cloudDir)) return;
  try { jobs.run('cloud', 'Automatische Cloud-Sicherung', (ctx) => cloud.push(ctx, { all: true, withBackups: g.cloudWithBackups })); } catch { /* beschäftigt */ }
}, 60000).unref();

// ---------------------------------------------------------------- Dateimanager

app.get('/api/files', api(async (req) => files.list(String(req.query.path || ''))));
app.get('/api/files/read', api(async (req) => files.readText(String(req.query.path || ''))));
app.post('/api/files/write', api(async (req) => { await files.writeText(String(req.body?.path || ''), req.body?.text); }));
app.post('/api/files/mkdir', api(async (req) => { await files.mkdir(String(req.body?.path || '')); }));
app.post('/api/files/delete', api(async (req) => { await files.remove(String(req.body?.path || '')); }));
app.post('/api/files/rename', api(async (req) => { await files.rename(String(req.body?.from || ''), String(req.body?.to || '')); }));
app.post('/api/files/upload', async (req, res, next) => {
  try {
    let dir = '';
    let name = '';
    try { dir = decodeURIComponent(String(req.headers['x-dir'] || '')); name = decodeURIComponent(String(req.headers['x-filename'] || '')); } catch { /* ungültig */ }
    if (HOSTED) await quota.assertDisk(req.user, Number(req.headers['content-length']) || 0);
    res.json({ ok: true, ...(await files.upload(req, dir, path.basename(name))) });
  } catch (e) {
    next(e);
  }
});
app.get('/api/files/download', (req, res, next) => {
  try {
    const { abs, name } = files.downloadInfo(String(req.query.path || ''));
    res.download(abs, name, (err) => { if (err && !res.headersSent) next(err); });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------- Zeitplan, Automatik, Discord

app.get('/api/automation', api(async () => {
  const c = config.get();
  return {
    schedules: c.schedules, autoRestartOnCrash: c.autoRestartOnCrash, autoStopMinutes: c.autoStopMinutes,
    webhook: { set: !!c.webhookUrl, hint: c.webhookUrl ? `…${c.webhookUrl.slice(-6)}` : null, events: c.webhookEvents },
  };
}));
app.post('/api/schedules', api(async (req) => ({ schedule: scheduler.save(scheduler.clean(req.body)) })));
app.post('/api/schedules/delete', api(async (req) => { scheduler.remove(String(req.body?.id || '')); }));
app.post('/api/schedules/run', api(async (req) => {
  const s = config.get().schedules.find((x) => x.id === req.body?.id);
  if (!s) throw new UserError('Aufgabe nicht gefunden.', 404);
  await scheduler.run(s);
}));
app.post('/api/automation', api(async (req) => {
  const m = Number(req.body?.autoStopMinutes);
  if (!Number.isInteger(m) || m < 0 || m > 1440) throw new UserError('Der Auto-Stopp muss zwischen 0 und 1440 Minuten liegen.');
  config.update({ autoRestartOnCrash: req.body?.autoRestartOnCrash === true, autoStopMinutes: m });
}));
app.post('/api/webhook', api(async (req) => {
  const url = req.body?.url;
  const patch = {};
  if (url === '' || url === null) patch.webhookUrl = null;
  else if (typeof url === 'string' && url.trim()) patch.webhookUrl = notify.validate(url.trim());
  const ev = req.body?.events;
  if (ev && typeof ev === 'object') patch.webhookEvents = { start: ev.start === true, stop: ev.stop === true, crash: ev.crash === true, join: ev.join === true };
  config.update(patch);
}));
app.post('/api/webhook/test', api(async () => { await notify.test(); }));

scheduler.init();

// ---------------------------------------------------------------- Updates, Modpacks, Welt

app.get('/api/updates', api(async () => ({ updates: await modupdate.check() })));
app.post('/api/updates/apply', api(async (req) => {
  requireStopped('Updates einspielen');
  const list = Array.isArray(req.body?.files) ? req.body.files.map(String).slice(0, 300) : [];
  return { job: jobs.run('modinstall', 'Updates einspielen', (ctx) => modupdate.apply(ctx, list)) };
}));

app.get('/api/modpacks/search', api(async (req) => {
  const opts = { index: String(req.query.index || 'downloads'), offset: Number(req.query.offset) || 0 };
  if (req.query.source === 'curseforge') return curseforge.search(req.query.q, opts);
  return modpacks.search(req.query.q, opts);
}));
app.get('/api/curseforge', api(async () => ({ hasKey: curseforge.hasKey() })));
app.post('/api/curseforge/key', api(async (req) => { curseforge.setKey(req.body?.key); return { hasKey: curseforge.hasKey() }; }));
app.get('/api/modpacks/update', api(async () => modpacks.updateInfo()));
app.post('/api/modpacks/install', api(async (req) => {
  requireStopped('Ein Modpack installieren');
  if (config.get().type !== 'modpack') throw new UserError('Das geht nur bei einem Server vom Typ „Modpack“.');
  const id = String(req.body?.id || '');
  if (!/^[A-Za-z0-9_-]{2,64}$/.test(id)) throw new UserError('Ungültige Modpack-ID.');
  return { job: jobs.run('unpack', 'Modpack installieren', (ctx) => modpacks.install(ctx, id)) };
}));

app.post('/api/world/reset', api(async (req) => {
  requireStopped('Die Welt zurücksetzen');
  const seed = req.body?.seed;
  return { job: jobs.run('backup', 'Welt zurücksetzen', (ctx) => world.reset(ctx, mc, seed)) };
}));

// ---------------------------------------------------------------- Fehlerbehandlung

app.use('/api', (req, res) => res.status(404).json({ error: 'Unbekannte Adresse.' }));

app.use((err, req, res, _next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Die Daten sind zu groß.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Ungültige Anfrage.' });
  if (!err.userFacing) console.error(err);
  const status = err.userFacing ? err.status : 500;
  res.status(status).json({
    error: err.userFacing ? err.message : `Interner Fehler: ${err.message}`,
    code: err.code && err.userFacing ? err.code : undefined,
  });
});

// ---------------------------------------------------------------- Start

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

listeners.start(app).then(() => {
  const st = listeners.state();
  if (HOSTED) console.log(`Server-Dashboard (Mehrbenutzer) läuft: ${hosted.get().publicUrl}  (Port ${PORT})`);
  else console.log(`Server-Dashboard läuft: http://localhost:${PORT}`);
  for (const u of listeners.urls()) if (u.kind !== 'local') console.log(`  ${u.label}: ${u.url}`);
  for (const e of st.errors) console.error(`  Hinweis: ${e}`);
  const nc = netconf.get();
  if (nc.envLocked.includes('bind')) console.log(`  Hinweis: Die Adresse ist durch die Umgebungsvariable BIND=${process.env.BIND} festgelegt und lässt sich im Dashboard nicht ändern. Entferne BIND (z. B. aus /etc/mcdash.env), damit „Netzwerk & Betrieb“ gilt.`);
  else if (nc.bind === 'local') console.log('  Hinweis: Das Dashboard hört nur auf diesem Rechner (Einstellung „Nur dieser PC“ unter Netzwerk & Betrieb).');
  console.log(`  Eingestellte Adresse: ${nc.bind === 'local' ? 'nur dieser Rechner (127.0.0.1)' : nc.bind === 'network' ? 'alle Netzwerk-Adressen (0.0.0.0)' : nc.customBind.join(', ')}, Port ${nc.port}`);
  if (netconf.get().bind !== 'local' && !HOSTED && !access.enabled()) {
    console.log('  Achtung: Das Dashboard ist im Netzwerk erreichbar, aber ohne Zugangspasswort. Setze eines unter „Netzwerk & Betrieb“.');
  }
  certs.startRenewal((m) => console.log(`[HTTPS] ${m}`));
  autoStartServers().catch((e) => console.error('Autostart:', e.message));
  if (process.argv.includes('--open') && !HOSTED) openBrowser(`http://localhost:${PORT}`);
}).catch((e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`
Port ${PORT} ist schon belegt. Läuft das Dashboard vielleicht schon in einem anderen Fenster?`);
    console.error(`Öffne einfach http://localhost:${PORT} im Browser.
`);
  } else {
    console.error('Das Dashboard konnte nicht starten:', e.message);
  }
  process.exit(1);
});

/** Startet nach dem Hochfahren die Server wieder, die beim letzten Beenden liefen (wenn der Haken gesetzt ist). */
async function autoStartServers() {
  const rs = runstate.get();
  if (!rs.autoStart) return;
  const known = new Set(config.list().map((p) => p.id));
  const ids = rs.running.filter((id) => known.has(id));
  if (!ids.length) return;
  console.log(`Autostart: ${ids.length} Minecraft-Server ${ids.length === 1 ? 'wird' : 'werden'} wieder gestartet …`);
  for (const id of HOSTED ? ids : ids.slice(-1)) {
    await sleep(3000);
    if (shuttingDown) return;
    try {
      if (!HOSTED) config.setActive(id); // damit das Dashboard den gestarteten Server anzeigt
      await ctx.run({ id, user: null }, () => mcRegistry.get(id).start());
    } catch (e) {
      mcRegistry.get(id).sys(`Autostart nicht möglich: ${e.message}`);
      console.error(`Autostart (${id}): ${e.message}`);
      runstate.markStopped(id);
    }
  }
}

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (mcRegistry.runningCount()) {
    console.log('Minecraft-Server werden sauber gestoppt …');
    // Beim Schließen des Fensters (SIGHUP) bleiben unter Windows nur wenige Sekunden
    await mcRegistry.shutdownAll(signal === 'SIGHUP' ? 4500 : 60000);
  }
  process.exit(0);
}
for (const s of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) process.on(s, () => shutdown(s));
