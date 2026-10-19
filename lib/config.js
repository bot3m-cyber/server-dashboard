'use strict';
// Konfiguration mit mehreren Server-Profilen.
// Lokal: config.get() liefert das aktive Profil. Mehrbenutzer-Modus: das Profil, das zur Anfrage gehört
// (siehe context.js), so dass alle anderen Module unverändert mit "dem Server" arbeiten können.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readJson, writeJsonAtomic, safeResolve, UserError } = require('./util');
const { APP_DIR, DATA_DIR, SERVERS_DIR, DEFAULT_SERVER_DIR } = require('./paths');
const ctx = require('./context');
const hosted = require('./hosted');

const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const DEFAULT_EXCLUDES = ['mapdistancefix', 'Geyser', 'Floodgate'];

function profileDefaults() {
  return {
    id: null,
    ownerId: null, // Besitzer im Mehrbenutzer-Modus
    name: 'Mein Server',
    type: 'modpack', // modpack | neoforge | fabric | paper | purpur | vanilla
    mcVersion: null,
    loaderVersion: null, // NeoForge-/Fabric-Version bzw. Paper-Build
    jar: null, // Server-JAR bei Typen ohne NeoForge
    installed: false,
    javaMajor: 21,
    aikar: false,
    serverDir: null,
    port: null, // eigener Java-Port (nur Mehrbenutzer-Modus)
    bedrockPort: null, // eigener Bedrock-Port (UDP)
    javaPath: null,
    xmsGb: 2,
    xmxGb: 6,
    excludes: [...DEFAULT_EXCLUDES],
    skipClientOnly: true,
    autoBackupHours: 0,
    autoBackupKeep: 10,
    autoRestartOnCrash: false,
    autoStopMinutes: 0,
    schedules: [],
    webhookUrl: null,
    webhookEvents: { start: true, stop: true, crash: true, join: true },
    pack: null,
    packProjectId: null,
    installedPackKey: null,
    installedFiles: [],
    createdAt: Date.now(),
  };
}

let root = null; // { version: 2, activeId, cloudDir, servers: [] }

const newId = () => crypto.randomBytes(4).toString('hex');

function slug(name) {
  return String(name).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').slice(0, 40) || 'server';
}

function fill(p) {
  const d = profileDefaults();
  for (const k of Object.keys(d)) if (p[k] === undefined) p[k] = d[k];
  return p;
}

function save() {
  writeJsonAtomic(CONFIG_FILE, root);
}

function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const raw = readJson(CONFIG_FILE, null);
  if (raw && raw.version === 2 && Array.isArray(raw.servers) && raw.servers.length) {
    root = raw;
  } else if (raw && raw.serverDir) {
    // Migration der alten Einzel-Konfiguration
    const p = fill(Object.assign({}, raw, { id: newId(), name: raw.pack?.name || 'Mein Server', type: 'modpack' }));
    root = { version: 2, activeId: p.id, cloudDir: null, servers: [p] };
    const oldPack = path.join(DATA_DIR, 'pack');
    if (fs.existsSync(oldPack)) {
      fs.mkdirSync(path.join(DATA_DIR, 'packs'), { recursive: true });
      fs.renameSync(oldPack, packDir(p.id));
    }
  } else if (hosted.enabled()) {
    // Im Mehrbenutzer-Modus legt jeder Nutzer seine Server selbst an
    root = { version: 2, activeId: null, cloudDir: null, servers: [] };
  } else {
    const p = fill({ id: newId(), name: 'Mein Server', serverDir: DEFAULT_SERVER_DIR });
    root = { version: 2, activeId: p.id, cloudDir: null, servers: [p] };
  }
  root.servers.forEach(fill);
  if (root.servers.length && !root.servers.some((s) => s.id === root.activeId)) root.activeId = root.servers[0].id;
  save();
  return root.servers.length ? active() : null;
}

const ensure = () => { if (!root) load(); };
const active = () => root.servers.find((s) => s.id === root.activeId) || root.servers[0];

/** Das Profil für diese Anfrage (Mehrbenutzer) bzw. das aktive Profil (lokal). */
function resolve(id) {
  ensure();
  const sid = id ?? ctx.id();
  if (sid) {
    const p = root.servers.find((s) => s.id === sid);
    if (!p) throw new UserError('Server nicht gefunden.', 404);
    return p;
  }
  if (hosted.enabled()) throw new UserError('Es ist kein Server ausgewählt.', 400);
  return active();
}

function get(id) {
  return resolve(id);
}

function update(patch, id) {
  const p = resolve(id);
  Object.assign(p, patch);
  save();
  return p;
}

/** Pfad innerhalb des Server-Ordners (mit Schutz gegen Path Traversal). */
function serverPath(rel = '.', id) {
  return safeResolve(resolve(id).serverDir, rel);
}

/** Ordner für das entpackte Modpack des aktiven (oder angegebenen) Servers. */
function packDir(id) {
  ensure();
  return path.join(DATA_DIR, 'packs', id || resolve().id);
}

