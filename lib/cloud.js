'use strict';
// Cloud-Sync über einen synchronisierten Ordner (OneDrive, Google Drive, Dropbox …).
// Das Dashboard legt dort pro Server Einstellungen, Konfigurationsdateien, Whitelist/OPs und
// auf Wunsch das neueste Welt-Backup ab. Es verbindet sich selbst mit keinem Cloud-Dienst.
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const config = require('./config');
const { UserError, safeResolve, writeJsonAtomic, readJson, formatBytes } = require('./util');

const SUB = 'MinecraftDashboard';
const ROOT_FILES = ['server.properties', 'whitelist.json', 'ops.json', 'banned-players.json', 'banned-ips.json', 'eula.txt', 'bukkit.yml', 'spigot.yml', 'server-icon.png'];
const CONFIG_DIRS = ['config', 'defaultconfigs', 'kubejs', 'plugins'];
const TEXT_EXT = /\.(json5?|ya?ml|toml|properties|txt|cfg|conf|ini|js|zs|png)$/i;
const SKIP_DIRS = new Set(['logs', 'cache', 'dynmap', 'bluemap', 'tiles', 'web', 'libraries', 'versions', 'crash-reports', 'backups', 'world', 'node_modules', 'updater']);
const MAX_FILE = 3 * 1024 * 1024;

function candidates() {
  const e = process.env;
  const home = os.homedir();
  const list = [e.OneDrive, e.OneDriveConsumer, e.OneDriveCommercial, path.join(home, 'OneDrive'), path.join(home, 'Dropbox'),
    path.join(home, 'Google Drive'), 'G:\\My Drive', 'G:\\Meine Ablage', path.join(home, 'iCloudDrive'), path.join(home, 'Nextcloud')];
  const seen = new Set();
  return list.filter(Boolean).filter((p) => {
    const k = path.resolve(p).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
  }).map((p) => path.resolve(p));
}

function rootDir(create = false) {
  const dir = config.global().cloudDir;
  if (!dir) throw new UserError('Es ist noch kein Cloud-Ordner gewählt.');
  if (!fs.existsSync(dir)) throw new UserError(`Der Cloud-Ordner ist nicht erreichbar: ${dir}. Ist die Cloud-Software gestartet und das Laufwerk verbunden?`);
  const r = path.join(dir, SUB);
  if (create) fs.mkdirSync(r, { recursive: true });
  return r;
}

function setFolder(p) {
  if (p == null || p === '') { config.setGlobal({ cloudDir: null }); return; }
  const raw = String(p).trim().replace(/^"|"$/g, '');
  if (!path.isAbsolute(raw)) throw new UserError('Bitte den vollständigen Pfad angeben, z. B. C:\\Users\\Name\\OneDrive');
  const abs = path.resolve(raw);
  let st;
  try { st = fs.statSync(abs); } catch { throw new UserError(`Ordner nicht gefunden: ${abs}`, 404); }
  if (!st.isDirectory()) throw new UserError('Das ist kein Ordner.');
  const rel = path.relative(config.APP_DIR, abs);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) throw new UserError('Der Cloud-Ordner darf nicht im Dashboard-Ordner liegen.');
  try { fs.accessSync(abs, fs.constants.W_OK); } catch { throw new UserError('In diesen Ordner darf nicht geschrieben werden.'); }
  config.setGlobal({ cloudDir: abs });
}

async function copyFile(src, dest) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.copyFile(src, dest);
}

/** Kopiert einen Ordner rekursiv. `filter(name, isDir)` entscheidet, was mitkommt. */
async function copyTree(src, dest, filter, depth = 0, stats = { files: 0, bytes: 0 }) {
  if (depth > 6) return stats;
  let entries;
  try { entries = await fsp.readdir(src, { withFileTypes: true }); } catch { return stats; }
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) {
      if (filter(e.name, true)) await copyTree(s, d, filter, depth + 1, stats);
    } else if (e.isFile() && filter(e.name, false)) {
      const st = await fsp.stat(s).catch(() => null);
      if (!st || st.size > MAX_FILE) continue;
      await copyFile(s, d);
      stats.files++;
      stats.bytes += st.size;
    }
  }
  return stats;
}

const folderOf = (p) => `${config.slug(p.name)}-${p.id}`;

