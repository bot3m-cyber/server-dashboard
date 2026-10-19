'use strict';
// Netzwerk-Einstellungen des Dashboards (Adresse, Port, Zugangspasswort, HTTPS).
// Gespeichert in data/network.json. Der Ordner data/ gehört nicht zum Programmcode (steht in .gitignore),
// ein Update von GitHub lässt die Datei deshalb unberührt. Neue Einstellungen aus Updates bekommen Standardwerte,
// bereits gespeicherte Werte werden nie überschrieben.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DATA_DIR } = require('./paths');
const { readJson, writeJsonAtomic, UserError } = require('./util');

const FILE = path.join(DATA_DIR, 'network.json');
const SCHEMA = 1;

function defaults() {
  return {
    schema: SCHEMA,
    bind: 'network', // local = nur dieser PC (127.0.0.1) | network = auch über die IP-Adresse dieses Rechners | custom = bestimmte Adressen
    customBind: [],
    port: 3000,
    accessPasswordHash: null, // optionales Zugangspasswort (gilt nur für Zugriffe von anderen Geräten)
    publicDomain: '', // Domain, unter der das Dashboard und die Server erreichbar sein sollen (für Einladungen, z. B. per E-Mail)
    https: {
      enabled: false,
      domain: '',
      email: '',
      staging: false, // Test-System von Let's Encrypt (Zertifikat wird vom Browser nicht anerkannt, aber ohne Limits)
      httpPort: 80,
      httpsPort: 443,
      redirect: true, // Aufrufe über HTTP von anderen Geräten auf HTTPS umleiten
    },
  };
}

let cache = null;
let lastCheck = 0;
let lastMtime = 0;

function merge(d, f) {
  const out = { ...d, ...f };
  out.https = { ...d.https, ...(f.https || {}) };
  if (!Array.isArray(out.customBind)) out.customBind = [];
  return out;
}

function load() {
  const f = readJson(FILE, {});
  const s = merge(defaults(), f);
  // Umgebungsvariablen haben Vorrang (bestehende Installationen und Tests bleiben unverändert)
  s.envLocked = [];
  if (process.env.PORT) { s.port = Number(process.env.PORT) || s.port; s.envLocked.push('port'); }
  if (process.env.BIND) {
    const b = process.env.BIND.trim();
    if (b === '127.0.0.1' || b === 'localhost') s.bind = 'local';
    else if (b === '0.0.0.0' || b === '::') s.bind = 'network';
    else { s.bind = 'custom'; s.customBind = b.split(',').map((x) => x.trim()).filter(Boolean); }
    s.envLocked.push('bind');
  }
  cache = s;
  try { lastMtime = fs.statSync(FILE).mtimeMs; } catch { lastMtime = 0; }
  lastCheck = Date.now();
  return s;
}

/** Gibt die Einstellungen zurück. Ändert ein anderes Programm die Datei (z. B. set-password.js), wird sie nach spätestens 2 Sekunden neu gelesen. */
function get() {
  if (!cache) return load();
  if (Date.now() - lastCheck > 2000) {
    lastCheck = Date.now();
    let m = 0;
    try { m = fs.statSync(FILE).mtimeMs; } catch { /* Datei fehlt */ }
    if (m !== lastMtime) return load();
  }
  return cache;
}

const IPV4 = /^(\d{1,3})(\.\d{1,3}){3}$/;
const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

function validate(patch) {
  const out = {};
  if ('bind' in patch) {
    if (!['local', 'network', 'custom'].includes(patch.bind)) throw new UserError('Unbekannte Einstellung für die Adresse.');
    out.bind = patch.bind;
  }
  if ('publicDomain' in patch) {
    const d = String(patch.publicDomain || '').trim().toLowerCase().replace(/^https?:[/][/]/, '').split('/')[0];
    if (d && !HOSTNAME.test(d)) throw new UserError('Bitte eine gültige Domain eintragen, z. B. server.meine-domain.de (ohne http:// und ohne Pfad).');
    out.publicDomain = d;
  }
  if ('customBind' in patch) {
    const list = (Array.isArray(patch.customBind) ? patch.customBind : String(patch.customBind || '').split(/[\s,;]+/)).map((x) => String(x).trim()).filter(Boolean);
    for (const a of list) if (!IPV4.test(a) || a.split('.').some((n) => Number(n) > 255)) throw new UserError(`„${a}“ ist keine gültige IPv4-Adresse.`);
    out.customBind = list;
  }
  if ('port' in patch) {
    const p = Number(patch.port);
    if (!Number.isInteger(p) || p < 1 || p > 65535) throw new UserError('Der Port muss eine Zahl zwischen 1 und 65535 sein.');
    out.port = p;
  }
  if ('https' in patch && patch.https && typeof patch.https === 'object') {
    const h = {};
    const src = patch.https;
    if ('domain' in src) {
      const d = String(src.domain || '').trim().toLowerCase();
      if (d && !HOSTNAME.test(d)) throw new UserError('Bitte eine gültige Domain eintragen, z. B. dashboard.meine-domain.de (ohne http:// und ohne Pfad).');
      h.domain = d;
    }
    if ('email' in src) {
      const m = String(src.email || '').trim();
      if (m && !/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(m)) throw new UserError('Bitte eine gültige E-Mail-Adresse angeben (Let’s Encrypt schickt dorthin Hinweise zum Ablauf).');
      h.email = m;
    }
    for (const k of ['enabled', 'staging', 'redirect']) if (k in src) h[k] = !!src[k];
    for (const k of ['httpPort', 'httpsPort']) {
      if (!(k in src)) continue;
      const p = Number(src[k]);
      if (!Number.isInteger(p) || p < 1 || p > 65535) throw new UserError('Ungültiger Port für HTTP/HTTPS.');
      h[k] = p;
    }
    out.https = h;
  }
  return out;
}

