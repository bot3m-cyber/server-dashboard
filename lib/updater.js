'use strict';
// Updates des Dashboards selbst (nicht der Minecraft-Server): auf GitHub nach neuen Versionen suchen, die Änderungen anzeigen
// und die neue Version installieren. Einstellungen, Server und Welten (data/, server/, servers/) werden nie angefasst.
//  - Git-Ordner:  git pull
//  - ZIP-Ordner:  lädt genau den neuesten Stand als ZIP, sichert den alten Code, ersetzt lib/ und public/ und die Dateien im Hauptordner
// Die Abfrage geht an api.github.com (maximal einmal am Tag, abschaltbar). Der Stand wird in data/updates.json zwischengespeichert.
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const { APP_DIR, DATA_DIR } = require('./paths');
const { readJson, writeJsonAtomic, UserError, safeResolve } = require('./util');
const { extractZip } = require('./zip');
const legal = require('./legal');

const STATE_FILE = path.join(DATA_DIR, 'updates.json');
const INSTALLED_FILE = path.join(DATA_DIR, 'installed.json');
const BACKUP_DIR = path.join(DATA_DIR, 'update-backup');
const TMP_DIR = path.join(DATA_DIR, 'update-tmp');
// Diese Ordner gehören dir und werden nie überschrieben oder gelöscht
const KEEP = new Set(['data', 'server', 'servers', 'node_modules', '.git', 'data-mehrbenutzer', 'servers-mehrbenutzer']);
const UA = 'server-dashboard-updater';

const state = () => ({ autoCheck: true, checkedAt: 0, latest: null, pending: [], error: null, ...readJson(STATE_FILE, {}) });
function saveState(patch) {
  const s = { ...state(), ...patch };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  writeJsonAtomic(STATE_FILE, s);
  return s;
}

const run = (cmd, args, opts = {}) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: 120000, windowsHide: true, ...opts }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || '').trim(), err: String(stderr || err?.message || '').trim() }));
});

/** Neuester Änderungszeitpunkt der Programmdateien (für ZIP-Ordner ohne Versionsangabe). */
function newestFileTime() {
  let max = 0;
  const visit = (dir, depth) => {
    let list = [];
    try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const d of list) {
      if (KEEP.has(d.name)) continue;
      const p = path.join(dir, d.name);
      if (d.isDirectory()) { if (depth < 2) visit(p, depth + 1); continue; }
      if (!/\.(js|html|css|json|md|sh|bat)$/.test(d.name)) continue;
      try { max = Math.max(max, fs.statSync(p).mtimeMs); } catch { /* egal */ }
    }
  };
  visit(APP_DIR, 0);
  return max;
}

let installedCache = { at: 0, v: null };
/** Welche Version läuft hier? (kurz zwischengespeichert) */
async function installed() {
  if (installedCache.v && Date.now() - installedCache.at < 30000) return installedCache.v;
  const v = await installedUncached();
  installedCache = { at: Date.now(), v };
  return v;
}

async function installedUncached() {
  if (fs.existsSync(path.join(APP_DIR, '.git'))) {
    const sha = await run('git', ['-C', APP_DIR, 'rev-parse', 'HEAD']);
    if (sha.ok && /^[0-9a-f]{40}$/.test(sha.out)) {
      const dt = await run('git', ['-C', APP_DIR, 'log', '-1', '--format=%cI']);
      return { kind: 'git', sha: sha.out, dateMs: dt.ok ? Date.parse(dt.out) : null };
    }
  }
  const rec = readJson(INSTALLED_FILE, null);
  // Eine Aufzeichnung gilt nur, wenn danach nichts von Hand ersetzt wurde (z. B. mit update.sh oder durch Kopieren)
  if (rec && /^[0-9a-f]{40}$/.test(rec.sha || '') && newestFileTime() <= (rec.at || 0) + 60000) return { kind: 'zip', sha: rec.sha, dateMs: rec.dateMs || null };
  return { kind: 'zip', sha: null, dateMs: newestFileTime() };
}

async function gh(pathAndQuery) {
  let res;
  try {
    res = await fetch(`https://api.github.com${pathAndQuery}`, { headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20000) });
  } catch {
    throw new UserError('GitHub ist von hier aus nicht erreichbar. Bitte die Internetverbindung prüfen.', 502);
  }
  if (res.status === 403 || res.status === 429) throw new UserError('GitHub erlaubt gerade keine weiteren Abfragen (Begrenzung pro Stunde). Bitte später noch einmal versuchen.', 429);
  if (res.status === 404) throw new UserError('Das Projekt wurde bei GitHub nicht gefunden (ist das Repository öffentlich?).', 404);
  if (!res.ok) throw new UserError(`GitHub antwortet mit Fehler ${res.status}.`, 502);
  return res.json();
}

const title = (msg) => String(msg || '').split('\n')[0].slice(0, 200);
const mapCommit = (c) => ({ sha: c.sha, date: c.commit?.committer?.date || c.commit?.author?.date || null, title: title(c.commit?.message) });

