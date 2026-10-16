'use strict';
// Server-Typen (Vanilla, Paper, Purpur, Fabric, NeoForge, Modpack): Versionslisten, Downloads, Installation.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const config = require('./config');
const { downloadVerified, UA } = require('./download');
const { UserError, netError, formatBytes } = require('./util');

const TYPES = {
  modpack: { label: 'Modpack (Modrinth)', desc: 'Fertiges Modpack als .mrpack, z. B. „Create Live“', kind: 'mods', loaders: ['neoforge'], versions: false },
  paper: { label: 'Paper', desc: 'Schneller Server für Plugins. Beliebt für Survival und Freunde', kind: 'plugins', loaders: ['paper', 'spigot', 'bukkit'], versions: true, aikar: true },
  purpur: { label: 'Purpur', desc: 'Paper mit vielen Extra-Einstellungen', kind: 'plugins', loaders: ['purpur', 'paper', 'spigot', 'bukkit'], versions: true, aikar: true },
  fabric: { label: 'Fabric', desc: 'Leichtgewichtiger Mod-Server', kind: 'mods', loaders: ['fabric'], versions: true },
  neoforge: { label: 'NeoForge', desc: 'Mod-Server für NeoForge-Mods (ohne Modpack)', kind: 'mods', loaders: ['neoforge'], versions: true },
  vanilla: { label: 'Vanilla', desc: 'Der originale Minecraft-Server ohne Mods', kind: 'none', loaders: [], versions: true },
};

const HOSTS = new Set([
  'piston-data.mojang.com', 'fill-data.papermc.io', 'api.purpurmc.org', 'meta.fabricmc.net', 'maven.neoforged.net',
  'download.geysermc.org', 'cdn.modrinth.com',
]);

const cache = new Map();
async function cached(key, ttlMs, fn) {
  const c = cache.get(key);
  if (c && Date.now() - c.at < ttlMs) return c.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function getJson(url) {
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  } catch (e) {
    throw netError(e, 'dem Versions-Server');
  }
  if (!res.ok) throw new UserError(`Der Versions-Server antwortet mit Fehler ${res.status} (${new URL(url).hostname}).`, 502);
  return res.json();
}

/** Versionsnummern vergleichen: "1.21.10" > "1.21.9", "26.3" > "1.21.11". */
function compareVersions(a, b) {
  const pa = String(a).split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : -1));
  const pb = String(b).split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : -1));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? -2) - (pb[i] ?? -2);
    if (d) return d;
  }
  return 0;
}

// ---------------------------------------------------------------- Mojang