// ---------------------------------------------------------------- Mehrere Server

const list = () => { ensure(); return root.servers; };
const activeId = () => { ensure(); return root.activeId; };

/** Server, die dieser Benutzer sehen darf (Admins: alle). Lokal: alle. */
function listFor(user) {
  ensure();
  if (!hosted.enabled() || !user) return root.servers;
  return root.servers.filter((s) => s.ownerId === user.id); // auch Administratoren sehen hier nur ihre eigenen Server
}

function canAccess(user, p) {
  if (!hosted.enabled()) return true;
  return !!user && !!p && p.ownerId === user.id;
}

/** Nächster freier Port aus dem Bereich (Java: TCP, Bedrock: UDP). */
function allocatePort(kind) {
  ensure();
  const s = hosted.get();
  const [lo, hi] = kind === 'bedrockPort' ? s.bedrockPortRange : s.portRange;
  const used = new Set(root.servers.map((p) => p[kind]).filter(Boolean));
  for (let port = lo; port <= hi; port++) if (!used.has(port)) return port;
  throw new UserError('Auf diesem Server sind alle Ports vergeben. Bitte wende dich an den Betreiber.', 503);
}

function add(fields) {
  ensure();
  const p = fill(Object.assign({}, fields, { id: newId(), createdAt: Date.now() }));
  if (!p.serverDir) {
    const base = hosted.enabled() && p.ownerId ? path.join(SERVERS_DIR, p.ownerId) : SERVERS_DIR;
    let dir = path.join(base, slug(p.name));
    for (let i = 2; fs.existsSync(dir) || root.servers.some((s) => s.serverDir && path.resolve(s.serverDir).toLowerCase() === path.resolve(dir).toLowerCase()); i++) {
      dir = path.join(base, `${slug(p.name)}-${i}`);
    }
    p.serverDir = dir;
  }
  if (hosted.enabled()) {
    if (!p.port) p.port = allocatePort('port');
    if (!p.bedrockPort) p.bedrockPort = allocatePort('bedrockPort');
  }
  root.servers.push(p);
  if (!root.activeId) root.activeId = p.id;
  save();
  return p;
}

/** Umstellung vom lokalen Modus auf Mehrbenutzer: vorhandene Server gehören danach dem ersten Administrator. */
function assignUnownedTo(userId) {
  ensure();
  let n = 0;
  for (const p of root.servers) {
    if (p.ownerId) continue;
    p.ownerId = userId;
    if (hosted.enabled()) {
      if (!p.port) p.port = allocatePort('port');
      if (!p.bedrockPort) p.bedrockPort = allocatePort('bedrockPort');
    }
    n++;
  }
  if (n) save();
  return n;
}

function setActive(id) {
  ensure();
  if (!root.servers.some((s) => s.id === id)) return null;
  root.activeId = id;
  save();
  return active();
}

function remove(id) {
  ensure();
  root.servers = root.servers.filter((s) => s.id !== id);
  if (!root.servers.length && !hosted.enabled()) root.servers.push(fill({ id: newId(), name: 'Mein Server', serverDir: DEFAULT_SERVER_DIR }));
  if (root.servers.length && !root.servers.some((s) => s.id === root.activeId)) root.activeId = root.servers[0].id;
  if (!root.servers.length) root.activeId = null;
  save();
  fs.rmSync(packDir(id), { recursive: true, force: true });
}

/** Alle Server eines Benutzers entfernen (Benutzer gelöscht). Gibt die Ordner zurück. */
function removeOwnedBy(userId) {
  ensure();
  const mine = root.servers.filter((s) => s.ownerId === userId);
  for (const p of mine) remove(p.id);
  return mine;
}

/** Geheimnisse (API-Schlüssel): nur lokal gespeichert, nie in der Cloud-Sicherung. */
function getSecret(name) {
  ensure();
  return (root.secrets && root.secrets[name]) || null;
}

function setSecret(name, value) {
  ensure();
  root.secrets = root.secrets || {};
  if (value) root.secrets[name] = value; else delete root.secrets[name];
  save();
}

/** Einstellungen, die für alle Server gelten (Cloud-Ordner und Sync). */
function global() {
  ensure();
  return {
    cloudDir: root.cloudDir || null,
    cloudAutoMinutes: root.cloudAutoMinutes || 0,
    cloudWithBackups: !!root.cloudWithBackups,
    cloudLastSync: root.cloudLastSync || null,
  };
}

function setGlobal(patch) {
  ensure();
  for (const k of ['cloudDir', 'cloudAutoMinutes', 'cloudWithBackups', 'cloudLastSync']) if (k in patch) root[k] = patch[k];
  save();
}

module.exports = {
  APP_DIR, DATA_DIR, SERVERS_DIR, DEFAULT_EXCLUDES, load, get, update, serverPath, packDir,
  list, listFor, canAccess, allocatePort, assignUnownedTo, activeId, add, setActive, remove, removeOwnedBy, global, setGlobal, getSecret, setSecret, slug,
};