/** Speichert Änderungen. Gibt die neuen Einstellungen zurück. */
function save(patch) {
  const clean = validate(patch);
  const cur = readJson(FILE, {});
  const next = { ...cur, ...clean, schema: SCHEMA };
  if (clean.https) next.https = { ...(cur.https || {}), ...clean.https };
  if ('accessPasswordHash' in patch) next.accessPasswordHash = patch.accessPasswordHash || null;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  writeJsonAtomic(FILE, next);
  // Sicherungskopie der letzten Stände (bei versehentlichen Änderungen)
  try {
    const dir = path.join(DATA_DIR, 'config-backup');
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(FILE, path.join(dir, `network-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
    const old = fs.readdirSync(dir).filter((f) => f.startsWith('network-')).sort();
    for (const f of old.slice(0, Math.max(0, old.length - 10))) fs.unlinkSync(path.join(dir, f));
  } catch { /* Sicherung ist nur ein Zusatz */ }
  return load();
}

/** Die IPv4-Adressen dieses Rechners (ohne 127.x). */
function ownAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) out.push({ adapter: name, address: i.address });
    }
  }
  return out;
}

/** Adressen, an die der HTTP-Server gebunden wird. */
function bindAddresses(opts = {}) {
  const s = get();
  const loopbackOnly = !!opts.loopbackOnly;
  if (loopbackOnly || s.bind === 'local') return ['127.0.0.1'];
  if (s.bind === 'custom') return [...new Set(['127.0.0.1', ...s.customBind])];
  return ['0.0.0.0'];
}

/** Ob die Anfrage von diesem Rechner selbst kommt. */
function isLoopback(req) {
  const a = String(req.socket?.remoteAddress || '');
  const own = a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
  if (!own) return false;
  // Ein Reverse-Proxy auf demselben Rechner (Caddy, nginx) reicht fremde Anfragen von 127.0.0.1 weiter
  return !req.headers['x-forwarded-for'] && !req.headers['x-forwarded-host'] && !req.headers.forwarded;
}

/** Erlaubte Host-Namen (Schutz gegen DNS-Rebinding). Wird bei jeder Anfrage frisch ermittelt, damit neue IPs gleich gehen. */
function allowedHostnames(extra = []) {
  const set = new Set(['localhost', '127.0.0.1', '[::1]', ...extra.filter(Boolean).map((x) => String(x).toLowerCase())]);
  for (const a of ownAddresses()) set.add(a.address);
  try { set.add(os.hostname().toLowerCase()); } catch { /* egal */ }
  const s = get();
  if (s.https.domain) set.add(s.https.domain.toLowerCase());
  if (s.publicDomain) set.add(s.publicDomain.toLowerCase());
  for (const a of s.customBind) set.add(a);
  return set;
}

function hostnameOf(hostHeader) {
  const h = String(hostHeader || '').toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
  return h.split(':')[0];
}

/** Ist die Adresse eine private (Heimnetz, VPN, localhost)? Alles andere kommt aus dem Internet. */
function isPrivateAddress(addr) {
  let a = String(addr || '').replace(/^::ffff:/i, '').toLowerCase();
  if (a === '::1' || a.startsWith('fe80:') || a.startsWith('fc') || a.startsWith('fd')) return true;
  if (!IPV4.test(a)) return false;
  const [p, q] = a.split('.').map(Number);
  return p === 10 || p === 127 || (p === 192 && q === 168) || (p === 172 && q >= 16 && q <= 31) || (p === 169 && q === 254) || (p === 100 && q >= 64 && q <= 127);
}

/** Kommt die Anfrage aus dem Internet (und nicht vom eigenen Rechner oder aus einem privaten Netz)? */
function isPublicSource(req) {
  if (isLoopback(req)) return false;
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return !isPrivateAddress(xf || req.socket?.remoteAddress);
}

module.exports = { isPrivateAddress, isPublicSource, FILE, get, load, save, defaults, ownAddresses, bindAddresses, isLoopback, allowedHostnames, hostnameOf };