/** Fragt GitHub, ob es Neueres gibt. */
async function check() {
  const r = legal.repoInfo();
  if (!r.owner) throw new UserError('In package.json steht keine GitHub-Adresse (repository).');
  const base = `/repos/${r.owner}/${r.repo}`;
  const [latestList, inst] = await Promise.all([gh(`${base}/commits?per_page=1`), installed()]);
  const latest = mapCommit(latestList[0]);
  let pending = [];
  if (inst.sha === latest.sha) {
    pending = [];
  } else if (inst.sha) {
    try {
      const cmp = await gh(`${base}/compare/${inst.sha}...${latest.sha}`);
      pending = cmp.status === 'behind' ? [] : (cmp.commits || []).map(mapCommit).reverse();
    } catch (e) {
      if (e.status !== 404) throw e; // Stand unbekannt (z. B. nur lokal vorhanden): nach Datum vergleichen
      pending = null;
    }
  } else {
    pending = null;
  }
  if (pending === null) {
    const since = new Date((inst.dateMs || 0) + 5000).toISOString();
    pending = (await gh(`${base}/commits?since=${encodeURIComponent(since)}&per_page=50`)).map(mapCommit);
  }
  return saveState({ checkedAt: Date.now(), latest, pending, error: null, installedSha: inst.sha || null, installedKind: inst.kind, installedDate: inst.dateMs || null });
}

/** Stand für die Oberfläche (ohne Netzwerk). */
async function status() {
  const s = state();
  const inst = await installed();
  return {
    autoCheck: s.autoCheck, checkedAt: s.checkedAt, error: s.error, latest: s.latest, pending: s.pending || [], available: (s.pending || []).length > 0,
    installed: { kind: inst.kind, sha: inst.sha, dateMs: inst.dateMs }, repoUrl: legal.repoInfo().url,
    canInstall: inst.kind === 'git' ? true : true,
  };
}

function setAutoCheck(on) {
  return saveState({ autoCheck: !!on });
}

// ---------------------------------------------------------------- Installieren

function runLogged(cmd, args, jctx, cwd) {
  return new Promise((resolve) => {
    // Unter Windows ist npm eine .cmd-Datei und läuft über cmd.exe
    const child = process.platform === 'win32'
      ? spawn('cmd.exe', ['/c', cmd, ...args], { cwd, windowsHide: true })
      : spawn(cmd, args, { cwd, windowsHide: true });
    const timer = setTimeout(() => { try { child.kill(); } catch { /* egal */ } }, 15 * 60 * 1000);
    const lines = (d) => String(d).split(/\r?\n/).filter(Boolean).slice(-6).forEach((l) => jctx.log(l.slice(0, 200)));
    child.stdout.on('data', lines);
    child.stderr.on('data', lines);
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, err: e.message }); });
    child.on('exit', (code) => { clearTimeout(timer); resolve({ ok: code === 0, err: `Beendet mit Code ${code}` }); });
  });
}

function copyCode(from, to) {
  for (const name of fs.readdirSync(from)) {
    if (KEEP.has(name)) continue;
    fs.cpSync(path.join(from, name), path.join(to, name), { recursive: true, force: true });
  }
}

function restoreBackup(dir) {
  fs.rmSync(path.join(APP_DIR, 'lib'), { recursive: true, force: true });
  fs.rmSync(path.join(APP_DIR, 'public'), { recursive: true, force: true });
  copyCode(dir, APP_DIR);
}

