'use strict';
// Server-Profile: anlegen, wechseln, umbenennen, löschen und die Version eines Servers wechseln.
// Es läuft immer genau ein Server (das aktive Profil). Die anderen sind gespeichert und jederzeit wählbar.
const fs = require('fs');
const path = require('path');
const config = require('./config');
const ctx = require('./context');
const hosted = require('./hosted');
const users = require('./users');
const quota = require('./quota');
const setup = require('./setup');
const serverTypes = require('./servertypes');
const backup = require('./backup');
const { UserError } = require('./util');

const MARKER = '.server-dashboard';

function eulaOf(p) {
  try { return /^\s*eula\s*=\s*true\s*$/mi.test(fs.readFileSync(path.join(p.serverDir, 'eula.txt'), 'utf8')); } catch { return false; }
}

/** Ist dieses (nicht unbedingt aktive) Profil fertig eingerichtet? */
function isComplete(p) {
  if (!p.serverDir || !fs.existsSync(p.serverDir)) return false;
  let installed;
  if (p.type === 'modpack') {
    const v = setup.neoVersion(p);
    installed = !!p.pack && !!p.installedPackKey && !!v && fs.existsSync(path.join(p.serverDir, setup.argsFileRel(v)));
  } else if (p.type === 'neoforge') {
    const v = setup.neoVersion(p);
    installed = !!v && fs.existsSync(path.join(p.serverDir, setup.argsFileRel(v)));
  } else {
    installed = !!p.jar && fs.existsSync(path.join(p.serverDir, p.jar));
  }
  return installed && eulaOf(p);
}

function isRunning(id) {
  return require('./mc').all().some((i) => i.id === id && i.isRunning());
}

function summary(p) {
  const t = serverTypes.TYPES[p.type] || serverTypes.TYPES.modpack;
  const h = hosted.enabled();
  return {
    id: p.id, name: p.name, type: p.type, typeLabel: t.label, kind: t.kind,
    mcVersion: p.mcVersion || p.pack?.minecraft || null, loaderVersion: p.loaderVersion,
    packName: p.pack?.name || null, serverDir: h ? null : p.serverDir, complete: isComplete(p),
    active: h ? p.id === ctx.id() : p.id === config.activeId(), running: isRunning(p.id), createdAt: p.createdAt,
    port: h ? p.port : null, bedrockPort: h ? p.bedrockPort : null, ownerId: h ? p.ownerId : null,
  };
}

function list() {
  return config.listFor(ctx.user()).map((p) => summary(p));
}

function cleanName(name) {
  const n = String(name || '').replace(/[\r\n\t]+/g, ' ').trim();
  if (!n || n.length > 40) throw new UserError('Bitte einen Namen mit 1 bis 40 Zeichen angeben.');
  return n;
}

/** Legt ein Profil an (ohne es zu installieren). */
async function create({ name, type, mcVersion, ramGb }) {
  const t = serverTypes.TYPES[type];
  if (!t) throw new UserError('Unbekannter Server-Typ.');
  const user = hosted.enabled() ? ctx.user() : null;
  if (hosted.enabled() && !user) throw new UserError('Bitte melde dich an.', 401);
  const cfg = { name: cleanName(name), type };
  if (user) cfg.ownerId = user.id;
  if (t.versions) {
    if (!/^[0-9A-Za-z._-]{1,40}$/.test(mcVersion || '')) throw new UserError('Bitte eine Minecraft-Version wählen.');
    cfg.mcVersion = mcVersion;
    cfg.javaMajor = await serverTypes.javaMajorFor(mcVersion);
  }
  if (t.aikar) cfg.aikar = true;
  if (ramGb != null) {
    const g = Number(ramGb);
    if (!Number.isInteger(g) || g < 1 || g > 64) throw new UserError('Ungültige RAM-Größe.');
    cfg.xmxGb = Math.max(2, g);
    cfg.xmsGb = Math.min(2, cfg.xmxGb);
  } else if (user) {
    cfg.xmxGb = Math.max(2, Math.min(cfg.xmxGb || 6, users.effectiveQuota(user).maxRamGb, quota.budgetGb())); // Standardwert innerhalb der Grenzen halten
    cfg.xmsGb = Math.min(cfg.xmsGb || 2, cfg.xmxGb);
  }
  if (user) {
    quota.assertCanCreate(user, cfg.xmxGb ?? 6);
    await quota.assertDisk(user);
  }
  return config.add(cfg);
}

function accessible(id) {
  const p = config.list().find((s) => s.id === id);
  if (!p || !config.canAccess(ctx.user(), p)) throw new UserError('Server nicht gefunden.', 404);
  return p;
}

function rename(id, name) {
  const p = accessible(id);
  const clean = cleanName(name);
  config.update({ name: clean }, p.id);
}

/** Entfernt ein Profil. Mit deleteFiles wird auch der Server-Ordner gelöscht (nur wenn er vom Dashboard stammt). */
function remove(id, deleteFiles) {
  const p = accessible(id);
  if (isRunning(p.id)) throw new UserError('Bitte den Server zuerst stoppen.', 409);
  const dir = p.serverDir ? path.resolve(p.serverDir) : null;
  if (hosted.enabled()) {
    // Im Mehrbenutzer-Modus werden die Dateien immer mit gelöscht (sonst würden sie am Speicherplatz vorbeigeschmuggelt)
    const base = path.resolve(config.SERVERS_DIR) + path.sep;
    if (dir && (dir + path.sep).startsWith(base) && dir !== path.resolve(config.SERVERS_DIR)) fs.rmSync(dir, { recursive: true, force: true });
    if (p.ownerId) quota.invalidateDisk(p.ownerId);
  } else if (deleteFiles) {
    if (!dir || !fs.existsSync(path.join(dir, MARKER))) throw new UserError('Dieser Ordner stammt nicht vom Dashboard und wird deshalb nicht gelöscht.');
    if (dir === path.parse(dir).root || dir === require('os').homedir()) throw new UserError('Dieser Ordner wird aus Sicherheitsgründen nicht gelöscht.');
    fs.rmSync(dir, { recursive: true, force: true });
  }
  config.remove(id);
}

