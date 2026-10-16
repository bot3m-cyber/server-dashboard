'use strict';
// Mod-Ordner: Liste, aktivieren/deaktivieren (<name>.jar.disabled), Ausschlussliste.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const config = require('./config');
const { UserError, safeResolve, checkFileName, timestamp } = require('./util');
const { readZipEntryText } = require('./zip');

const infoCache = new Map();

/** Ordner mit den Erweiterungen: plugins/ bei Paper & Co., sonst mods/. */
function modsDir() {
  const t = require('./servertypes').TYPES[config.get().type];
  return config.serverPath(t && t.kind === 'plugins' ? 'plugins' : 'mods');
}

/** Passt ein Dateiname (oder Modrinth-Slug) zu einem Eintrag der Ausschlussliste? */
function matchesExclude(fileName, slug, excludes) {
  const f = String(fileName || '').toLowerCase();
  const s = String(slug || '').toLowerCase();
  return (excludes || []).some((e) => {
    const x = String(e).trim().toLowerCase();
    return x && (f.includes(x) || s === x);
  });
}

async function jarInfo(abs, st) {
  const c = infoCache.get(abs);
  if (c && c.mtime === st.mtimeMs && c.size === st.size) return c.info;
  let text = null;
  try {
    text = await readZipEntryText(abs, ['META-INF/neoforge.mods.toml', 'META-INF/mods.toml', 'fabric.mod.json', 'paper-plugin.yml', 'plugin.yml']);
  } catch { /* keine lesbare JAR */ }
  const info = { modIds: [], displayName: null };
  if (text && text.trimStart().startsWith('{')) {
    // Fabric: fabric.mod.json
    try {
      const j = JSON.parse(text);
      if (j.id) info.modIds.push(j.id);
      if (j.name) info.displayName = j.name;
    } catch { /* ungültiges JSON */ }
  } else if (text && /^\s*(name|main)\s*:/m.test(text)) {
    // Bukkit/Paper: plugin.yml
    const n = text.match(/^\s*name\s*:\s*["']?([^"'\r\n#]+?)["']?\s*$/m);
    if (n) { info.modIds.push(n[1].trim()); info.displayName = n[1].trim(); }
  } else if (text) {
    // Nur [[mods]]-Abschnitte zählen; [[dependencies.x]] enthält ebenfalls "modId"
    let section = '';
    for (const line of text.split(/\r?\n/)) {
      const h = line.match(/^\s*\[\[?\s*([^\]\s]+)\s*\]\]?/);
      if (h) { section = h[1]; continue; }
      if (section !== 'mods') continue;
      const id = line.match(/^\s*modId\s*=\s*["']([^"']+)["']/);
      if (id) info.modIds.push(id[1]);
      const d = line.match(/^\s*displayName\s*=\s*["']([^"']+)["']/);
      if (d && !info.displayName) info.displayName = d[1];
    }
  }
  infoCache.set(abs, { mtime: st.mtimeMs, size: st.size, info });
  return info;
}

async function list() {
  const dir = modsDir();
  let names;
  try { names = await fsp.readdir(dir); } catch { return []; }
  const map = new Map();
  for (const n of names) {
    let file;
    let enabled;
    if (/\.jar$/i.test(n)) { file = n; enabled = true; } else if (/\.jar\.disabled$/i.test(n)) { file = n.slice(0, -9); enabled = false; } else continue;
    const abs = path.join(dir, n);
    let st;
    try { st = await fsp.stat(abs); } catch { continue; }
    if (!st.isFile()) continue;
    if (map.has(file.toLowerCase()) && !enabled) continue; // .jar hat Vorrang
    const info = await jarInfo(abs, st);
    map.set(file.toLowerCase(), { file, enabled, size: st.size, modIds: info.modIds, name: info.displayName });
  }
  const excludes = config.get().excludes;
  return [...map.values()]
    .map((m) => ({ ...m, excluded: matchesExclude(m.file, null, excludes) }))
    .sort((a, b) => a.file.toLowerCase().localeCompare(b.file.toLowerCase()));
}

function renameError(e) {
  if (['EBUSY', 'EPERM', 'EACCES'].includes(e.code)) {
    return new UserError('Die Datei ist gerade in Benutzung. Bitte zuerst den Server stoppen.', 409);
  }
  return e;
}

async function setEnabled(file, enabled) {
  checkFileName(file, /\.jar$/i);
  const dir = modsDir();
  const jar = safeResolve(dir, file);
  const dis = jar + '.disabled';
  try {
    if (enabled) {
      if (fs.existsSync(jar)) return;
      if (!fs.existsSync(dis)) throw new UserError(`Mod nicht gefunden: ${file}`, 404);
      await fsp.rename(dis, jar);
    } else {
      if (!fs.existsSync(jar)) {
        if (fs.existsSync(dis)) return;
        throw new UserError(`Mod nicht gefunden: ${file}`, 404);
      }
      await fsp.rm(dis, { force: true });
      await fsp.rename(jar, dis);
    }
  } catch (e) {
    throw renameError(e);
  }
}

/** Deaktiviert alle aktiven Mods, die auf der Ausschlussliste stehen. */
async function applyExcludes() {
  const changed = [];
  for (const m of await list()) {
    if (m.enabled && m.excluded) {
      await setEnabled(m.file, false);
      changed.push(m.file);
    }
  }
  return changed;
}

/** Sucht die JAR-Datei zu einer Mod-ID (z. B. aus einem Crash-Report). */
async function findByModId(modId) {
  if (!modId) return null;
  const id = modId.toLowerCase();
  return (await list()).find((m) => m.modIds.some((x) => x.toLowerCase() === id)) || null;
}

/** Findet eine Mod über den Dateinamen (aktiv oder deaktiviert). */
async function findByFile(fileName) {
  if (!fileName) return null;
  const f = fileName.toLowerCase().replace(/\.disabled$/, '');
  return (await list()).find((m) => m.file.toLowerCase() === f) || null;
}

/** Verschiebt Mods in <mods|plugins>_old/geloescht/<Zeitstempel> (nicht endgültig gelöscht). */
async function remove(files) {
  if (!Array.isArray(files) || !files.length) throw new UserError('Bitte mindestens eine Datei auswählen.');
  const dir = modsDir();
  const trash = path.join(config.get().serverDir, `${path.basename(dir)}_old`, 'geloescht', timestamp());
  let n = 0;
  for (const f of files.slice(0, 500)) {
    checkFileName(f, /\.jar$/i);
    const jar = safeResolve(dir, f);
    const src = fs.existsSync(jar) ? jar : fs.existsSync(`${jar}.disabled`) ? `${jar}.disabled` : null;
    if (!src) continue;
    await fsp.mkdir(trash, { recursive: true });
    try {
      await fsp.rename(src, path.join(trash, path.basename(src)));
    } catch (e) {
      throw renameError(e);
    }
    n++;
  }
  return { removed: n, trash: path.relative(config.get().serverDir, trash).replace(/\\/g, '/') };
}

module.exports = { list, setEnabled, remove, applyExcludes, matchesExclude, findByModId, findByFile, modsDir };
