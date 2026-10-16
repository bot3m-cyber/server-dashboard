'use strict';
// Einrichtungs-Assistent: .mrpack einlesen, Mods laden, NeoForge installieren, EULA.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');
const config = require('./config');
const {
  UserError, safeResolve, normalizeRel, readJson, writeJsonAtomic, writeTextAtomic, pool, hashFile, formatBytes,
} = require('./util');
const { extractZip } = require('./zip');
const { downloadVerified } = require('./download');
const modrinth = require('./modrinth');
const mods = require('./mods');
const java = require('./java');
const serverTypes = require('./servertypes');

const INDEX_FILE = () => path.join(config.packDir(), 'modrinth.index.json');
const sidesFile = () => path.join(config.packDir(), 'sides.json');
const MARKER = '.server-dashboard';
const VERSION_RE = /^[0-9A-Za-z.+-]+$/;

// ---------------------------------------------------------------- Modpack einlesen

function readIndex() {
  if (!fs.existsSync(INDEX_FILE())) throw new UserError('Es wurde noch kein Modpack eingelesen (Schritt 1).');
  let idx;
  try {
    idx = JSON.parse(fs.readFileSync(INDEX_FILE(), 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    throw new UserError('Die modrinth.index.json im Modpack ist beschädigt.');
  }
  if (!idx || !Array.isArray(idx.files) || typeof idx.dependencies !== 'object') {
    throw new UserError('Die modrinth.index.json hat ein unbekanntes Format.');
  }
  return idx;
}

function projectIdOf(f) {
  for (const u of f.downloads || []) {
    const m = String(u).match(/^https:\/\/cdn\.modrinth\.com\/data\/([A-Za-z0-9]+)\//);
    if (m) return m[1];
  }
  return null;
}

function listOverrideJars() {
  const out = [];
  for (const base of ['overrides', 'server-overrides']) {
    const dir = path.join(config.packDir(), base, 'mods');
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      if (!/\.jar$/i.test(n)) continue;
      const abs = path.join(dir, n);
      out.push({ base, file: n, packRel: `${base}/mods/${n}`, abs, size: fs.statSync(abs).size });
    }
  }
  return out;
}

async function importMrpack(src, ctx, displayName) {
  const shown = displayName || path.basename(src);
  if (!/\.mrpack$/i.test(shown)) throw new UserError('Bitte eine Datei mit der Endung .mrpack wählen.');
  let st;
  try { st = await fsp.stat(src); } catch { throw new UserError(`Datei nicht gefunden: ${src}`, 404); }
  if (!st.isFile()) throw new UserError('Der angegebene Pfad ist keine Datei.');
  ctx.log(`Lese ${shown} (${formatBytes(st.size)}) …`);

  await fsp.rm(config.packDir(), { recursive: true, force: true });
  await fsp.mkdir(config.packDir(), { recursive: true });
  let hasIndex = false;
  await extractZip(src, (name) => {
    if (name === 'modrinth.index.json') { hasIndex = true; return safeResolve(config.packDir(), name); }
    if (name.startsWith('overrides/') || name.startsWith('server-overrides/')) return safeResolve(config.packDir(), name);
    return null; // client-overrides/ wird für den Server nicht gebraucht
  }, (d, t) => ctx.progress(d, t, `Entpacke Eintrag ${d} von ${t}`));
  if (!hasIndex) {
    throw new UserError('In der Datei fehlt die modrinth.index.json. Ist das wirklich ein Modrinth-Modpack (.mrpack)?');
  }

  const idx = readIndex();
  if (idx.game && idx.game !== 'minecraft') throw new UserError(`Unbekanntes Spiel im Modpack: ${idx.game}`);
  const deps = idx.dependencies;
  if (!deps.neoforge) {
    if (deps.forge) throw new UserError('Dieses Modpack nutzt Forge statt NeoForge. Das unterstützt das Dashboard nicht.');
    if (deps['fabric-loader'] || deps['quilt-loader']) throw new UserError('Dieses Modpack nutzt Fabric/Quilt statt NeoForge. Das unterstützt das Dashboard nicht.');
    throw new UserError('Im Modpack ist keine NeoForge-Version angegeben.');
  }
  if (!VERSION_RE.test(deps.neoforge) || !VERSION_RE.test(deps.minecraft || '')) {
    throw new UserError('Ungültige Versionsangabe in der modrinth.index.json.');
  }
  ctx.log(`Modpack: ${idx.name} (Minecraft ${deps.minecraft}, NeoForge ${deps.neoforge}, ${idx.files.length} Dateien im Index)`);

  // Zusätzlich bei Modrinth nachsehen, welche Mods reine Client-Mods sind.
  // Viele Modpacks markieren alles als env.server = "required", auch Sodium, Iris usw.
  const sides = { projects: {}, overrides: {}, checkedAt: null, error: null };
  try {
    ctx.log('Frage bei Modrinth nach, welche Mods reine Client-Mods sind …');
    const ids = [...new Set(idx.files.map(projectIdOf).filter(Boolean))];
    sides.projects = await modrinth.projects(ids);
    const jars = listOverrideJars();
    const hashes = {};
    for (const j of jars) hashes[j.file] = (await hashFile(j.abs, ['sha1'])).sha1;
    const byHash = await modrinth.projectIdsBySha1(Object.values(hashes));
    const missing = [...new Set(Object.values(byHash))].filter((id) => !sides.projects[id]);
    Object.assign(sides.projects, await modrinth.projects(missing));
    for (const [file, h] of Object.entries(hashes)) if (byHash[h]) sides.overrides[file] = byHash[h];
    sides.checkedAt = Date.now();
    const n = Object.values(sides.projects).filter((p) => p.server_side === 'unsupported').length;
    ctx.log(`Modrinth: ${n} Mods sind als reine Client-Mods markiert.`);
  } catch (e) {
    sides.error = e.message;
    ctx.log(`Hinweis: Die Modrinth-Abfrage hat nicht geklappt (${e.message}). Es wird nur nach den Angaben im Modpack gefiltert.`);
  }
  writeJsonAtomic(sidesFile(), sides);

  const pack = {
    name: idx.name || 'Unbenanntes Modpack', versionId: idx.versionId || '', minecraft: deps.minecraft,
    neoforge: deps.neoforge, files: idx.files.length, source: shown, importedAt: Date.now(),
  };
  const javaMajor = await serverTypes.javaMajorFor(pack.minecraft);
  config.update({ pack, mcVersion: pack.minecraft, loaderVersion: pack.neoforge, javaMajor });
  ctx.log('Fertig. Weiter mit Schritt 2.');
  return pack;
}

// ---------------------------------------------------------------- Plan: was kommt auf den Server?

function decide({ rel, fileName, proj, envServer, forceServer }, cfg) {
  const isMod = /^mods\/[^/]+\.jar$/i.test(rel);
  if (envServer === 'unsupported') return { action: 'skip', reason: 'Laut Modpack nicht für Server (env.server = unsupported)' };
  if (isMod && mods.matchesExclude(fileName, proj?.slug, cfg.excludes)) return { action: 'skip', reason: 'Steht auf der Ausschlussliste' };
  if (isMod && !forceServer && cfg.skipClientOnly && proj && proj.server_side === 'unsupported') {
    return { action: 'disabled', reason: 'Reine Client-Mod laut Modrinth, wird deaktiviert abgelegt' };
  }
  return { action: 'install', reason: '' };
}

function buildPlan() {
  const cfg = config.get();
  const idx = readIndex();
  const sides = readJson(sidesFile(), { projects: {}, overrides: {} });
  const items = [];
  for (const f of idx.files) {
    const rel = normalizeRel(f.path);
    safeResolve(cfg.serverDir, rel); // bricht bei "../" o. Ä. im Index ab
    const fileName = path.posix.basename(rel);
    const pid = projectIdOf(f);
    const proj = pid ? sides.projects[pid] : null;
    const envServer = f.env?.server || 'required';
    items.push({
      source: 'download', rel, fileName, title: proj?.title || null, slug: proj?.slug || null,
      size: f.fileSize || 0, hashes: f.hashes || {}, downloads: f.downloads || [], envServer,
      ...decide({ rel, fileName, proj, envServer }, cfg),
    });
  }
  for (const j of listOverrideJars()) {
    const pid = sides.overrides?.[j.file];
    const proj = pid ? sides.projects[pid] : null;
    const rel = `mods/${j.file}`;
    items.push({
      source: 'override', rel, fileName: j.file, packRel: j.packRel, title: proj?.title || null, slug: proj?.slug || null,
      size: j.size, envServer: null,
      ...decide({ rel, fileName: j.file, proj, forceServer: j.base === 'server-overrides' }, cfg),
    });
  }
  const summary = { install: 0, disabled: 0, skip: 0, total: items.length, bytes: 0 };
  for (const it of items) {
    summary[it.action]++;
    if (it.action !== 'skip') summary.bytes += it.size || 0;
  }
  return { items, summary, modrinthChecked: !!sides.checkedAt, modrinthError: sides.error || null };
}

function packKey(pack) {
  return pack ? `${pack.name}|${pack.versionId}|${pack.importedAt}` : null;
}

async function hashesMatch(file, hashes) {
  const algos = ['sha1', 'sha512'].filter((a) => hashes[a]);
  if (!algos.length) return false;
  const h = await hashFile(file, algos);
  return algos.every((a) => h[a] === String(hashes[a]).toLowerCase());
}

async function copyTree(srcDir, destRoot, base, decisions, ctx) {
  let count = 0;
  const walk = async (dir, relPrefix) => {
    for (const ent of await fsp.readdir(dir, { withFileTypes: true })) {
      const rel = relPrefix ? `${relPrefix}/${ent.name}` : ent.name;
      const src = path.join(dir, ent.name);
      if (ent.isDirectory()) { await walk(src, rel); continue; }
      if (!ent.isFile()) continue;
      let dest = safeResolve(destRoot, rel);
      const dec = decisions.get(`${base}/${rel}`.toLowerCase());
      if (dec) {
        if (dec.action === 'skip') { ctx.log(`– übersprungen (${dec.reason}): ${ent.name}`); continue; }
        const enabledVariant = dest;
        const disabledVariant = dest + '.disabled';
        // Hat der Nutzer die Mod selbst umgeschaltet, diese Wahl beibehalten
        if (fs.existsSync(disabledVariant) && !fs.existsSync(enabledVariant)) dest = disabledVariant;
        else if (fs.existsSync(enabledVariant)) dest = enabledVariant;
        else if (dec.action === 'disabled') dest = disabledVariant;
      }
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.copyFile(src, dest);
      count++;
    }
  };
  await walk(srcDir, '');
  return count;
}

async function installPack(ctx) {
  const cfg = config.get();
  if (!cfg.pack) throw new UserError('Bitte zuerst das Modpack einlesen (Schritt 1).');
  ensureServerDir();
  const plan = buildPlan();
  const sd = cfg.serverDir;
  await fsp.mkdir(path.join(sd, 'mods'), { recursive: true });

  // Dateien einer früheren Installation entfernen, die nicht mehr im Modpack sind
  const keep = plan.items.filter((i) => i.action !== 'skip').map((i) => i.rel);
  const keepSet = new Set(keep.map((r) => r.toLowerCase()));
  for (const rel of cfg.installedFiles || []) {
    if (keepSet.has(rel.toLowerCase())) continue;
    for (const v of [rel, `${rel}.disabled`]) await fsp.rm(safeResolve(sd, v), { force: true });
    ctx.log(`Entfernt (nicht mehr im Modpack oder ausgeschlossen): ${path.posix.basename(rel)}`);
  }
  // Ausgeschlossene Mods, die schon im Ordner liegen, deaktivieren
  for (const it of plan.items.filter((i) => i.action === 'skip' && i.rel.startsWith('mods/'))) {
    const p = safeResolve(sd, it.rel);
    if (fs.existsSync(p)) {
      await fsp.rm(`${p}.disabled`, { force: true });
      await fsp.rename(p, `${p}.disabled`);
      ctx.log(`Deaktiviert (${it.reason}): ${it.fileName}`);
    }
  }

  const downloads = plan.items.filter((i) => i.source === 'download' && i.action !== 'skip');
  const skipped = plan.items.filter((i) => i.source === 'download' && i.action === 'skip');
  ctx.log(`${downloads.length} Dateien werden geprüft/geladen, ${skipped.length} übersprungen.`);
  for (const s of skipped) ctx.log(`– übersprungen (${s.reason}): ${s.fileName}`);

  const totalBytes = downloads.reduce((a, i) => a + (i.size || 0), 0) || 1;
  let doneBytes = 0;
  let doneFiles = 0;
  const failures = [];
  const report = () => ctx.progress(Math.min(doneBytes, totalBytes), totalBytes,
    `${doneFiles} von ${downloads.length} Dateien (${formatBytes(doneBytes)} von ${formatBytes(totalBytes)})`);
  report();

  await pool(4, downloads, async (it) => {
    const want = safeResolve(sd, it.rel + (it.action === 'disabled' ? '.disabled' : ''));
    const alt = safeResolve(sd, it.action === 'disabled' ? it.rel : `${it.rel}.disabled`);
    for (const existing of [want, alt]) {
      if (fs.existsSync(existing) && await hashesMatch(existing, it.hashes)) {
        doneBytes += it.size || 0;
        doneFiles++;
        ctx.log(`✓ bereits vorhanden: ${it.fileName}`);
        report();
        return;
      }
    }
    await fsp.mkdir(path.dirname(want), { recursive: true });
    try {
      await downloadVerified(it.downloads, want, {
        sha1: it.hashes.sha1, sha512: it.hashes.sha512, label: it.fileName,
        onBytes: (n) => { doneBytes += n; report(); },
      });
      await fsp.rm(alt, { force: true });
      doneFiles++;
      ctx.log(`✓ ${it.fileName}${it.action === 'disabled' ? '  (als Client-Mod deaktiviert)' : ''}`);
    } catch (e) {
      failures.push({ file: it.fileName, error: e.message, hash: e.code === 'HASH' });
      ctx.log(`✗ ${it.fileName}: ${e.message}`);
    }
    report();
  });

  ctx.log('Kopiere overrides/ (Konfigurationen, zusätzliche Mods …) in den Server-Ordner …');
  const decisions = new Map(plan.items.filter((i) => i.source === 'override').map((i) => [i.packRel.toLowerCase(), i]));
  let copied = 0;
  for (const base of ['overrides', 'server-overrides']) {
    const src = path.join(config.packDir(), base);
    if (fs.existsSync(src)) copied += await copyTree(src, sd, base, decisions, ctx);
  }
  ctx.log(`${copied} Dateien aus overrides/ kopiert.`);

  if (failures.length) {
    const names = failures.slice(0, 5).map((f) => f.file).join(', ');
    const hint = failures.every((f) => f.hash)
      ? 'Die Dateien kamen beschädigt an (Prüfsumme falsch). Bitte „Mods herunterladen“ noch einmal klicken. Bleibt der Fehler, ist das Modpack vermutlich veraltet oder fehlerhaft.'
      : 'Bitte Internetverbindung prüfen und „Mods herunterladen“ noch einmal klicken.';
    throw new UserError(`${failures.length} Datei(en) konnten nicht geladen werden: ${names}${failures.length > 5 ? ' …' : ''}. `
      + `${hint} Fertige Dateien werden dann übersprungen.`);
  }
  config.update({ installedFiles: keep, installedPackKey: packKey(cfg.pack) });
  ctx.log('Alle Mods sind fertig. Weiter mit Schritt 3.');
  return plan.summary;
}

// ---------------------------------------------------------------- Server-Ordner

function ensureServerDir() {
  const sd = config.get().serverDir;
  fs.mkdirSync(sd, { recursive: true });
  const marker = path.join(sd, MARKER);
  if (!fs.existsSync(marker)) fs.writeFileSync(marker, 'Dieser Ordner wird vom Minecraft Server-Dashboard verwaltet.\n');
  return sd;
}

function isInside(child, parent) {
  const r = path.relative(parent, child);
  return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
}

function setServerDir(p, force) {
  if (typeof p !== 'string' || !p.trim()) throw new UserError('Bitte einen Ordner angeben.');
  const raw = p.trim().replace(/^"|"$/g, '');
  if (!path.isAbsolute(raw)) throw new UserError('Bitte einen vollständigen Pfad angeben, z. B. C:\\MinecraftServer');
  const abs = path.resolve(raw);
  if (abs === path.parse(abs).root) throw new UserError('Bitte nicht direkt ein Laufwerk wählen, sondern einen Unterordner, z. B. C:\\MinecraftServer');
  const env = process.env;
  const forbidden = [env.windir || env.SystemRoot, env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramData].filter(Boolean);
  const posixSystem = ['/bin', '/boot', '/dev', '/etc', '/lib', '/lib64', '/proc', '/root', '/run', '/sbin', '/sys', '/usr'];
  if (forbidden.some((f) => isInside(abs, f)) || (process.platform !== 'win32' && posixSystem.some((f) => isInside(abs, f)))) throw new UserError('Dieser Ordner ist ein Systemordner. Bitte einen anderen wählen.');
  if (abs.toLowerCase() === require('os').homedir().toLowerCase()) throw new UserError('Bitte nicht direkt den Benutzerordner wählen, sondern einen Unterordner.');
  const appServer = path.join(config.APP_DIR, 'server');
  if (isInside(abs, config.APP_DIR) && !isInside(abs, appServer) && !isInside(abs, config.SERVERS_DIR)) {
    throw new UserError('Dieser Ordner gehört zum Dashboard selbst. Bitte einen anderen wählen.');
  }
  if (fs.existsSync(abs)) {
    if (!fs.statSync(abs).isDirectory()) throw new UserError('Unter diesem Pfad liegt eine Datei, kein Ordner.');
    const entries = fs.readdirSync(abs);
    const known = entries.includes(MARKER) || entries.includes('eula.txt') || entries.includes('server.properties');
    if (entries.length && !known && !force) {
      throw new UserError(`Der Ordner ist nicht leer (${entries.length} Einträge). Trotzdem verwenden?`, 409, 'NOT_EMPTY');
    }
  }
  const changed = abs.toLowerCase() !== config.get().serverDir.toLowerCase();
  config.update({ serverDir: abs, ...(changed ? { installedPackKey: null, installedFiles: [], installed: false } : {}) });
  ensureServerDir();
  return abs;
}

// ---------------------------------------------------------------- NeoForge

/** Argumentdatei des NeoForge-Servers: Windows nutzt win_args.txt, Linux/macOS unix_args.txt. */
function argsFileRel(v) {
  return `libraries/net/neoforged/neoforge/${v}/${process.platform === 'win32' ? 'win_args.txt' : 'unix_args.txt'}`;
}
const winArgsRel = argsFileRel;

const neoVersion = (cfg) => cfg.loaderVersion || cfg.pack?.neoforge || null;

function neoforgeInstalled() {
  const v = neoVersion(config.get());
  if (!v || !VERSION_RE.test(v)) return false;
  try { return fs.existsSync(config.serverPath(argsFileRel(v))); } catch { return false; }
}

async function installNeoForge(ctx) {
  const cfg = config.get();
  const v = neoVersion(cfg);
  if (!v) throw new UserError('Es ist keine NeoForge-Version festgelegt. Bitte zuerst das Modpack einlesen (Schritt 1).');
  if (!VERSION_RE.test(v)) throw new UserError('Ungültige NeoForge-Version.');
  const javaInfo = await java.requireFor(cfg.javaMajor);
  const sd = ensureServerDir();

  const url = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${v}/neoforge-${v}-installer.jar`;
  const installer = safeResolve(sd, `neoforge-${v}-installer.jar`);
  ctx.log(`Lade NeoForge-Installer ${v} …`);
  ctx.log(url);
  let expectedSha1 = null;
  try {
    const r = await fetch(`${url}.sha1`, { signal: AbortSignal.timeout(15000) });
    if (r.ok) expectedSha1 = (await r.text()).trim().slice(0, 40);
    else if (r.status === 404) throw new UserError(`NeoForge ${v} wurde auf maven.neoforged.net nicht gefunden.`, 404);
  } catch (e) {
    if (e.userFacing) throw e;
    /* Prüfsumme nicht erreichbar: der Download selbst meldet dann den Netzwerkfehler */
  }
  let total = 0;
  let done = 0;
  await downloadVerified([url], installer, {
    sha1: /^[0-9a-f]{40}$/i.test(expectedSha1 || '') ? expectedSha1 : undefined,
    allowedHosts: new Set(['maven.neoforged.net']),
    onTotal: (t) => { total = t; },
    onBytes: (n) => { done += n; ctx.progress(done, total || done, `Installer: ${formatBytes(done)}`); },
  });
  ctx.log('Installer geladen. Starte die Server-Installation (das dauert 1–3 Minuten) …');
  ctx.progress(0, 0, 'NeoForge wird installiert …');

  const code = await new Promise((resolve, reject) => {
    const p = spawn(javaInfo.path, ['-jar', installer, '--installServer'], { cwd: sd, windowsHide: true });
    const onLine = (line) => { if (line.trim()) ctx.log(line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')); };
    readline.createInterface({ input: p.stdout }).on('line', onLine);
    readline.createInterface({ input: p.stderr }).on('line', onLine);
    p.on('error', (e) => reject(new UserError(`Java konnte nicht gestartet werden: ${e.message}`)));
    p.on('exit', resolve);
  });
  await fsp.rm(installer, { force: true });
  if (code !== 0 || !neoforgeInstalled()) {
    throw new UserError(`Die NeoForge-Installation ist fehlgeschlagen (Code ${code}). Details stehen im Protokoll oben. `
      + 'Häufige Ursache: keine Internetverbindung während der Installation.');
  }
  writeJvmArgs();
  config.update({ installed: true });
  ctx.log(`NeoForge ${v} ist installiert. Weiter mit dem nächsten Schritt.`);
  return { version: v };
}

/** Schreibt die RAM-Einstellung zusätzlich in user_jvm_args.txt (für run.bat). */
function writeJvmArgs() {
  const cfg = config.get();
  if (!fs.existsSync(cfg.serverDir)) return;
  writeTextAtomic(config.serverPath('user_jvm_args.txt'),
    '# Vom Server-Dashboard geschrieben. RAM-Einstellung bitte im Dashboard ändern.\n'
    + `-Xms${cfg.xmsGb}G\n-Xmx${cfg.xmxGb}G\n`);
}

// ---------------------------------------------------------------- EULA

function eulaAccepted() {
  try { return /^\s*eula\s*=\s*true\s*$/mi.test(fs.readFileSync(config.serverPath('eula.txt'), 'utf8')); } catch { return false; }
}

function setEula(accepted) {
  if (accepted !== true) throw new UserError('Bitte erst das Häkchen bei der EULA setzen.');
  ensureServerDir();
  writeTextAtomic(config.serverPath('eula.txt'),
    '#By changing the setting below to TRUE you are indicating your agreement to our EULA (https://aka.ms/MinecraftEULA).\n'
    + `#${new Date().toString()}\neula=true\n`);
}

// ---------------------------------------------------------------- Status

function plainInstalled(cfg) {
  if (cfg.type === 'neoforge') return neoforgeInstalled();
  return !!cfg.jar && fs.existsSync(path.join(cfg.serverDir, cfg.jar));
}

function status() {
  const cfg = config.get();
  const types = serverTypes.TYPES[cfg.type] || serverTypes.TYPES.modpack;
  const base = {
    id: cfg.id, name: cfg.name, type: cfg.type, typeLabel: types.label, kind: types.kind, mcVersion: cfg.mcVersion,
    loaderVersion: cfg.loaderVersion, javaMajor: cfg.javaMajor, serverDir: cfg.serverDir,
    serverDirExists: fs.existsSync(cfg.serverDir), skipClientOnly: cfg.skipClientOnly,
  };
  if (cfg.type !== 'modpack') {
    const steps = { install: plainInstalled(cfg), eula: eulaAccepted() };
    return { ...base, pack: null, steps, complete: steps.install && steps.eula };
  }
  const pack = cfg.pack && fs.existsSync(INDEX_FILE()) ? cfg.pack : null;
  const steps = {
    pack: !!pack,
    mods: !!pack && cfg.installedPackKey === packKey(pack),
    neoforge: !!pack && neoforgeInstalled(),
    eula: eulaAccepted(),
  };
  return { ...base, pack, steps, complete: steps.pack && steps.mods && steps.neoforge && steps.eula };
}

module.exports = {
  importMrpack, buildPlan, installPack, setServerDir, installNeoForge, setEula, status, winArgsRel, argsFileRel,
  neoforgeInstalled, writeJvmArgs, ensureServerDir, plainInstalled, neoVersion, eulaAccepted,
};