/** Wechselt Minecraft-Version/Build eines Servers (außer Modpack). Sichert vorher die Welt. */
async function upgrade(ctx, mc, mcVersion) {
  const cfg = config.get();
  const t = serverTypes.TYPES[cfg.type];
  if (cfg.type === 'modpack' || !t.versions) throw new UserError('Die Version eines Modpack-Servers wird vom Modpack bestimmt.');
  if (!/^[0-9A-Za-z._-]{1,40}$/.test(mcVersion || '')) throw new UserError('Ungültige Minecraft-Version.');
  const major = await serverTypes.javaMajorFor(mcVersion);
  try {
    ctx.log('Sichere zur Sicherheit die Welt …');
    await backup.create(ctx, mc, 'vor-update');
  } catch (e) {
    if (e.status !== 404) throw e; // 404: es gibt noch keine Welt, dann ist nichts zu sichern
    ctx.log('Es gibt noch keine Welt, ein Backup ist nicht nötig.');
  }
  config.update({ mcVersion, javaMajor: major, installed: false, jar: null });
  return serverTypes.installServer(ctx);
}

/** Erkennt, was für ein Server in einem vorhandenen Ordner liegt (ohne etwas zu verändern). */
function detectExisting(dir) {
  let st;
  try { st = fs.statSync(dir); } catch { throw new UserError(`Ordner nicht gefunden: ${dir}`, 404); }
  if (!st.isDirectory()) throw new UserError('Das ist kein Ordner.');
  const found = { type: null, loaderVersion: null, mcVersion: null, jar: null, xmsGb: null, xmxGb: null, motd: null };
  const neoDir = path.join(dir, 'libraries', 'net', 'neoforged', 'neoforge');
  if (fs.existsSync(neoDir)) {
    const vers = fs.readdirSync(neoDir).filter((v) => fs.existsSync(path.join(neoDir, v, 'win_args.txt'))).sort(serverTypes.compareVersions);
    if (vers.length) {
      found.type = 'neoforge';
      found.loaderVersion = vers[vers.length - 1];
      found.mcVersion = serverTypes.neoMc(found.loaderVersion);
    }
  }
  if (!found.type) {
    const jars = fs.readdirSync(dir).filter((n) => /\.jar$/i.test(n) && !/installer/i.test(n));
    const jar = jars.find((n) => /^(server|paper|purpur|fabric-server|minecraft_server)/i.test(n)) || null;
    if (jar) {
      found.jar = jar;
      found.type = /paper/i.test(jar) ? 'paper' : /purpur/i.test(jar) ? 'purpur' : /fabric/i.test(jar) ? 'fabric'
        : fs.existsSync(path.join(dir, 'plugins')) ? 'paper' : 'vanilla';
      const m = /(\d+\.\d+(?:\.\d+)?)/.exec(jar);
      if (m && /^(1\.|2\d\.)/.test(m[1])) found.mcVersion = m[1];
    }
  }
  if (!found.type) throw new UserError('In diesem Ordner wurde kein Minecraft-Server erkannt (weder NeoForge noch eine Server-JAR).');
  try {
    const args = fs.readFileSync(path.join(dir, 'user_jvm_args.txt'), 'utf8');
    const xms = /-Xms(\d+)G/i.exec(args);
    const xmx = /-Xmx(\d+)G/i.exec(args);
    if (xms) found.xmsGb = Number(xms[1]);
    if (xmx) found.xmxGb = Number(xmx[1]);
  } catch { /* keine Datei */ }
  try {
    found.motd = /^motd=(.*)$/m.exec(fs.readFileSync(path.join(dir, 'server.properties'), 'utf8'))?.[1]?.replace(/\\u00a7./gi, '').trim() || null;
  } catch { /* keine Datei */ }
  return found;
}

/**
 * Übernimmt einen vorhandenen Server-Ordner als Profil, ohne Dateien zu ändern.
 * Gibt es für den Ordner schon ein Profil, wird dieses aktualisiert.
 */
async function adopt({ name, path: dirRaw }) {
  const dir = path.resolve(String(dirRaw || '').trim().replace(/^"|"$/g, ''));
  if (!path.isAbsolute(String(dirRaw || '').trim().replace(/^"|"$/g, ''))) throw new UserError('Bitte den vollständigen Pfad angeben, z. B. C:\\MinecraftServer');
  const f = detectExisting(dir);
  const fields = {
    type: f.type, mcVersion: f.mcVersion, loaderVersion: f.loaderVersion, jar: f.jar, installed: true, pack: null, installedPackKey: null,
    javaMajor: f.mcVersion ? await serverTypes.javaMajorFor(f.mcVersion) : 21, aikar: f.type === 'paper' || f.type === 'purpur',
  };
  if (f.xmxGb) { fields.xmxGb = f.xmxGb; fields.xmsGb = Math.min(f.xmsGb || 2, f.xmxGb); }
  const same = config.list().find((p) => p.serverDir && path.resolve(p.serverDir).toLowerCase() === dir.toLowerCase());
  const label = cleanName(name || f.motd || path.basename(dir));
  if (same) {
    Object.assign(same, fields, { name: label });
    config.update({});
    return same;
  }
  return config.add({ ...fields, name: label, serverDir: dir });
}

module.exports = { accessible, isRunning, list, summary, create, rename, remove, upgrade, isComplete, cleanName, detectExisting, adopt };