/** Sichert ein Server-Profil in die Cloud. */
async function pushServer(p, ctx, withBackup) {
  const root = rootDir(true);
  const dest = safeResolve(root, folderOf(p));
  await fsp.mkdir(dest, { recursive: true });
  const profile = JSON.parse(JSON.stringify(p));
  delete profile.webhookUrl; // geheime Adresse bleibt auf diesem PC
  delete profile.serverDir;
  profile.exportedAt = Date.now();
  profile.machine = os.hostname();
  writeJsonAtomic(path.join(dest, 'profile.json'), profile);
  let files = 0;
  let bytes = 0;
  const base = p.serverDir;
  if (base && fs.existsSync(base)) {
    for (const f of ROOT_FILES) {
      const src = safeResolve(base, f);
      if (fs.existsSync(src)) { await copyFile(src, path.join(dest, 'files', f)); files++; }
    }
    for (const d of CONFIG_DIRS) {
      const s = await copyTree(safeResolve(base, d), path.join(dest, 'files', d), (name, isDir) => (isDir ? !SKIP_DIRS.has(name.toLowerCase()) : TEXT_EXT.test(name)));
      files += s.files;
      bytes += s.bytes;
    }
  }
  if (p.type === 'modpack') {
    const s = await copyTree(config.packDir(p.id), path.join(dest, 'pack'), () => true, 0, { files: 0, bytes: 0 });
    files += s.files;
    bytes += s.bytes;
  }
  let backupName = null;
  if (withBackup && base) {
    const bdir = path.join(base, 'backups');
    let zips = [];
    try { zips = (await fsp.readdir(bdir)).filter((n) => /\.zip$/i.test(n)); } catch { /* keine Backups */ }
    const withTime = await Promise.all(zips.map(async (n) => ({ n, t: (await fsp.stat(path.join(bdir, n))).mtimeMs })));
    const newest = withTime.sort((a, b) => b.t - a.t)[0];
    if (newest) {
      const target = path.join(dest, 'backups', newest.n);
      const have = await fsp.stat(target).catch(() => null);
      const size = (await fsp.stat(path.join(bdir, newest.n))).size;
      if (!have || have.size !== size) {
        ctx.log(`Kopiere Welt-Backup ${newest.n} (${formatBytes(size)}) …`);
        // nur das neueste Backup behalten, ältere Cloud-Kopien entfernen
        await fsp.rm(path.join(dest, 'backups'), { recursive: true, force: true });
        await copyFile(path.join(bdir, newest.n), target);
      }
      backupName = newest.n;
    }
  }
  ctx.log(`✓ ${p.name}: ${files} Dateien${backupName ? `, Backup ${backupName}` : ''}`);
  return { folder: folderOf(p), files, bytes, backup: backupName };
}

async function push(ctx, { all = true, withBackups = false } = {}) {
  const targets = all ? config.list() : [config.get()];
  const out = [];
  for (const p of targets) out.push(await pushServer(p, ctx, withBackups));
  config.setGlobal({ cloudLastSync: Date.now() });
  ctx.log(`Fertig. ${out.length} Server in der Cloud gesichert.`);
  return out;
}

async function list() {
  let root;
  try { root = rootDir(false); } catch { return []; }
  let dirs = [];
  try { dirs = await fsp.readdir(root, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const prof = readJson(path.join(root, d.name, 'profile.json'), null);
    if (!prof) continue;
    let backup = null;
    try { const z = (await fsp.readdir(path.join(root, d.name, 'backups'))).find((n) => /\.zip$/i.test(n)); backup = z || null; } catch { /* keins */ }
    out.push({
      folder: d.name, name: prof.name, type: prof.type, mcVersion: prof.mcVersion || prof.pack?.minecraft || null,
      packName: prof.pack?.name || null, exportedAt: prof.exportedAt, machine: prof.machine, backup,
      local: config.list().some((p) => p.id === prof.id),
    });
  }
  return out.sort((a, b) => (b.exportedAt || 0) - (a.exportedAt || 0));
}

/** Holt einen Server aus der Cloud als neues Profil auf diesen PC. */
async function pull(ctx, folder) {
  const root = rootDir(false);
  if (typeof folder !== 'string' || folder !== path.basename(folder)) throw new UserError('Ungültiger Ordnername.');
  const src = safeResolve(root, folder);
  const prof = readJson(path.join(src, 'profile.json'), null);
  if (!prof) throw new UserError('In diesem Cloud-Ordner liegt kein Server.', 404);
  delete prof.id;
  delete prof.exportedAt;
  delete prof.machine;
  Object.assign(prof, { installed: false, installedPackKey: null, installedFiles: [], serverDir: null, webhookUrl: null });
  prof.name = `${prof.name} (aus Cloud)`;
  const p = config.add(prof);
  ctx.log(`Neuer Server „${p.name}“ in ${p.serverDir}`);
  await fsp.mkdir(p.serverDir, { recursive: true });
  const filesDir = path.join(src, 'files');
  const stats = await copyTree(filesDir, p.serverDir, () => true, 0, { files: 0, bytes: 0 });
  for (const f of ROOT_FILES) {
    const s = path.join(filesDir, f);
    if (fs.existsSync(s)) await copyFile(s, safeResolve(p.serverDir, f));
  }
  if (fs.existsSync(path.join(src, 'pack'))) await copyTree(path.join(src, 'pack'), config.packDir(p.id), () => true);
  const bdir = path.join(src, 'backups');
  if (fs.existsSync(bdir)) {
    for (const n of await fsp.readdir(bdir)) if (/\.zip$/i.test(n)) await copyFile(path.join(bdir, n), safeResolve(path.join(p.serverDir, 'backups'), n));
  }
  fs.writeFileSync(path.join(p.serverDir, '.server-dashboard'), 'Dieser Ordner wird vom Minecraft Server-Dashboard verwaltet.\n');
  ctx.log(`✓ ${stats.files} Dateien wiederhergestellt. Jetzt unter „Meine Server“ öffnen und die Einrichtung abschließen.`);
  return { id: p.id };
}

async function status() {
  const g = config.global();
  let reachable = false;
  if (g.cloudDir) { try { reachable = fs.statSync(g.cloudDir).isDirectory(); } catch { /* nicht erreichbar */ } }
  return { ...g, reachable, candidates: candidates(), cloudServers: g.cloudDir && reachable ? await list() : [], sub: SUB };
}

module.exports = { status, setFolder, push, pull, list, candidates };
