'use strict';
// Let’s-Encrypt-Zertifikat: erzeugen (ACME, HTTP-Bestätigung über Port 80), ablesen und automatisch erneuern.
// Dateien liegen in data/https/ (Schlüssel nur für den Besitzer lesbar). Nichts davon gehört ins Repository.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./paths');
const netconf = require('./netconf');
const { UserError, readJson, writeJsonAtomic } = require('./util');

const DIR = path.join(DATA_DIR, 'https');
const META = path.join(DIR, 'cert.json');
const CERT = path.join(DIR, 'fullchain.pem');
const KEY = path.join(DIR, 'privkey.pem');
const RENEW_BEFORE_DAYS = 30;

/** token -> keyAuthorization, wird vom HTTP-Server auf Port 80 beantwortet */
const challenges = new Map();

let busy = false;
let hooks = { ensureChallengePort: async () => {}, onCertChanged: () => {} };
const setHooks = (h) => { hooks = { ...hooks, ...h }; };

function readMeta() { return readJson(META, {}); }

/** Liest das aktuelle Zertifikat (oder null). */
function info() {
  try {
    const pem = fs.readFileSync(CERT, 'utf8');
    const x = new crypto.X509Certificate(pem);
    const validTo = new Date(x.validTo);
    return {
      subject: x.subject.replace(/^CN=/, ''), issuer: x.issuer.replace(/\n/g, ', '), validFrom: new Date(x.validFrom).toISOString(), validTo: validTo.toISOString(),
      daysLeft: Math.floor((validTo.getTime() - Date.now()) / 86400e3), names: (x.subjectAltName || '').replace(/DNS:/g, '').split(', ').filter(Boolean),
    };
  } catch {
    return null;
  }
}

function load() {
  try {
    return { cert: fs.readFileSync(CERT), key: fs.readFileSync(KEY) };
  } catch {
    return null;
  }
}

/** Gilt das Zertifikat für die eingestellte Domain und ist es noch nicht abgelaufen? */
function usable() {
  const i = info();
  const s = netconf.get().https;
  return !!(i && s.domain && i.names.includes(s.domain) && i.daysLeft >= 0);
}

function status() {
  const meta = readMeta();
  const i = info();
  const s = netconf.get().https;
  return {
    exists: !!i, ...(i || {}), staging: !!meta.staging, lastError: meta.lastError || null, lastIssuedAt: meta.lastIssuedAt || null,
    working: busy, domainMatches: !!(i && s.domain && i.names.includes(s.domain)),
    renewBeforeDays: RENEW_BEFORE_DAYS, browserTrusted: !!i && !meta.staging,
  };
}

function writeSecure(file, data) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(file, data, { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* unter Windows ohne Wirkung */ }
}

/** Holt ein neues Zertifikat. Dauert meist 10 bis 40 Sekunden. */
async function issue({ log = () => {} } = {}) {
  const s = netconf.get().https;
  if (!s.domain) throw new UserError('Bitte zuerst die Domain eintragen.');
  if (!s.email) throw new UserError('Bitte eine E-Mail-Adresse eintragen. Let’s Encrypt schickt dorthin Hinweise, wenn die Erneuerung nicht klappt.');
  if (netconf.get().bind === 'local') throw new UserError('Das Dashboard hört nur auf diesem PC. Stelle die Adresse auf „Im Netzwerk erreichbar“, damit Let’s Encrypt die Domain prüfen kann.');
  if (busy) throw new UserError('Es läuft schon eine Zertifikats-Anfrage. Bitte einen Moment warten.', 409);
  busy = true;
  const meta = readMeta();
  try {
    const acme = require('acme-client');
    await hooks.ensureChallengePort(); // Port 80 muss erreichbar sein (wirft eine verständliche Meldung, wenn nicht)
    const staging = !!s.staging;
    const accountFile = path.join(DIR, staging ? 'account-staging.key' : 'account.key');
    let accountKey;
    try { accountKey = fs.readFileSync(accountFile); } catch { accountKey = await acme.crypto.createPrivateKey(); writeSecure(accountFile, accountKey); }
    const client = new acme.Client({ directoryUrl: staging ? acme.directory.letsencrypt.staging : acme.directory.letsencrypt.production, accountKey });
    const [key, csr] = await acme.crypto.createCsr({ commonName: s.domain });
    log(`Fordere Zertifikat für ${s.domain} an${staging ? ' (Test-System)' : ''} …`);
    const cert = await client.auto({
      csr, email: s.email, termsOfServiceAgreed: true, challengePriority: ['http-01'],
      challengeCreateFn: async (_authz, challenge, keyAuthorization) => { challenges.set(challenge.token, keyAuthorization); },
      challengeRemoveFn: async (_authz, challenge) => { challenges.delete(challenge.token); },
    });
    writeSecure(KEY, key);
    writeSecure(CERT, cert);
    writeJsonAtomic(META, { ...meta, staging, domain: s.domain, lastIssuedAt: new Date().toISOString(), lastError: null });
    log('✓ Zertifikat gespeichert.');
    hooks.onCertChanged();
    return status();
  } catch (e) {
    const msg = explain(e, s.domain);
    writeJsonAtomic(META, { ...meta, lastError: msg, lastErrorAt: new Date().toISOString() });
    throw e instanceof UserError ? e : new UserError(msg, 502);
  } finally {
    busy = false;
    challenges.clear();
  }
}

