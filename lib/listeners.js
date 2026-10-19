'use strict';
// Startet, stoppt und lädt die Netzwerk-Zugänge des Dashboards neu:
//  - HTTP auf dem eingestellten Port (nur dieser PC, im Netzwerk oder auf bestimmten Adressen)
//  - HTTPS auf Port 443, sobald ein gültiges Zertifikat da ist (dann bleibt der HTTP-Port auf diesen PC beschränkt)
//  - Port 80: Bestätigung für Let’s Encrypt und Umleitung auf HTTPS
// Laufende Minecraft-Server sind davon nicht betroffen, sie hängen nicht an diesen Zugängen.
const http = require('http');
const https = require('https');
const netconf = require('./netconf');
const certs = require('./certs');
const { UserError } = require('./util');

let app = null;
const live = { main: [], https: [], port80: null, errors: [], httpsActive: false };

function listenOn(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (e) => { server.removeListener('listening', onListening); reject(e); };
    const onListening = () => { server.removeListener('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

/** Hört sofort auf zu lauschen. Laufende Anfragen (auch die, die diese Änderung ausgelöst hat) dürfen noch fertig werden. */
function closeServer(server) {
  if (!server) return;
  try { server.close(); } catch { /* egal */ }
  try { server.closeIdleConnections?.(); } catch { /* egal */ }
  setTimeout(() => { try { server.closeAllConnections?.(); } catch { /* egal */ } }, 2500).unref();
}

function httpsRedirectTarget(req) {
  const s = netconf.get().https;
  const port = s.httpsPort === 443 ? '' : `:${s.httpsPort}`;
  return `https://${s.domain}${port}${req.url}`;
}

/** Server auf Port 80: Antworten für Let’s Encrypt, sonst Umleitung auf HTTPS. */
function challengeHandler(req, res) {
  const m = String(req.url || '').match(/^\/\.well-known\/acme-challenge\/([A-Za-z0-9_-]{10,200})$/);
  if (m && certs.challenges.has(m[1])) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end(certs.challenges.get(m[1]));
  }
  const s = netconf.get().https;
  if (live.httpsActive && s.redirect && s.domain) {
    res.writeHead(301, { Location: httpsRedirectTarget(req) });
    return res.end();
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  return res.end('Nicht gefunden.');
}

async function ensureChallengePort() {
  if (live.port80?.listening) return;
  const s = netconf.get().https;
  const server = http.createServer(challengeHandler);
  try {
    await listenOn(server, s.httpPort, '0.0.0.0');
  } catch (e) {
    if (e.code === 'EACCES') throw new UserError(`Port ${s.httpPort} darf auf diesem System nicht geöffnet werden. Unter Linux brauchst du dafür eine Berechtigung (siehe DEPLOY.md, Abschnitt HTTPS), unter Windows prüfe die Firewall.`);
    if (e.code === 'EADDRINUSE') throw new UserError(`Port ${s.httpPort} ist schon belegt (z. B. von einem anderen Webserver). Beende ihn oder ändere den HTTP-Port.`);
    throw e;
  }
  live.port80 = server;
}

async function stopAll() {
  const all = [...live.main, ...live.https, live.port80];
  live.main = []; live.https = []; live.port80 = null; live.httpsActive = false;
  all.forEach(closeServer);
  await new Promise((r) => setTimeout(r, 80)); // kurz warten, bis die Ports frei sind
}

/** Startet alle Zugänge. Fehler beim Haupt-Zugang werden weitergereicht, die übrigen landen in live.errors. */
async function start(application) {
  app = application || app;
  live.errors = [];
  const cfg = netconf.get();
  const cert = cfg.https.enabled && certs.usable() ? certs.load() : null;
  live.httpsActive = !!cert;

  const hosts = netconf.bindAddresses({ loopbackOnly: !!cert });
  // Windows erlaubt "alle Adressen" auch dann, wenn ein anderes Programm schon 127.0.0.1:Port belegt.
  // Zuerst prüfen wir deshalb localhost, damit ein zweites Dashboard nicht unbemerkt parallel läuft.
  if (!hosts.includes('127.0.0.1')) {
    const probe = http.createServer();
    await listenOn(probe, cfg.port, '127.0.0.1');
    await new Promise((r) => probe.close(r));
  }
  for (const host of hosts) {
    const server = http.createServer(app);
    await listenOn(server, cfg.port, host);
    live.main.push(server);
  }

  if (cert) {
    const httpsHosts = cfg.bind === 'local' ? ['127.0.0.1'] : netconf.bindAddresses();
    for (const host of httpsHosts) {
      if (host === '127.0.0.1' && httpsHosts.length > 1) continue; // 0.0.0.0 deckt es ab; bei "custom" ist 127.0.0.1 dabei
      try {
        const server = https.createServer({ key: cert.key, cert: cert.cert, minVersion: 'TLSv1.2' }, app);
        await listenOn(server, cfg.https.httpsPort, host);
        live.https.push(server);
      } catch (e) {
        live.errors.push(`HTTPS auf Port ${cfg.https.httpsPort}: ${e.code === 'EACCES' ? 'keine Berechtigung für diesen Port' : e.code === 'EADDRINUSE' ? 'Port schon belegt' : e.message}`);
        live.httpsActive = false;
      }
    }
  }
  if (cfg.https.enabled) {
    try { await ensureChallengePort(); } catch (e) { live.errors.push(e.message); }
  }
}

// Mehrere Neustarts gleichzeitig (z. B. Zertifikat geändert und Einstellung gespeichert) werden nacheinander ausgeführt
let chain = Promise.resolve();
function reload() {
  const run = chain.then(async () => { await stopAll(); await start(); });
  chain = run.catch(() => {});
  return run;
}

/** Alle erreichbaren Adressen, für die Anzeige im Dashboard. */
function urls() {
  const cfg = netconf.get();
  const out = [{ label: 'Dieser PC', url: `http://localhost:${cfg.port}`, kind: 'local' }];
  if (live.httpsActive) {
    const p = cfg.https.httpsPort === 443 ? '' : `:${cfg.https.httpsPort}`;
    out.push({ label: 'Mit HTTPS', url: `https://${cfg.https.domain}${p}`, kind: 'https' });
  } else if (cfg.bind === 'network') {
    for (const a of netconf.ownAddresses()) out.push({ label: `Im Netzwerk (${a.adapter})`, url: `http://${a.address}:${cfg.port}`, kind: 'network' });
  } else if (cfg.bind === 'custom') {
    for (const a of cfg.customBind) out.push({ label: 'Eigene Adresse', url: `http://${a}:${cfg.port}`, kind: 'network' });
  }
  return out;
}

const state = () => ({ httpsActive: live.httpsActive, port80: !!live.port80?.listening, errors: [...live.errors], listening: live.main.length });

certs.setHooks({
  ensureChallengePort,
  onCertChanged: () => { if (app) reload().catch((e) => console.error('Zugänge konnten nicht neu geladen werden:', e.message)); },
});

module.exports = { start, reload, stopAll, urls, state, ensureChallengePort };
