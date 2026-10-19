'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/** Fehler mit einer verständlichen deutschen Meldung für die Oberfläche. */
class UserError extends Error {
  constructor(message, status = 400, code = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.userFacing = true;
  }
}

/**
 * Löst einen relativen Pfad innerhalb von `base` auf und verhindert Path Traversal
 * (z. B. "../../Windows" oder absolute Pfade wie "C:\\...").
 */
function safeResolve(base, rel) {
  if (typeof rel !== 'string' || rel.length === 0 || rel.includes('\0')) {
    throw new UserError('Ungültiger Pfad.');
  }
  const b = path.resolve(base);
  const p = path.resolve(b, rel);
  const r = path.relative(b, p);
  if (r === '') return p;
  if (path.isAbsolute(r) || r.split(path.sep)[0] === '..') {
    throw new UserError('Zugriff verweigert: Der Pfad liegt außerhalb des Server-Ordners.', 403);
  }
  return p;
}

/** Prüft, dass ein Dateiname keine Ordner enthält. */
function checkFileName(name, pattern) {
  if (typeof name !== 'string' || !name || name !== path.basename(name) || name === '.' || name === '..' ||
      /[<>:"|?*\\/\x00-\x1f]/.test(name) || (pattern && !pattern.test(name))) {
    throw new UserError('Ungültiger Dateiname.');
  }
  return name;
}

function normalizeRel(p) {
  return String(p).replace(/\\/g, '/').replace(/^\/+/, '');
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

let tmpCounter = 0;

/** Schreibt in eine eigene Temp-Datei und benennt sie um (unter Windows kann das kurz an Virenscannern scheitern, daher einige Versuche). */
function writeTextAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${++tmpCounter}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      const locked = ['EPERM', 'EBUSY', 'EACCES'].includes(e.code);
      if (i >= 8 || !locked) {
        // Hält ein anderes Programm (z. B. der laufende Minecraft-Server) die Datei offen, klappt unter Windows
        // kein Umbenennen darüber. Dann direkt hineinschreiben (nicht atomar, aber besser als gar nicht).
        if (locked) {
          try {
            fs.copyFileSync(tmp, file);
            fs.unlinkSync(tmp);
            return;
          } catch { /* unten mit dem ursprünglichen Fehler abbrechen */ }
        }
        try { fs.unlinkSync(tmp); } catch { /* egal */ }
        throw e;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25 * (i + 1));
    }
  }
}

function writeJsonAtomic(file, obj) {
  writeTextAtomic(file, JSON.stringify(obj, null, 2));
}

function timestamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function formatBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0).replace('.', ',')} ${u[i]}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Führt `worker` für alle Elemente mit begrenzter Parallelität aus. */
async function pool(limit, items, worker) {
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

function hashFile(file, algorithms = ['sha1']) {
  return new Promise((resolve, reject) => {
    const hashes = algorithms.map((a) => crypto.createHash(a));
    const rs = fs.createReadStream(file);
    rs.on('data', (c) => hashes.forEach((h) => h.update(c)));
    rs.on('error', reject);
    rs.on('end', () => {
      const out = {};
      algorithms.forEach((a, i) => { out[a] = hashes[i].digest('hex'); });
      resolve(out);
    });
  });
}

const NET_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH',
  'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);

/** Übersetzt Netzwerkfehler von fetch() in eine verständliche Meldung. */
function netError(e, what = 'den Download-Server') {
  if (e && e.userFacing) return e;
  const code = e?.cause?.code || e?.code;
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError' || NET_CODES.has(code) || e?.message === 'fetch failed') {
    return new UserError(`Keine Verbindung zu ${what}. Bitte prüfe deine Internetverbindung und versuche es erneut.`, 502);
  }
  return new UserError(`Netzwerkfehler: ${e?.message || e}`, 502);
}

module.exports = {
  UserError, safeResolve, checkFileName, normalizeRel, readJson, writeJsonAtomic, writeTextAtomic,
  timestamp, formatBytes, sleep, pool, hashFile, netError,
};
