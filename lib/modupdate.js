'use strict';
// Updates für installierte Mods/Plugins über Modrinth prüfen und einspielen.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const config = require('./config');
const mods = require('./mods');
const modmeta = require('./modmeta');
const { downloadVerified } = require('./download');
const { UA } = require('./download');
const { UserError, safeResolve, checkFileName, netError, timestamp } = require('./util');

async function latestForHashes(hashes, mc, loaders) {
  let res;
  try {
    res = await fetch('https://api.modrinth.com/v2/version_files/update', {
      method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ hashes, algorithm: 'sha1', loaders, game_versions: [mc] }), signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    throw netError(e, 'Modrinth');
  }
  if (!res.ok) throw new UserError(`Modrinth antwortet mit Fehler ${res.status}.`, 502);
  return res.json();
}

function context() {
  const cfg = config.get();
  const t = require('./servertypes').TYPES[cfg.type];
  const mc = cfg.mcVersion || cfg.pack?.minecraft;
  if (!mc || !t || !t.loaders.length) throw new UserError('Für diesen Server gibt es keine Updates über Modrinth.');
  return { mc, loaders: t.loaders };
}

/** Liste der verfügbaren Updates (nur aktive Dateien). */
async function check() {
  const { mc, loaders } = context();
  const active = new Set((await mods.list()).filter((m) => m.enabled).map((m) => m.file.toLowerCase()));
  const jars = (await modmeta.jarHashes()).filter((j) => active.has(j.file.toLowerCase()));
  if (!jars.length) return [];
  const bySha = {};
  for (const j of jars) bySha[j.sha1] = j;
  const latest = {};
  const hashes = Object.keys(bySha);
  for (let i = 0; i < hashes.length; i += 100) Object.assign(latest, await latestForHashes(hashes.slice(i, i + 100), mc, loaders));
  await modmeta.refresh();
  const info = await modmeta.forFiles();
  const out = [];
  for (const [sha, v] of Object.entries(latest)) {
    const f = v.files.find((x) => x.primary) || v.files[0];
    if (!f || f.hashes.sha1 === sha || !/\.jar$/i.test(f.filename)) continue;
    const j = bySha[sha];
    if (!j) continue;
    out.push({
      file: j.file, title: info[j.file.toLowerCase()]?.title || null, newName: f.filename, newVersion: v.version_number,
      type: v.version_type, url: f.url, sha512: f.hashes.sha512, size: f.size,
    });
  }
  return out.sort((a, b) => (a.title || a.file).localeCompare(b.title || b.file));
}

/** Spielt die gewählten Updates ein. Die alten Dateien werden aufgehoben (mods_old / plugins_old). */
async function apply(ctx, files) {
  const wanted = new Set((files || []).map(String));
  if (!wanted.size) throw new UserError('Bitte mindestens ein Update auswählen.');
  const updates = (await check()).filter((u) => wanted.has(u.file));
  if (!updates.length) throw new UserError('Für die gewählten Dateien gibt es kein Update (mehr).');
  const dir = mods.modsDir();
  const oldDir = path.join(config.get().serverDir, `${path.basename(dir)}_old`, timestamp());
  await fsp.mkdir(oldDir, { recursive: true });
  let done = 0;
  for (const u of updates) {
    ctx.progress(done, updates.length, `${u.title || u.file}`);
    ctx.log(`Lade ${u.newName} …`);
    const dest = safeResolve(dir, checkFileName(u.newName, /\.jar$/i));
    const tmpName = `${u.newName}.new`;
    const tmp = safeResolve(dir, tmpName);
    await downloadVerified([u.url], tmp, { sha512: u.sha512, label: u.newName });
    await fsp.rename(path.join(dir, u.file), path.join(oldDir, u.file));
    await fsp.rename(tmp, dest);
    ctx.log(`✓ ${u.file} → ${u.newName}`);
    done++;
  }
  ctx.progress(done, updates.length, 'Fertig');
  ctx.log(`${done} Update(s) eingespielt. Die alten Dateien liegen in ${path.basename(path.dirname(oldDir))}/ (zum Zurückholen).`);
  return { updated: done };
}

module.exports = { check, apply };
