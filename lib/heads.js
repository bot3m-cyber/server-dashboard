'use strict';
// Spieler-Köpfe von mc-heads.net, einmal geladen und lokal in data/heads gespeichert.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const config = require('./config');
const { downloadVerified } = require('./download');

const DIR = path.join(config.DATA_DIR, 'heads');
const TTL_MS = 24 * 3600e3;
const HOSTS = new Set(['mc-heads.net']);
const inflight = new Map();

/** Liefert den Pfad zum Kopf-Bild oder null (z. B. offline und noch nie geladen). */
async function get(name) {
  const key = name.toLowerCase();
  const file = path.join(DIR, `${key}.png`);
  const st = await fsp.stat(file).catch(() => null);
  if (st && Date.now() - st.mtimeMs < TTL_MS) return file;
  if (!inflight.has(key)) {
    inflight.set(key, (async () => {
      await fsp.mkdir(DIR, { recursive: true });
      try {
        await downloadVerified([`https://mc-heads.net/avatar/${encodeURIComponent(name)}/64`], file, { allowedHosts: HOSTS, label: `${name}.png` });
        return file;
      } catch {
        return st ? file : null; // alter Kopf ist besser als keiner
      } finally {
        inflight.delete(key);
      }
    })());
  }
  return inflight.get(key);
}

module.exports = { get };
