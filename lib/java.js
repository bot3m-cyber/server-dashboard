'use strict';
// Sucht eine passende Java-Installation (Java) auf dem PC.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const config = require('./config');
const { UserError } = require('./util');

let cache = null;

function probe(javaExe) {
  return new Promise((resolve) => {
    execFile(javaExe, ['-version'], { timeout: 15000, windowsHide: true }, (err, stdout, stderr) => {
      const out = `${stderr || ''}${stdout || ''}`;
      const m = out.match(/version "([^"]+)"/);
      if (!m) return resolve(null);
      const v = m[1];
      const major = v.startsWith('1.') ? parseInt(v.split('.')[1], 10) : parseInt(v, 10);
      resolve({ path: javaExe, version: v, major, text: out.trim().split(/\r?\n/).slice(0, 3).join('\n') });
    });
  });
}

function listDir(dir) {
  try { return fs.readdirSync(dir).map((n) => path.join(dir, n)); } catch { return []; }
}

const IS_WIN = process.platform === 'win32';
const JAVA_BIN = IS_WIN ? 'java.exe' : 'java';

function candidates() {
  const env = process.env;
  const list = [];
  const cfg = config.get();
  if (cfg.javaPath) list.push(cfg.javaPath);
  if (env.JAVA_HOME) list.push(path.join(env.JAVA_HOME, 'bin', JAVA_BIN));
  list.push('java');
  if (IS_WIN) {
    const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs')]
      .filter(Boolean);
    const vendors = ['Eclipse Adoptium', 'Java', 'Microsoft', 'Zulu', 'BellSoft', 'Amazon Corretto', 'Semeru', 'OpenJDK', 'Eclipse Foundation'];
    for (const r of roots) {
      for (const v of vendors) {
        for (const jdk of listDir(path.join(r, v))) list.push(path.join(jdk, 'bin', JAVA_BIN));
      }
    }
    // Java, das der offizielle Minecraft-Launcher mitbringt (Java 21 = "java-runtime-delta")
    const runtimes = [
      env.APPDATA && path.join(env.APPDATA, '.minecraft', 'runtime'),
      env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'Minecraft Launcher', 'runtime'),
      env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Packages', 'Microsoft.4297127D64EC6_8wekyb3d8bbwe', 'LocalCache', 'Local', 'runtime'),
    ].filter(Boolean);
    for (const rt of runtimes) {
      for (const comp of listDir(rt)) {
        list.push(path.join(comp, 'windows-x64', path.basename(comp), 'bin', JAVA_BIN));
      }
    }
  } else {
    // Linux: Pakete aus apt/dnf liegen in /usr/lib/jvm, manuelle Installationen oft in /opt
    const home = process.env.HOME || '';
    for (const root of ['/usr/lib/jvm', '/usr/lib64/jvm', '/opt', '/opt/java', '/usr/local', home && path.join(home, '.sdkman', 'candidates', 'java'),
      home && path.join(home, '.jdks'), '/Library/Java/JavaVirtualMachines']) {
      if (!root) continue;
      for (const jdk of listDir(root)) {
        list.push(path.join(jdk, 'bin', JAVA_BIN));
        list.push(path.join(jdk, 'Contents', 'Home', 'bin', JAVA_BIN)); // macOS
      }
    }
  }
  return [...new Set(list)].filter((p) => p === 'java' || fs.existsSync(p));
}

/** Alle gefundenen Java-Installationen (30 Sekunden zwischengespeichert). */
async function findAll(force = false) {
  if (!force && cache && Date.now() - cache.at < 30000) return cache.all;
  const found = (await Promise.all(candidates().map(probe))).filter(Boolean);
  // Gleiche Installation (z. B. "java" auf dem PATH) nicht doppelt anzeigen
  const seen = new Set();
  const all = found.filter((j) => {
    const key = `${j.version}|${j.text}`;
    if (j.path === 'java' && seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  cache = { at: Date.now(), all };
  return all;
}

/** Wählt die passende Java-Version: genau die geforderte, sonst die nächsthöhere. */
function pick(all, required) {
  const cfg = config.get();
  const preferred = cfg.javaPath && all.find((j) => j.path === cfg.javaPath && j.major >= required);
  if (preferred) return preferred;
  const exact = all.find((j) => j.major === required);
  if (exact) return exact;
  return all.filter((j) => j.major > required).sort((a, b) => a.major - b.major)[0] || null;
}

/** Liefert { ok, best, all, message, required } für das aktive Profil (oder die angegebene Hauptversion). */
async function detect(force = false, required = null) {
  const need = required || config.get().javaMajor || 21;
  const all = await findAll(force);
  const best = pick(all, need);
  let message;
  if (best) {
    message = `Java ${best.version} gefunden.`;
  } else if (all.length) {
    message = `Java ${need} fehlt. Gefunden wurde nur: ${all.map((j) => `Java ${j.version}`).join(', ')}. Dieser Server braucht Java ${need}.`;
  } else {
    message = `Es ist kein Java installiert. Dieser Server braucht Java ${need}.`;
  }
  return { ok: !!best, best, all, message, required: need };
}

async function setManualPath(p) {
  const need = config.get().javaMajor || 21;
  if (typeof p !== 'string' || !p.trim()) {
    config.update({ javaPath: null });
    return detect(true);
  }
  let exe = p.trim().replace(/^"|"$/g, '');
  if (!/java(w)?(\.exe)?$/i.test(exe)) exe = path.join(exe, /bin[\\/]?$/i.test(exe) ? '' : 'bin', JAVA_BIN);
  if (!path.isAbsolute(exe) || !fs.existsSync(exe)) throw new UserError(`${JAVA_BIN} wurde nicht gefunden: ${exe}`);
  const info = await probe(exe);
  if (!info) throw new UserError('Diese Datei ist kein funktionierendes Java.');
  if (info.major < need) throw new UserError(`Das ist Java ${info.version}. Benötigt wird Java ${need}.`);
  config.update({ javaPath: exe });
  return detect(true);
}

/** Java für diesen Server oder ein verständlicher Fehler mit Download-Link. */
async function requireFor(major) {
  const j = await detect(false, major || null);
  if (!j.ok) {
    throw new UserError(`${j.message} Bitte installiere „Eclipse Temurin ${j.required}“ von https://adoptium.net/de/temurin/releases/?version=${j.required} und klicke dann auf „Erneut prüfen“.`, 400, 'NO_JAVA');
  }
  return j.best;
}

module.exports = { detect, setManualPath, requireFor };