async function install(jctx) {
  const r = legal.repoInfo();
  const inst = await installed();

  if (inst.kind === 'git') {
    jctx.log('Git-Ordner erkannt: hole die neueste Version (git pull) …');
    jctx.progress(1, 4, 'Hole Änderungen');
    const pull = await run('git', ['-C', APP_DIR, 'pull', '--ff-only'], { timeout: 300000 });
    if (!pull.ok) throw new UserError(`git pull ist fehlgeschlagen: ${pull.err.slice(0, 300)}. Hast du Programmdateien von Hand geändert? Deine Einstellungen sind unverändert.`);
    jctx.log(pull.out.split('\n').slice(-3).join('\n'));
  } else {
    // 1. Genau den neuesten Stand laden
    jctx.progress(0, 6, 'Frage die neueste Version ab');
    const latest = mapCommit((await gh(`/repos/${r.owner}/${r.repo}/commits?per_page=1`))[0]);
    jctx.log(`Neueste Version: ${latest.sha.slice(0, 7)} – ${latest.title}`);
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
    const zipFile = path.join(TMP_DIR, 'neu.zip');
    jctx.progress(1, 6, 'Lade herunter');
    let res;
    try {
      res = await fetch(`https://codeload.github.com/${r.owner}/${r.repo}/zip/${latest.sha}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(180000) });
    } catch {
      throw new UserError('Der Download von GitHub ist fehlgeschlagen. Bitte die Internetverbindung prüfen.', 502);
    }
    if (!res.ok) throw new UserError(`Der Download von GitHub antwortet mit Fehler ${res.status}.`, 502);
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(zipFile));
    const size = fs.statSync(zipFile).size;
    if (size < 20000 || size > 300 * 1024 * 1024) throw new UserError('Die heruntergeladene Datei sieht nicht richtig aus. Es wurde nichts verändert.');
    jctx.log(`Heruntergeladen (${(size / 1048576).toFixed(1)} MB).`);

    // 2. Entpacken und prüfen
    jctx.progress(2, 6, 'Entpacke');
    const fresh = path.join(TMP_DIR, 'neu');
    await extractZip(zipFile, (name, isDir) => {
      const rel = name.split('/').slice(1).join('/'); // oberster Ordner (repo-sha) fällt weg
      if (!rel || KEEP.has(rel.split('/')[0])) return null;
      return safeResolve(fresh, rel);
    });
    for (const must of ['server.js', 'package.json', 'lib', 'public']) {
      if (!fs.existsSync(path.join(fresh, must))) throw new UserError(`In der neuen Version fehlt „${must}“. Es wurde nichts verändert.`);
    }

    // 3. Alten Code sichern (nur Programmdateien, keine Daten)
    jctx.progress(3, 6, 'Sichere den alten Stand');
    const backup = path.join(BACKUP_DIR, new Date().toISOString().replace(/[:.]/g, '-'));
    fs.mkdirSync(backup, { recursive: true });
    copyCode(APP_DIR, backup);
    fs.rmSync(path.join(backup, 'update-tmp'), { recursive: true, force: true });
    try {
      const old = fs.readdirSync(BACKUP_DIR).sort();
      for (const d of old.slice(0, Math.max(0, old.length - 3))) fs.rmSync(path.join(BACKUP_DIR, d), { recursive: true, force: true });
    } catch { /* egal */ }
    jctx.log(`Alter Stand gesichert in ${path.relative(APP_DIR, backup)}`);

    // 4. Ersetzen
    jctx.progress(4, 6, 'Installiere die neuen Dateien');
    fs.rmSync(path.join(APP_DIR, 'lib'), { recursive: true, force: true });
    fs.rmSync(path.join(APP_DIR, 'public'), { recursive: true, force: true });
    copyCode(fresh, APP_DIR);

    // 5. Pakete
    jctx.progress(5, 6, 'Installiere Pakete (npm)');
    const npm = await runLogged('npm', ['install', '--omit=dev'], jctx, APP_DIR);
    if (!npm.ok) {
      jctx.log('npm install ist fehlgeschlagen. Der alte Stand wird wiederhergestellt …');
      restoreBackup(backup);
      throw new UserError(`Die Pakete konnten nicht installiert werden (${npm.err}). Der alte Stand wurde wiederhergestellt, nichts ging verloren.`);
    }
    writeJsonAtomic(INSTALLED_FILE, { sha: latest.sha, dateMs: latest.date ? Date.parse(latest.date) : null, at: Date.now() });
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    installedCache = { at: 0, v: null };
    saveState({ pending: [], latest, checkedAt: Date.now(), error: null, installedSha: latest.sha });
    jctx.progress(6, 6, 'Fertig');
    jctx.log('Die neue Version ist installiert. Das Dashboard startet jetzt neu.');
    return { sha: latest.sha };
  }

  jctx.progress(3, 4, 'Installiere Pakete (npm)');
  const npm = await runLogged('npm', ['install', '--omit=dev'], jctx, APP_DIR);
  if (!npm.ok) throw new UserError(`Die Pakete konnten nicht installiert werden (${npm.err}). Bitte „npm install --omit=dev“ im Programmordner von Hand ausführen.`);
  installedCache = { at: 0, v: null };
  saveState({ pending: [], checkedAt: Date.now(), error: null });
  jctx.progress(4, 4, 'Fertig');
  jctx.log('Die neue Version ist installiert. Das Dashboard startet jetzt neu.');
  return { git: true };
}

// ---------------------------------------------------------------- Regelmäßige Prüfung

function startScheduler(log = console.log) {
  const tick = async () => {
    const s = state();
    if (!s.autoCheck || Date.now() - (s.checkedAt || 0) < 20 * 3600e3) return;
    try { await check(); } catch (e) { saveState({ error: e.message, checkedAt: Date.now() }); log(`Update-Prüfung: ${e.message}`); }
  };
  setTimeout(tick, 90e3).unref();
  setInterval(tick, 6 * 3600e3).unref();
}

// Aufruf von der Kommandozeile (update.sh / update.bat): merkt sich, dass jetzt der neueste Stand installiert ist
if (require.main === module && process.argv.includes('--mark-current')) {
  (async () => {
    try {
      const r = legal.repoInfo();
      const latest = mapCommit((await gh(`/repos/${r.owner}/${r.repo}/commits?per_page=1`))[0]);
      writeJsonAtomic(INSTALLED_FILE, { sha: latest.sha, dateMs: latest.date ? Date.parse(latest.date) : null, at: Date.now() });
      saveState({ pending: [], latest, checkedAt: Date.now(), error: null });
      console.log(`Version ${latest.sha.slice(0, 7)} vermerkt.`);
    } catch (e) {
      console.log(`Version konnte nicht vermerkt werden: ${e.message}`);
    }
  })();
}

module.exports = { check, status, install, installed, setAutoCheck, startScheduler, newestFileTime };
