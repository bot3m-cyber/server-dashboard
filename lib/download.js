'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { once } = require('events');
const { UserError, sleep, netError } = require('./util');

const UA = 'minecraft-server-dashboard/1.0 (lokale Anwendung)';
// Erlaubte Download-Quellen laut Modrinth-.mrpack-Spezifikation
const MRPACK_HOSTS = new Set(['cdn.modrinth.com', 'github.com', 'raw.githubusercontent.com', 'gitlab.com']);

/**
 * Lädt eine URL nach `dest` herunter (über eine .part-Datei) und prüft optional sha1/sha512.
 * Meldet Bytes über onBytes(n); bei einem Fehlversuch wird die Zahl wieder abgezogen (negativ).
 */
async function downloadOnce(url, dest, { sha1, sha512, sha256, md5, onBytes, onTotal, label }) {
  const tmp = dest + '.part';
  const ctrl = new AbortController();
  let idle = setTimeout(() => ctrl.abort(), 60000);
  const kick = () => { clearTimeout(idle); idle = setTimeout(() => ctrl.abort(), 60000); };
  let counted = 0;
  const name = label || path.basename(dest);
  try {
    let res;
    try {
      res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal, redirect: 'follow' });
    } catch (e) {
      throw netError(e);
    }
    if (res.status === 404) throw new UserError(`Datei nicht gefunden (HTTP 404): ${name}`, 502);
    if (!res.ok) throw new UserError(`Download fehlgeschlagen (HTTP ${res.status}): ${name}`, 502);
    const len = Number(res.headers.get('content-length')) || 0;
    if (onTotal && len) onTotal(len);
    const h1 = crypto.createHash('sha1');
    const h512 = crypto.createHash('sha512');
    const h256 = crypto.createHash('sha256');
    const hmd5 = crypto.createHash('md5');
    const ws = fs.createWriteStream(tmp);
    try {
      for await (const chunk of res.body) {
        kick();
        h1.update(chunk);
        h512.update(chunk);
        h256.update(chunk);
        hmd5.update(chunk);
        counted += chunk.length;
        if (onBytes) onBytes(chunk.length);
        if (!ws.write(chunk)) await once(ws, 'drain');
      }
      ws.end();
      await once(ws, 'finish');
    } catch (e) {
      ws.destroy();
      throw netError(e);
    }
    const d1 = h1.digest('hex');
    const d512 = h512.digest('hex');
    const d256 = h256.digest('hex');
    const dmd5 = hmd5.digest('hex');
    if ((sha1 && d1 !== sha1.toLowerCase()) || (sha512 && d512 !== sha512.toLowerCase())
      || (sha256 && d256 !== sha256.toLowerCase()) || (md5 && dmd5 !== md5.toLowerCase())) {
      throw new UserError(`Download beschädigt: Die Prüfsumme von ${name} stimmt nicht.`, 502, 'HASH');
    }
    await fsp.rename(tmp, dest);
  } catch (e) {
    if (onBytes && counted) onBytes(-counted);
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw e;
  } finally {
    clearTimeout(idle);
  }
}

/** Probiert alle URLs mit je 3 Versuchen. Nur erlaubte Hosts (HTTPS). */
async function downloadVerified(urls, dest, opts = {}) {
  const allowed = opts.allowedHosts || MRPACK_HOSTS;
  let lastErr = new UserError(`Keine Download-Adresse für ${path.basename(dest)} vorhanden.`);
  for (const url of urls) {
    let u;
    try { u = new URL(url); } catch { continue; }
    if (u.protocol !== 'https:' || !allowed.has(u.hostname)) {
      lastErr = new UserError(`Download-Adresse nicht erlaubt (${u.hostname}): ${path.basename(dest)}`);
      continue;
    }
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await downloadOnce(url, dest, opts);
        return;
      } catch (e) {
        lastErr = e;
        if (e.status === 404) break;
        if (attempt < 3) await sleep(1000 * attempt);
      }
    }
  }
  throw lastErr;
}

module.exports = { downloadVerified, UA, MRPACK_HOSTS };