/** Übersetzt typische ACME-Fehler in verständliches Deutsch. */
function explain(e, domain) {
  if (e instanceof UserError) return e.message;
  const m = String(e?.message || e);
  if (/EACCES/.test(m)) return 'Port 80 darf unter diesem Benutzer nicht geöffnet werden. Unter Linux: Dashboard mit der Berechtigung für niedrige Ports starten (siehe DEPLOY.md).';
  if (/EADDRINUSE/.test(m)) return 'Port 80 ist schon belegt (z. B. von einem anderen Webserver). Beende ihn oder stelle HTTP-Port und Proxy passend ein.';
  if (/rateLimited|rate limit/i.test(m)) return 'Let’s Encrypt hat für diese Domain zu viele Anfragen bekommen. Bitte später erneut versuchen oder zum Testen das Test-System einschalten.';
  if (/NXDOMAIN|no valid A|DNS problem|Fetching http|Timeout during connect|Connection refused|unauthorized/i.test(m)) {
    return `Let’s Encrypt konnte ${domain} nicht über Port 80 erreichen. Prüfe: 1) Die Domain zeigt per A-Record auf die öffentliche IP dieses Rechners. 2) Port 80 ist in Router und Firewall freigegeben und kommt hier an. (Meldung: ${m.slice(0, 200)})`;
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN/.test(m)) return 'Let’s Encrypt ist von hier aus nicht erreichbar. Bitte die Internetverbindung prüfen.';
  return `Zertifikat konnte nicht erstellt werden: ${m.slice(0, 300)}`;
}

/** Entfernt Zertifikat und Schlüssel (Konto-Schlüssel bleibt erhalten). */
function remove() {
  for (const f of [CERT, KEY, META]) { try { fs.unlinkSync(f); } catch { /* war nicht da */ } }
  hooks.onCertChanged();
}

let timer = null;
/** Prüft zweimal täglich, ob das Zertifikat bald abläuft, und erneuert es dann von selbst. */
function startRenewal(log = console.log) {
  clearInterval(timer);
  const check = async () => {
    const s = netconf.get().https;
    if (!s.enabled || !s.domain || busy) return;
    const i = info();
    // Nur ein vorhandenes Zertifikat für diese Domain wird von selbst erneuert. Ein erstes oder neues Zertifikat gibt es nur per Knopfdruck.
    if (!i || !i.names.includes(s.domain) || i.daysLeft > RENEW_BEFORE_DAYS) return;
    try {
      log(`Zertifikat für ${s.domain} wird erneuert …`);
      await issue({ log });
    } catch (e) {
      log(`Zertifikat konnte nicht erneuert werden: ${e.message}`);
    }
  };
  timer = setInterval(check, 12 * 3600e3);
  timer.unref();
  setTimeout(check, 60e3).unref();
}

module.exports = { challenges, status, info, load, usable, issue, remove, startRenewal, setHooks, DIR };
