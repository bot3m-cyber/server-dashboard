'use strict';
// Grenzen pro Benutzer (Anzahl Server, RAM, Speicherplatz) und das gemeinsame RAM-Budget des Servers.
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const config = require('./config');
const users = require('./users');
const hosted = require('./hosted');
const { UserError, formatBytes } = require('./util');

const GIB = 1024 ** 3;
const diskCache = new Map(); // Benutzer-ID -> { at, bytes }

const owned = (userId) => config.list().filter((p) => p.ownerId === userId);

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

/** Belegter Speicherplatz aller Server des Benutzers (60 Sekunden zwischengespeichert). */
async function diskBytes(userId, force = false) {
  const c = diskCache.get(userId);
  if (!force && c && Date.now() - c.at < 60000) return c.bytes;
  let bytes = 0;
  const deadline = Date.now() + 8000;
  for (const p of owned(userId)) if (p.serverDir) bytes += await dirSize(p.serverDir, deadline);
  diskCache.set(userId, { at: Date.now(), bytes });
  return bytes;
}

const invalidateDisk = (userId) => diskCache.delete(userId);

/** Insgesamt für Minecraft-Server nutzbarer Arbeitsspeicher in GB. */
function budgetGb() {
  const s = hosted.get();
  const total = s.totalRamGb || Math.floor(os.totalmem() / GIB);
  return Math.max(1, total - (s.reserveRamGb || 0));
}

/** RAM (Xmx), den laufende Server zusammen reservieren. Optional ohne einen bestimmten Server. */
function runningRamGb({ exceptId = null, userId = null } = {}) {
  const registry = require('./mc');
  let sum = 0;
  for (const inst of registry.all()) {
    if (!inst.isRunning() || inst.id === exceptId) continue;
    let p;
    try { p = config.get(inst.id); } catch { continue; }
    if (userId && p.ownerId !== userId) continue;
    sum += p.xmxGb || 0;
  }
  return sum;
}

async function usage(user) {
  const mine = owned(user.id);
  const q = users.effectiveQuota(user);
  return {
    quota: q,
    servers: mine.length,
    ramAllocatedGb: mine.reduce((a, p) => a + (p.xmxGb || 0), 0),
    ramRunningGb: runningRamGb({ userId: user.id }),
    diskBytes: await diskBytes(user.id),
    budgetGb: budgetGb(),
    runningTotalGb: runningRamGb(),
  };
}

function assertCanCreate(user, ramGb) {
  if (!user) return;
  const q = users.effectiveQuota(user);
  if (owned(user.id).length >= q.maxServers) {
    throw new UserError(`Du hast die Höchstzahl von ${q.maxServers} Server${q.maxServers === 1 ? '' : 'n'} erreicht. Lösche einen Server, um einen neuen anzulegen.`, 403);
  }
  if (ramGb != null) assertRamSetting(user, ramGb);
}

/** Darf ein einzelner Server so viel RAM bekommen? */
function assertRamSetting(user, xmxGb) {
  if (!user) return;
  const q = users.effectiveQuota(user);
  if (xmxGb > q.maxRamGb) throw new UserError(`Pro Server sind für dich höchstens ${q.maxRamGb} GB RAM erlaubt.`, 403);
  if (xmxGb > budgetGb()) throw new UserError(`Dieser Server hat insgesamt nur ${budgetGb()} GB RAM für Minecraft zur Verfügung.`, 403);
}

async function assertDisk(userOrId, addBytes = 0) {
  const user = typeof userOrId === 'string' ? users.byId(userOrId) : userOrId;
  if (!user) return;
  const q = users.effectiveQuota(user);
  const used = await diskBytes(user.id);
  if (used + addBytes > q.maxDiskGb * GIB) {
    throw new UserError(`Dein Speicherplatz ist voll (${formatBytes(used)} von ${q.maxDiskGb} GB). Lösche alte Backups oder Dateien.`, 403);
  }
}

module.exports = { usage, assertCanCreate, assertRamSetting, assertDisk, diskBytes, invalidateDisk, budgetGb, runningRamGb, owned };
