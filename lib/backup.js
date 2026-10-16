'use strict';
// Welt-Backups als ZIP in <Server-Ordner>/backups.
const fs = require('fs');
const fsp = fs.promises;
const config = require('./config');
const properties = require('./properties');
const { UserError, safeResolve, checkFileName, timestamp, formatBytes } = require('./util');
const { createZip, extractZip } = require('./zip');

function backupsDir() {
  return config.serverPath('backups');
}

function worldName() {
  const n = (properties.get('level-name', 'world') || 'world').trim() || 'world';
  config.serverPath(n); // Schutz: level-name darf nicht aus dem Server-Ordner zeigen
  return n;
}

async function list() {
  const dir = backupsDir();
  let names;
  try { names = await fsp.readdir(dir); } catch { return []; }
  const out = [];
  for (const n of names) {
    if (!/\.zip$/i.test(n)) continue;
    const st = await fsp.stat(safeResolve(dir, n)).catch(() => null);
    if (st && st.isFile()) out.push({ name: n, size: st.size, time: st.mtimeMs });
  }
  return out.sort((a, b) => b.time - a.time);
}

/** Welt-Ordner dieses Servers: Paper/Purpur legen Nether und End in eigene Ordner. */
function worldDirs() {
  const wn = worldName();
  return [wn, `${wn}_nether`, `${wn}_the_end`].filter((n) => fs.existsSync(config.serverPath(n)));
}

async function create(ctx, mc, label = '') {
  const wn = worldName();
  const wdir = config.serverPath(wn);
  if (!fs.existsSync(wdir)) {
    throw new UserError(`Der Welt-Ordner „${wn}“ existiert noch nicht. Starte den Server einmal, damit eine Welt erzeugt wird.`, 404);
  }
  if (mc.isRunning() && mc.state !== 'läuft') throw new UserError('Der Server startet oder stoppt gerade. Bitte kurz warten.', 409);
  await fsp.mkdir(backupsDir(), { recursive: true });
  const safeWorld = wn.replace(/[^\w-]+/g, '_');
  const name = `${safeWorld}-${label ? `${label}-` : ''}${timestamp()}.zip`;
  const out = safeResolve(backupsDir(), name);

  let paused = false;
  if (mc.isRunning()) {
    ctx.log('Der Server speichert die Welt …');
    mc.command('save-off');
    paused = true;
    const saved = mc.waitForLine(/Saved the game/, 120000);
    mc.command('save-all flush');
    try { await saved; } catch { ctx.log('Hinweis: Keine Bestätigung vom Server erhalten, sichere trotzdem.'); }
  }
  try {
    const dirs = worldDirs();
    ctx.log(`Packe ${dirs.map((d) => `„${d}“`).join(', ')} nach backups/${name} …`);
    const size = await createZip(dirs.map((d) => ({ dir: config.serverPath(d), root: d })), out, (d, t) => ctx.progress(d, t, `${formatBytes(d)} von ${formatBytes(t)}`));
    ctx.log(`Fertig: ${name} (${formatBytes(size)})`);
    return { name, size };
  } finally {
    if (paused && mc.isRunning()) mc.command('save-on');
  }
}

async function restore(ctx, mc, name) {
  checkFileName(name, /\.zip$/i);
  if (mc.isRunning()) throw new UserError('Bitte zuerst den Server stoppen. Wiederherstellen geht nur bei ausgeschaltetem Server.', 409);
  const file = safeResolve(backupsDir(), name);
  if (!fs.existsSync(file)) throw new UserError('Backup nicht gefunden.', 404);
  const wn = worldName();
  const allowed = new Set([wn, `${wn}_nether`, `${wn}_the_end`]);
  if (worldDirs().length) {
    ctx.log('Sichere zur Sicherheit erst die aktuelle Welt …');
    await create(ctx, mc, 'vor-wiederherstellung');
    for (const d of worldDirs()) await fsp.rm(config.serverPath(d), { recursive: true, force: true });
  }
  ctx.log(`Stelle ${name} wieder her …`);
  await extractZip(file, (entryName) => {
    const first = entryName.split('/')[0];
    if (!allowed.has(first)) return null; // nur Welt-Ordner wiederherstellen
    return safeResolve(config.get().serverDir, entryName);
  }, (d, t) => ctx.progress(d, t, `Datei ${d} von ${t}`));
  ctx.log('Die Welt wurde wiederhergestellt.');
  return { name };
}

async function remove(name) {
  checkFileName(name, /\.zip$/i);
  const file = safeResolve(backupsDir(), name);
  if (!fs.existsSync(file)) throw new UserError('Backup nicht gefunden.', 404);
  await fsp.rm(file);
}

/** Löscht automatische Backups (…-auto-…), die über die gewünschte Anzahl hinausgehen. */
async function pruneAuto(keep) {
  const autos = (await list()).filter((b) => /-auto-\d{4}-/.test(b.name));
  for (const old of autos.slice(Math.max(1, keep))) await remove(old.name).catch(() => {});
}

module.exports = { list, create, restore, remove, worldName, pruneAuto };
