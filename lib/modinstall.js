'use strict';
// Mods hinzufügen: JAR hochladen oder bei Modrinth installieren (inkl. benötigter Abhängigkeiten).
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { pipeline } = require('stream/promises');
const config = require('./config');
const mods = require('./mods');
const modrinth = require('./modrinth');
const { downloadVerified } = require('./download');
const { readZipEntryText } = require('./zip');
const { UserError, safeResolve, checkFileName, hashFile } = require('./util');

const MAX_UPLOAD = 500 * 1024 * 1024;

function mcVersion() {
  const cfg = config.get();
  const mc = cfg.mcVersion || cfg.pack?.minecraft;
  if (!mc) throw new UserError('Für diesen Server ist noch keine Minecraft-Version bekannt. Bitte zuerst die Einrichtung abschließen.');
  return mc;
}

/** Welche Modrinth-Loader zum Server-Typ passen (z. B. paper/spigot/bukkit). */
function loadersFor() {
  const t = require('./servertypes').TYPES[config.get().type];
  if (!t || !t.loaders.length) throw new UserError('Dieser Server-Typ (Vanilla) kann keine Mods oder Plugins laden.');
  return t.loaders;
}

/** Speichert eine hochgeladene JAR-Datei (Stream) im mods-Ordner. */
async function saveUpload(req, rawName) {
  const name = checkFileName(rawName, /\.jar$/i);
  const len = Number(req.headers['content-length']) || 0;
  if (len > MAX_UPLOAD) throw new UserError('Die Datei ist zu groß (mehr als 500 MB).', 413);
  await fsp.mkdir(mods.modsDir(), { recursive: true });
  const dest = safeResolve(mods.modsDir(), name);
  const tmp = `${dest}.part`;
  try {
    await pipeline(req, fs.createWriteStream(tmp));
    let toml = null;
    try {
      toml = await readZipEntryText(tmp, ['META-INF/neoforge.mods.toml', 'META-INF/mods.toml']);
    } catch {
      throw new UserError(`„${name}“ ist keine gültige JAR-Datei (beschädigt oder falsches Format).`);
    }
    await fsp.rm(`${dest}.disabled`, { force: true });
    await fsp.rename(tmp, dest);
    const warning = toml ? null : `„${name}“ enthält keine Mod-Beschreibung (mods.toml). Vielleicht ist es keine NeoForge-Mod. Wenn der Server nicht startet, hilft die Crash-Hilfe.`;
    return { file: name, warning };
  } finally {
    await fsp.rm(tmp, { force: true }).catch(() => {});
  }
}

async function installedProjectIds() {
  const dir = mods.modsDir();
  let names = [];
  try { names = await fsp.readdir(dir); } catch { /* noch kein Ordner */ }
  const hashes = [];
  for (const n of names) {
    if (!/\.jar(\.disabled)?$/i.test(n)) continue;
    hashes.push((await hashFile(path.join(dir, n), ['sha1'])).sha1);
  }
  const map = await modrinth.projectIdsBySha1(hashes).catch(() => ({}));
  return new Set(Object.values(map));
}

/**
 * Installiert Modrinth-Projekte (ID oder Slug) samt benötigter Abhängigkeiten.
 * Wer ausdrücklich installiert wird, wird von der Ausschlussliste genommen.
 */
async function installFromModrinth(ids, ctx) {
  const mc = mcVersion();
  const loaders = loadersFor();
  await fsp.mkdir(mods.modsDir(), { recursive: true });
  ctx.log('Prüfe, was schon vorhanden ist …');
  const have = await installedProjectIds();
  const queue = ids.map((id) => ({ id, root: true }));
  const done = new Set();
  const installed = [];
  while (queue.length) {
    const { id, root } = queue.shift();
    if (done.has(id) || done.size > 30) continue;
    done.add(id);
    ctx.progress(installed.length, installed.length + queue.length + 1, `Suche ${id} …`);
    const v = await modrinth.bestVersion(id, mc, loaders);
    if (!v) {
      if (root) throw new UserError(`Für Minecraft ${mc} gibt es bei Modrinth noch keine passende Version von „${id}“ (${[].concat(loaders)[0] || 'Loader'}). Bei ganz neuen Minecraft-Versionen dauert das oft einige Wochen. Wähle eine etwas ältere Version.`);
      ctx.log(`Hinweis: Für die Abhängigkeit ${id} gibt es keine passende Version. Bitte selbst prüfen.`);
      continue;
    }
    done.add(v.project_id);
    const file = v.files.find((f) => f.primary) || v.files[0];
    if (!file || !/\.jar$/i.test(file.filename)) throw new UserError(`Modrinth liefert keine JAR-Datei für „${id}“.`);
    if (have.has(v.project_id)) {
      ctx.log(`✓ ${v.name || id} ist schon installiert`);
    } else {
      ctx.log(`Lade ${file.filename} …`);
      const dest = safeResolve(mods.modsDir(), checkFileName(file.filename, /\.jar$/i));
      await fsp.rm(`${dest}.disabled`, { force: true });
      await downloadVerified([file.url], dest, { sha1: file.hashes.sha1, sha512: file.hashes.sha512, label: file.filename });
      have.add(v.project_id);
      installed.push(file.filename);
      ctx.log(`✓ ${file.filename}`);
      const ex = config.get().excludes;
      const hit = ex.filter((e) => mods.matchesExclude(file.filename, null, [e]));
      if (hit.length) {
        config.update({ excludes: ex.filter((e) => !hit.includes(e)) });
        ctx.log(`Von der Ausschlussliste genommen: ${hit.join(', ')}`);
      }
    }
    for (const d of v.dependencies || []) {
      if (d.dependency_type === 'required' && d.project_id && !done.has(d.project_id) && !have.has(d.project_id)) {
        queue.push({ id: d.project_id, root: false });
      }
    }
  }
  ctx.progress(1, 1, 'Fertig');
  ctx.log(installed.length ? `Fertig. ${installed.length} Datei(en) installiert. Gilt ab dem nächsten Serverstart.` : 'Alles war schon vorhanden.');
  return { installed };
}

/** Installiert mehrere Projekte nacheinander. Was es nicht gibt, wird übersprungen statt alles abzubrechen. */
async function installMany(ids, ctx) {
  const skipped = [];
  for (const id of ids) {
    try {
      await installFromModrinth([id], ctx);
    } catch (e) {
      skipped.push(id);
      ctx.log(`⚠ ${id} übersprungen: ${e.message}`);
    }
  }
  return { skipped };
}

module.exports = { saveUpload, installFromModrinth, installMany, installedProjectIds, mcVersion, loadersFor };
