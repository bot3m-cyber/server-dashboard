'use strict';
// Kennzahlen für die Übersicht (Weltgröße, letztes Backup, freier Speicher) und das Server-Icon.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const config = require('./config');
const backup = require('./backup');
const mods = require('./mods');
const { UserError, writeTextAtomic } = require('./util');

let sizeCache = { at: 0, key: '', bytes: 0 };

async function dirSize(dir, deadline) {
  let total = 0;
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    if (Date.now() > deadline) break;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(p, deadline);
    else if (e.isFile()) total += (await fsp.stat(p).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

async function summary() {
  const wn = backup.worldName();
  const wdir = config.serverPath(wn);
  const key = wdir;
  if (sizeCache.key !== key || Date.now() - sizeCache.at > 30000) {
    sizeCache = { at: Date.now(), key, bytes: fs.existsSync(wdir) ? await dirSize(wdir, Date.now() + 4000) : 0 };
  }
  const backups = await backup.list();
  let free = null;
  try { const s = await fsp.statfs(config.get().serverDir); free = s.bavail * s.bsize; } catch { /* nicht unterstützt */ }
  const list = await mods.list();
  return {
    world: wn, worldBytes: sizeCache.bytes, worldExists: fs.existsSync(wdir),
    lastBackup: backups[0] || null, backupCount: backups.length,
    modsActive: list.filter((m) => m.enabled).length, modsTotal: list.length, freeBytes: free,
  };
}

function iconPath() {
  return config.serverPath('server-icon.png');
}

/** Prüft ein PNG (Signatur + Größe 64x64), wie es Minecraft verlangt. */
function saveIcon(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 33 || buf.length > 300 * 1024) throw new UserError('Bitte ein PNG-Bild (höchstens 300 KB) wählen.');
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 8).equals(sig)) throw new UserError('Das ist kein PNG-Bild.');
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  if (w !== 64 || h !== 64) throw new UserError(`Das Bild muss genau 64 × 64 Pixel groß sein (deins: ${w} × ${h}).`);
  fs.mkdirSync(config.get().serverDir, { recursive: true });
  const tmp = `${iconPath()}.tmp`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, iconPath());
}

module.exports = { summary, iconPath, saveIcon, writeTextAtomic };