const manifest = () => cached('mojang', 10 * 60e3, () => getJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'));

async function mojangVersion(mc) {
  const m = await manifest();
  const entry = m.versions.find((v) => v.id === mc);
  if (!entry) return null;
  return cached(`mojang:${mc}`, 60 * 60e3, () => getJson(entry.url));
}

function guessJava(mc) {
  const m = /^1\.(\d+)(?:\.(\d+))?/.exec(mc);
  if (!m) return 25; // neues Versionsschema (26.x)
  const minor = Number(m[1]);
  const patch = Number(m[2] || 0);
  if (minor > 20 || (minor === 20 && patch >= 5)) return 21;
  if (minor >= 17) return 17;
  return 8;
}

/** Welche Java-Hauptversion braucht diese Minecraft-Version? */
async function javaMajorFor(mc) {
  try {
    const v = await mojangVersion(mc);
    if (v?.javaVersion?.majorVersion) return v.javaVersion.majorVersion;
  } catch { /* offline: Schätzung */ }
  return guessJava(mc);
}

// ---------------------------------------------------------------- NeoForge (Maven)

function neoMc(v) {
  const p = v.replace(/-.*$/, '').split('.').map(Number);
  if (p.some(Number.isNaN)) return null;
  if (p[0] >= 25) return p[2] ? `${p[0]}.${p[1]}.${p[2]}` : `${p[0]}.${p[1]}`; // z. B. 26.1.2.115 -> 26.1.2
  return p[1] ? `1.${p[0]}.${p[1]}` : `1.${p[0]}`; // z. B. 21.1.221 -> 1.21.1
}

async function neoforgeVersions() {
  return cached('neoforge', 10 * 60e3, async () => {
    let res;
    try { res = await fetch('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml', { signal: AbortSignal.timeout(20000) }); } catch (e) { throw netError(e, 'maven.neoforged.net'); }
    if (!res.ok) throw new UserError(`maven.neoforged.net antwortet mit Fehler ${res.status}.`, 502);
    const xml = await res.text();
    const out = {};
    for (const m of xml.matchAll(/<version>([^<]+)<\/version>/g)) {
      const mc = neoMc(m[1]);
      if (mc) (out[mc] = out[mc] || []).push(m[1]);
    }
    for (const list of Object.values(out)) list.sort(compareVersions);
    return out;
  });
}

// ---------------------------------------------------------------- Versionslisten

const UNSTABLE_RE = /(rc|pre|snapshot|alpha|beta)/i;

/** [{ id, stable }] neueste zuerst. */
async function listVersions(type, snapshots = false) {
  if (!TYPES[type] || !TYPES[type].versions) throw new UserError('Für diesen Typ gibt es keine Versionsliste.');
  let items;
  if (type === 'vanilla') {
    const m = await manifest();
    items = m.versions.map((v) => ({ id: v.id, stable: v.type === 'release' }));
  } else if (type === 'paper') {
    const r = await cached('paper', 10 * 60e3, () => getJson('https://fill.papermc.io/v3/projects/paper'));
    items = Object.values(r.versions).flat().map((id) => ({ id, stable: !UNSTABLE_RE.test(id) }));
  } else if (type === 'purpur') {
    const r = await cached('purpur', 10 * 60e3, () => getJson('https://api.purpurmc.org/v2/purpur'));
    items = [...r.versions].reverse().map((id) => ({ id, stable: !UNSTABLE_RE.test(id) }));
  } else if (type === 'fabric') {
    const r = await cached('fabric-game', 10 * 60e3, () => getJson('https://meta.fabricmc.net/v2/versions/game'));
    items = r.map((v) => ({ id: v.version, stable: !!v.stable }));
  } else {
    const r = await neoforgeVersions();
    items = Object.entries(r).map(([mc, vs]) => ({ id: mc, stable: vs.some((v) => !/beta|alpha/i.test(v)) }))
      .sort((a, b) => compareVersions(b.id, a.id));
  }
  return snapshots ? items : items.filter((i) => i.stable);
}

// ---------------------------------------------------------------- Download-Quellen

/** Liefert { url, name, sha1?, sha256?, md5?, loaderVersion?, note? } für Typ + Minecraft-Version. */
async function resolveDownload(type, mc) {
  if (!/^[0-9A-Za-z._-]{1,40}$/.test(mc || '')) throw new UserError('Ungültige Minecraft-Version.');
  if (type === 'vanilla') {
    const v = await mojangVersion(mc);
    if (!v) throw new UserError(`Minecraft ${mc} gibt es nicht.`);
    const s = v.downloads?.server;
    if (!s) throw new UserError(`Für Minecraft ${mc} gibt es keinen Server-Download.`);
    return { url: s.url, name: 'server.jar', sha1: s.sha1 };
  }
  if (type === 'paper') {
    const builds = await getJson(`https://fill.papermc.io/v3/projects/paper/versions/${encodeURIComponent(mc)}/builds`);
    if (!Array.isArray(builds) || !builds.length) throw new UserError(`Für Paper gibt es keine Builds für ${mc}.`);
    const b = builds.find((x) => x.channel === 'STABLE') || builds[0];
    const d = b.downloads?.['server:default'];
    if (!d) throw new UserError('Paper liefert keinen Server-Download für diese Version.');
    return { url: d.url, name: 'server.jar', sha256: d.checksums?.sha256, loaderVersion: String(b.id), note: b.channel === 'STABLE' ? null : `Build ${b.id} ist als ${String(b.channel).toLowerCase()} markiert` };
  }
  if (type === 'purpur') {
    const b = await getJson(`https://api.purpurmc.org/v2/purpur/${encodeURIComponent(mc)}/latest`);
    return { url: `https://api.purpurmc.org/v2/purpur/${encodeURIComponent(mc)}/${b.build}/download`, name: 'server.jar', md5: b.md5, loaderVersion: String(b.build) };
  }
  if (type === 'fabric') {
    const [loaders, installers] = await Promise.all([
      cached('fabric-loader', 10 * 60e3, () => getJson('https://meta.fabricmc.net/v2/versions/loader')),
      cached('fabric-installer', 10 * 60e3, () => getJson('https://meta.fabricmc.net/v2/versions/installer')),
    ]);
    const l = loaders.find((x) => x.stable) || loaders[0];
    const i = installers.find((x) => x.stable) || installers[0];
    return { url: `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mc)}/${l.version}/${i.version}/server/jar`, name: 'server.jar', loaderVersion: l.version };
  }
  if (type === 'neoforge') {
    const vs = (await neoforgeVersions())[mc];
    if (!vs?.length) throw new UserError(`Für NeoForge gibt es keine Version für Minecraft ${mc}.`);
    const v = [...vs].reverse().find((x) => !/beta|alpha/i.test(x)) || vs[vs.length - 1];
    return { loaderVersion: v };
  }
  throw new UserError('Unbekannter Server-Typ.');
}

/** Installiert den Server des aktiven Profils (Download der JAR bzw. NeoForge-Installer). */
async function installServer(ctx) {
  const setup = require('./setup'); // erst hier, wegen gegenseitiger Abhängigkeit
  const cfg = config.get();
  if (cfg.type === 'modpack') throw new UserError('Ein Modpack-Server wird über die Einrichtung (Schritte 1 bis 3) installiert.');
  if (!cfg.mcVersion) throw new UserError('Für diesen Server ist keine Minecraft-Version festgelegt.');
  const dl = await resolveDownload(cfg.type, cfg.mcVersion);
  const sd = setup.ensureServerDir();
  if (dl.note) ctx.log(`Hinweis: ${dl.note}.`);
  if (cfg.type === 'neoforge') {
    config.update({ loaderVersion: dl.loaderVersion, installed: false });
    ctx.log(`NeoForge ${dl.loaderVersion} für Minecraft ${cfg.mcVersion}`);
    return setup.installNeoForge(ctx);
  }
  const dest = path.join(sd, dl.name);
  ctx.log(`Lade ${TYPES[cfg.type].label} ${cfg.mcVersion}${dl.loaderVersion ? ` (${dl.loaderVersion})` : ''} …`);
  let total = 0;
  let done = 0;
  await downloadVerified([dl.url], dest, {
    sha1: dl.sha1, sha256: dl.sha256, md5: dl.md5, allowedHosts: HOSTS, label: dl.name,
    onTotal: (t) => { total = t; },
    onBytes: (n) => { done += n; ctx.progress(done, total || done, `${formatBytes(done)}${total ? ` von ${formatBytes(total)}` : ''}`); },
  });
  config.update({ jar: dl.name, loaderVersion: dl.loaderVersion || null, installed: true });
  // Aikar-Startparameter sind für Paper/Purpur sinnvoll
  if (TYPES[cfg.type].aikar && cfg.aikar === undefined) config.update({ aikar: true });
  ctx.log(`Fertig: ${dl.name} (${formatBytes(fs.statSync(dest).size)})`);
  return { jar: dl.name };
}

const AIKAR_FLAGS = [
  '-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled', '-XX:MaxGCPauseMillis=200', '-XX:+UnlockExperimentalVMOptions',
  '-XX:+DisableExplicitGC', '-XX:G1NewSizePercent=30', '-XX:G1MaxNewSizePercent=40', '-XX:G1HeapRegionSize=8M',
  '-XX:G1ReservePercent=20', '-XX:G1HeapWastePercent=5', '-XX:G1MixedGCCountTarget=4',
  '-XX:InitiatingHeapOccupancyPercent=15', '-XX:G1MixedGCLiveThresholdPercent=90',
  '-XX:G1RSetUpdatingPauseTimePercent=5', '-XX:SurvivorRatio=32', '-XX:+PerfDisableSharedMem', '-XX:MaxTenuringThreshold=1',
];

module.exports = {
  neoMc, TYPES, HOSTS, listVersions, resolveDownload, installServer, javaMajorFor, compareVersions, AIKAR_FLAGS, fsp,
};
