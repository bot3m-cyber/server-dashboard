'use strict';
// Dateimanager im Server-Ordner: ansehen, bearbeiten, hochladen, herunterladen, löschen.
// Alle Pfade werden gegen Path Traversal und Verknüpfungen (Symlinks/Junctions) nach draußen geschützt.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { pipeline } = require('stream/promises');
const config = require('./config');
const { UserError, safeResolve, checkFileName, normalizeRel } = require('./util');

const MAX_EDIT = 1024 * 1024;
const MAX_UPLOAD = 2 * 1024 * 1024 * 1024;

/** Absoluter, geprüfter Pfad. "" oder "." bedeutet Server-Ordner. */
function resolve(rel = '') {
  const clean = normalizeRel(rel || '.');
  const base = config.get().serverDir;
  const abs = clean === '.' || clean === '' ? path.resolve(base) : safeResolve(base, clean);
  // Verknüpfungen: der echte Pfad muss ebenfalls im Server-Ordner liegen
  let probe = abs;
  while (!fs.existsSync(probe) && probe !== path.dirname(probe)) probe = path.dirname(probe);
  let realBase;
  let realProbe;
  try { realBase = fs.realpathSync(base); realProbe = fs.realpathSync(probe); } catch { return abs; }
  const r = path.relative(realBase, realProbe);
  if (r.startsWith('..') || path.isAbsolute(r)) throw new UserError('Zugriff verweigert: Der Pfad führt aus dem Server-Ordner hinaus.', 403);
  return abs;
}

const relOf = (abs) => normalizeRel(path.relative(config.get().serverDir, abs)) || '';

async function list(rel) {
  const abs = resolve(rel);
  let st;
  try { st = await fsp.stat(abs); } catch { throw new UserError('Ordner nicht gefunden.', 404); }
  if (!st.isDirectory()) throw new UserError('Das ist kein Ordner.');
  const names = await fsp.readdir(abs, { withFileTypes: true });
  const out = [];
  for (const e of names) {
    const s = await fsp.stat(path.join(abs, e.name)).catch(() => null);
    if (!s) continue;
    out.push({ name: e.name, dir: s.isDirectory(), size: s.isDirectory() ? null : s.size, mtime: s.mtimeMs });
  }
  out.sort((a, b) => (b.dir - a.dir) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return { path: relOf(abs), entries: out };
}

async function readText(rel) {
  const abs = resolve(rel);
  let st;
  try { st = await fsp.stat(abs); } catch { throw new UserError('Datei nicht gefunden.', 404); }
  if (!st.isFile()) throw new UserError('Das ist keine Datei.');
  if (st.size > MAX_EDIT) throw new UserError(`Die Datei ist zu groß zum Bearbeiten (${Math.round(st.size / 1024)} KB, erlaubt sind 1024 KB). Du kannst sie herunterladen.`, 413);
  const buf = await fsp.readFile(abs);
  if (buf.subarray(0, 8000).includes(0)) throw new UserError('Das ist keine Textdatei und lässt sich hier nicht bearbeiten. Du kannst sie herunterladen.', 415);
  return { path: relOf(abs), text: buf.toString('utf8').replace(/^﻿/, ''), size: st.size, mtime: st.mtimeMs };
}

async function writeText(rel, text) {
  if (typeof text !== 'string') throw new UserError('Ungültiger Inhalt.');
  if (Buffer.byteLength(text) > MAX_EDIT) throw new UserError('Der Text ist zu groß (mehr als 1024 KB).', 413);
  const abs = resolve(rel);
  if (abs === path.resolve(config.get().serverDir)) throw new UserError('Ungültiger Pfad.');
  const st = await fsp.stat(abs).catch(() => null);
  if (st && !st.isFile()) throw new UserError('Das ist keine Datei.');
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.dashtmp`;
  await fsp.writeFile(tmp, text, 'utf8');
  await fsp.rename(tmp, abs);
}

async function mkdir(rel) {
  const abs = resolve(rel);
  if (abs === path.resolve(config.get().serverDir)) throw new UserError('Ungültiger Pfad.');
  await fsp.mkdir(abs, { recursive: true });
}

async function remove(rel) {
  const abs = resolve(rel);
  if (abs === path.resolve(config.get().serverDir)) throw new UserError('Der Server-Ordner selbst kann hier nicht gelöscht werden.');
  if (!fs.existsSync(abs)) throw new UserError('Nicht gefunden.', 404);
  try {
    await fsp.rm(abs, { recursive: true, force: true });
  } catch (e) {
    if (['EBUSY', 'EPERM', 'EACCES'].includes(e.code)) throw new UserError('Die Datei ist gerade in Benutzung. Bitte zuerst den Server stoppen.', 409);
    throw e;
  }
}

async function rename(from, to) {
  const a = resolve(from);
  const b = resolve(to);
  if (a === path.resolve(config.get().serverDir) || b === path.resolve(config.get().serverDir)) throw new UserError('Ungültiger Pfad.');
  if (!fs.existsSync(a)) throw new UserError('Nicht gefunden.', 404);
  if (fs.existsSync(b)) throw new UserError('Am Ziel gibt es schon eine Datei mit diesem Namen.', 409);
  await fsp.mkdir(path.dirname(b), { recursive: true });
  try { await fsp.rename(a, b); } catch (e) {
    if (['EBUSY', 'EPERM', 'EACCES'].includes(e.code)) throw new UserError('Die Datei ist gerade in Benutzung. Bitte zuerst den Server stoppen.', 409);
    throw e;
  }
}

/** Speichert einen Upload-Stream als Datei im Ordner `dirRel`. */
async function upload(req, dirRel, fileName) {
  const name = checkFileName(fileName);
  const len = Number(req.headers['content-length']) || 0;
  if (len > MAX_UPLOAD) throw new UserError('Die Datei ist zu groß (mehr als 2 GB).', 413);
  const dir = resolve(dirRel);
  await fsp.mkdir(dir, { recursive: true });
  const dest = safeResolve(dir, name);
  resolve(path.relative(config.get().serverDir, dest)); // Verknüpfungs-Prüfung für das Ziel
  const tmp = `${dest}.part`;
  try {
    await pipeline(req, fs.createWriteStream(tmp));
    await fsp.rename(tmp, dest);
  } finally {
    await fsp.rm(tmp, { force: true }).catch(() => {});
  }
  return { path: relOf(dest) };
}

function downloadInfo(rel) {
  const abs = resolve(rel);
  let st;
  try { st = fs.statSync(abs); } catch { throw new UserError('Datei nicht gefunden.', 404); }
  if (!st.isFile()) throw new UserError('Ordner können nicht heruntergeladen werden. Nutze dafür ein Backup.');
  return { abs, name: path.basename(abs) };
}

module.exports = { list, readText, writeText, mkdir, remove, rename, upload, downloadInfo, resolve };
