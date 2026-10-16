'use strict';
// Mod-Infos (Titel, Logo, Client/Server-Tauglichkeit) per Datei-Hash bei Modrinth nachschlagen.
// Die Logos werden einmal geladen und lokal in data/icons gespeichert.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const config = require('./config');
const mods = require('./mods');
const modrinth = require('./modrinth');
const events = require('./events');
const { downloadVerified } = require('./download');
const { readJson, writeJsonAtomic, hashFile, UserError } = require('./util');

const ICON_DIR = path.join(config.DATA_DIR, 'icons');
const META_FILE = path.join(config.DATA_DIR, 'modmeta.json');
const RETRY_MS = 24 * 3600e3;

let meta = null; // { hashes: { sha1: {...}|null }, misses: { sha1: time } }
const hashCache = new Map(); // abs -> { key, sha1 }
let running = null;

function load() {
  if (!meta) meta = Object.assign({ hashes: {}, misses: {} }, readJson(META_FILE, {}));
  return meta;
}

async function jarHashes() {
  const dir = mods.modsDir();
  let names = [];
  try { names = await fsp.readdir(dir); } catch { return []; }
  const out = [];
  for (const n of names) {
    if (!/\.jar(\.disabled)?$/i.test(n)) continue;
    const abs = path.join(dir, n);
    const st = await fsp.stat(abs).catch(() => null);
    if (!st) continue;
    const key = `${st.size}|${st.mtimeMs}`;
    let c = hashCache.get(abs);
    if (!c || c.key !== key) {
      c = { key, sha1: (await hashFile(abs, ['sha1'])).sha1 };
      hashCache.set(abs, c);
    }
    out.push({ file: n.replace(/\.disabled$/i, ''), sha1: c.sha1 });
  }
  return out;
}

async function saveIcon(pid, url) {
  if (!url || !/^https:\/\/cdn\.modrinth\.com\//.test(url)) return null;
  const ext = (path.extname(new URL(url).pathname) || '.png').toLowerCase();
  if (!/^\.(png|jpe?g|webp|gif)$/.test(ext)) return null;
  const name = `${pid}${ext}`;
  const dest = path.join(ICON_DIR, name);
  if (fs.existsSync(dest)) return name;
  await fsp.mkdir(ICON_DIR, { recursive: true });
  try {
    await downloadVerified([url], dest, { label: name });
    return name;
  } catch {
    return null;
  }
}

/** Fragt Modrinth nach allen noch unbekannten Mods (läuft im Hintergrund). */
async function refresh() {
  if (running) return running;
  let changed = false;
  running = (async () => {
    const m = load();
    const jars = await jarHashes();
    const todo = [...new Set(jars.map((j) => j.sha1))]
      .filter((h) => !(h in m.hashes) && !(m.misses[h] && Date.now() - m.misses[h] < RETRY_MS));
    if (!todo.length) return;
    const versions = {};
    for (let i = 0; i < todo.length; i += 100) Object.assign(versions, await modrinth.versionsBySha1(todo.slice(i, i + 100)));
    const pids = [...new Set(Object.values(versions).map((v) => v.project_id))];
    const projects = await modrinth.projects(pids);
    const icons = {};
    const queue = pids.filter((p) => projects[p]);
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (queue.length) {
        const pid = queue.shift();
        icons[pid] = await saveIcon(pid, projects[pid].icon_url);
      }
    }));
    for (const h of todo) {
      const v = versions[h];
      const p = v && projects[v.project_id];
      if (!p) { m.misses[h] = Date.now(); continue; }
      m.hashes[h] = {
        pid: p.id, slug: p.slug, title: p.title, icon: icons[p.id] || null,
        client: p.client_side, server: p.server_side,
        mcs: v.game_versions || [], loaders: v.loaders || [],
      };
    }
    writeJsonAtomic(META_FILE, m);
    changed = true;
  })().catch((e) => { console.error('Mod-Infos:', e.message); }).finally(() => {
    running = null;
    if (changed) events.broadcast('modmeta', {}); // nur bei neuen Infos, sonst gäbe es eine Endlosschleife
  });
  return running;
}

/** Dateiname -> Infos (nur das, was schon bekannt ist). */
async function forFiles() {
  const m = load();
  const out = {};
  for (const j of await jarHashes()) {
    const x = m.hashes[j.sha1];
    if (x) out[j.file.toLowerCase()] = { ...x, iconUrl: x.icon ? `/icons/${x.icon}` : null };
  }
  return out;
}

function isPending() {
  return !!running;
}

/**
 * "Mods verbessern": deaktiviert reine Client-Mods und Mods von der Ausschlussliste.
 * Mods, die laut Modrinth nicht zur Minecraft-Version/NeoForge passen, werden nur gemeldet.
 */
async function improve(apply) {
  await refresh();
  const info = await forFiles();
  const cfg = config.get();
  const mc = cfg.mcVersion || cfg.pack?.minecraft;
  const loaders = require('./servertypes').TYPES[cfg.type]?.loaders || ['neoforge'];
  const result = { clientOnly: [], excluded: [], mismatch: [], unknown: [], changed: [] };
  for (const mod of await mods.list()) {
    const meta1 = info[mod.file.toLowerCase()];
    const label = meta1?.title ? `${meta1.title} (${mod.file})` : mod.file;
    if (!meta1) { if (mod.enabled) result.unknown.push(mod.file); continue; }
    if (!mod.enabled) continue;
    if (mod.excluded) result.excluded.push({ file: mod.file, label });
    else if (meta1.server === 'unsupported') result.clientOnly.push({ file: mod.file, label });
    else if (mc && (!meta1.mcs.includes(mc) || !loaders.some((l) => meta1.loaders.includes(l)))) {
      result.mismatch.push({ file: mod.file, label, mcs: meta1.mcs.slice(-3) });
    }
  }
  if (apply) {
    for (const x of [...result.excluded, ...result.clientOnly]) {
      await mods.setEnabled(x.file, false);
      result.changed.push(x.file);
    }
  }
  return result;
}

module.exports = { refresh, forFiles, improve, isPending, jarHashes, ICON_DIR };
