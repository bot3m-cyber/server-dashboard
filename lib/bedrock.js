'use strict';
// Bedrock-Support: Geyser + Floodgate. Mods (NeoForge/Fabric) kommen von Modrinth,
// bei Plugin-Servern (Paper/Purpur) kommt Floodgate von GeyserMC.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const config = require('./config');
const mods = require('./mods');
const modinstall = require('./modinstall');
const { downloadVerified, UA } = require('./download');
const { UserError, writeTextAtomic, netError } = require('./util');

const SLUGS = ['geyser', 'floodgate'];
const AUTH_TYPES = ['online', 'offline', 'floodgate'];
const isPlugins = () => require('./servertypes').TYPES[config.get().type]?.kind === 'plugins';

function geyserConfigFile() {
  for (const base of ['config', 'plugins']) {
    let root;
    try { root = config.serverPath(base); } catch { continue; }
    let dirs = [];
    try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && /^geyser/i.test(d.name)); } catch { continue; }
    for (const d of dirs) {
      const f = path.join(root, d.name, 'config.yml');
      if (fs.existsSync(f)) return f;
    }
  }
  return null;
}

function readConfig() {
  const f = geyserConfigFile();
  if (!f) return null;
  const text = fs.readFileSync(f, 'utf8');
  const auth = text.match(/^\s*auth-type:\s*["']?([a-z]+)["']?/m);
  const bedrock = text.match(/^bedrock:\s*\r?\n(?:[ \t]+.*\r?\n|\r?\n)*?[ \t]+port:\s*(\d+)/m);
  return { file: f, text, authType: auth ? auth[1] : null, port: bedrock ? Number(bedrock[1]) : 19132 };
}

async function status() {
  const list = await mods.list();
  const find = (re) => list.find((m) => re.test(m.file));
  const g = find(/geyser/i);
  const f = find(/floodgate/i);
  const c = readConfig();
  return {
    geyser: g ? { file: g.file, enabled: g.enabled } : null,
    floodgate: f ? { file: f.file, enabled: f.enabled } : null,
    configFound: !!c,
    authType: c?.authType || null,
    port: c?.port || 19132,
    supported: config.get().type !== 'vanilla',
    kind: isPlugins() ? 'plugins' : 'mods',
  };
}

/** Floodgate für Plugin-Server: Download von GeyserMC (auf Modrinth gibt es nur Fabric/NeoForge). */
async function installFloodgatePlugin(ctx) {
  const base = 'https://download.geysermc.org/v2/projects/floodgate/versions/latest/builds/latest';
  let info;
  try {
    const res = await fetch(base, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new UserError(`GeyserMC antwortet mit Fehler ${res.status}.`, 502);
    info = await res.json();
  } catch (e) {
    throw e.userFacing ? e : netError(e, 'download.geysermc.org');
  }
  const d = info.downloads?.spigot;
  if (!d) throw new UserError('GeyserMC liefert kein Floodgate für Paper/Spigot.');
  const dir = mods.modsDir();
  await fsp.mkdir(dir, { recursive: true });
  const dest = path.join(dir, 'floodgate-spigot.jar');
  ctx.log(`Lade Floodgate ${info.version || ''} …`);
  await downloadVerified([`${base}/downloads/spigot`], dest, { sha256: d.sha256, allowedHosts: new Set(['download.geysermc.org']), label: 'floodgate-spigot.jar' });
  ctx.log('✓ floodgate-spigot.jar');
  const ex = config.get().excludes;
  const hit = ex.filter((e) => /floodgate/i.test(e));
  if (hit.length) config.update({ excludes: ex.filter((e) => !hit.includes(e)) });
}

async function install(ctx) {
  if (isPlugins()) {
    await modinstall.installFromModrinth(['geyser'], ctx);
    await installFloodgatePlugin(ctx);
    return;
  }
  await modinstall.installFromModrinth(SLUGS, ctx);
}

/** Setzt den Bedrock-Port (UDP) in der Geyser-Config. Tut nichts, solange Geyser noch keine Config angelegt hat. */
function setPort(port) {
  const c = readConfig();
  if (!c || !Number.isInteger(port)) return false;
  const re = /(^bedrock:\s*\r?\n(?:[ \t]+.*\r?\n|\r?\n)*?[ \t]+port:\s*)\d+/m;
  if (!re.test(c.text) || c.port === port) return false;
  writeTextAtomic(c.file, c.text.replace(re, `$1${port}`));
  return true;
}

function setAuthType(type) {
  if (!AUTH_TYPES.includes(type)) throw new UserError('Unbekannter Anmeldetyp.');
  const c = readConfig();
  if (!c) throw new UserError('Die Geyser-Einstellungen gibt es noch nicht. Bitte den Server einmal starten, damit Geyser sie anlegt.');
  if (!c.authType) throw new UserError('In der Geyser-Config wurde „auth-type“ nicht gefunden.');
  writeTextAtomic(c.file, c.text.replace(/^(\s*auth-type:\s*).*$/m, `$1${type}`));
}

module.exports = { SLUGS, status, setAuthType, setPort, install };
