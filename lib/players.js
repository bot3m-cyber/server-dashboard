'use strict';
// Whitelist und OP-Liste (whitelist.json / ops.json).
const fs = require('fs');
const crypto = require('crypto');
const config = require('./config');
const properties = require('./properties');
const { UserError, writeJsonAtomic, sleep, netError } = require('./util');

const NAME_RE = /^[A-Za-z0-9_]{1,16}$/;
const GAMERTAG_RE = /^[A-Za-z0-9 _]{1,16}$/;
const FILES = { whitelist: 'whitelist.json', ops: 'ops.json' };

function readList(kind) {
  try {
    const arr = JSON.parse(fs.readFileSync(config.serverPath(FILES[kind]), 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function dashed(hex) {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** UUID, wie sie ein Server mit online-mode=false verwendet. */
function offlineUuid(name) {
  const md5 = crypto.createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest();
  md5[6] = (md5[6] & 0x0f) | 0x30;
  md5[8] = (md5[8] & 0x3f) | 0x80;
  return dashed(md5.toString('hex'));
}

async function lookup(name) {
  const online = properties.get('online-mode', 'true') !== 'false';
  if (!online) return { uuid: offlineUuid(name), name };
  let res;
  try {
    res = await fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`, {
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    throw netError(e, 'den Mojang-Servern');
  }
  if (res.status === 404 || res.status === 204) {
    throw new UserError(`Den Minecraft-Account „${name}“ gibt es nicht. Bitte die Schreibweise prüfen.`, 404);
  }
  if (!res.ok) throw new UserError(`Mojang antwortet mit Fehler ${res.status}. Bitte später erneut versuchen.`, 502);
  const j = await res.json();
  return { uuid: dashed(j.id), name: j.name };
}

/** Präfix, das Floodgate vor Bedrock-Namen setzt (Standard "."). */
function floodgatePrefix() {
  try {
    const t = fs.readFileSync(config.serverPath('plugins/floodgate/config.yml'), 'utf8');
    const m = t.match(/^username-prefix:[ \t]*["']?([^"'\r\n]*)["']?/m);
    if (m) return m[1];
  } catch { /* Floodgate nicht installiert */ }
  return '.';
}

function floodgateReplacesSpaces() {
  try {
    return !/^replace-spaces:[ \t]*false/m.test(fs.readFileSync(config.serverPath('plugins/floodgate/config.yml'), 'utf8'));
  } catch {
    return true;
  }
}

/** Erkennt Bedrock-Namen: mit Floodgate-Präfix (".Name") oder ausdrücklich als Bedrock markiert. */
function parseBedrock(name, forced) {
  const prefix = floodgatePrefix();
  let tag = String(name || '').trim();
  let isBedrock = !!forced;
  if (prefix && tag.startsWith(prefix)) { tag = tag.slice(prefix.length); isBedrock = true; }
  return isBedrock ? tag : null;
}

/** Xbox-Gamertag -> Floodgate-Spieler (Name mit Präfix und UUID 00000000-0000-0000-xuid). */
async function lookupBedrock(tag) {
  if (!GAMERTAG_RE.test(tag)) throw new UserError('Ungültiger Xbox-Gamertag. Erlaubt sind Buchstaben, Ziffern, Leerzeichen und _ (höchstens 16 Zeichen).');
  let res;
  try {
    res = await fetch(`https://api.geysermc.org/v2/xbox/xuid/${encodeURIComponent(tag)}`, { signal: AbortSignal.timeout(15000) });
  } catch (e) {
    throw netError(e, 'api.geysermc.org');
  }
  if (res.status === 404 || res.status === 204) throw new UserError(`Den Xbox-Gamertag „${tag}“ gibt es nicht. Bitte die Schreibweise prüfen.`, 404);
  if (!res.ok) throw new UserError(`Den Xbox-Gamertag „${tag}“ konnte die GeyserMC-Suche nicht finden (Antwort ${res.status}). Bitte die Schreibweise prüfen, sonst später erneut versuchen.`, 502);
  const j = await res.json();
  if (!j.xuid) throw new UserError(`Den Xbox-Gamertag „${tag}“ gibt es nicht. Bitte die Schreibweise prüfen.`, 404);
  const hex = BigInt(j.xuid).toString(16).padStart(16, '0');
  const name = floodgatePrefix() + (floodgateReplacesSpaces() ? tag.replace(/ /g, '_') : tag);
  return { uuid: `00000000-0000-0000-${hex.slice(0, 4)}-${hex.slice(4)}`, name };
}

function checkName(name) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) {
    throw new UserError('Ungültiger Spielername. Erlaubt sind Buchstaben, Ziffern und _ (höchstens 16 Zeichen).');
  }
  return name;
}

/**
 * Fügt hinzu oder entfernt. Läuft der Server, geht das über Konsolenbefehle
 * (sonst würde der Server die Datei beim Beenden überschreiben).
 */
async function modify(kind, action, name, mc, opts = {}) {
  if (!FILES[kind]) throw new UserError('Unbekannte Liste.');
  if (action !== 'add' && action !== 'remove') throw new UserError('Unbekannte Aktion.');
  const tag = parseBedrock(name, opts.bedrock);
  if (tag !== null) return modifyBedrock(kind, action, tag, mc);
  checkName(name);
  if (mc.isRunning()) {
    if (mc.state !== 'läuft') throw new UserError('Bitte warten, bis der Server fertig gestartet ist.', 409);
    const cmd = kind === 'ops' ? `${action === 'add' ? 'op' : 'deop'} ${name}` : `whitelist ${action} ${name}`;
    mc.command(cmd);
    await sleep(1500);
    return { viaConsole: true };
  }
  const list = readList(kind);
  const idx = list.findIndex((e) => String(e.name).toLowerCase() === name.toLowerCase());
  if (action === 'remove') {
    if (idx < 0) throw new UserError(`${name} steht nicht auf der Liste.`, 404);
    list.splice(idx, 1);
  } else {
    if (idx >= 0) throw new UserError(`${list[idx].name} steht schon auf der Liste.`, 409);
    const p = await lookup(name);
    list.push(kind === 'ops' ? { uuid: p.uuid, name: p.name, level: 4, bypassesPlayerLimit: false } : { uuid: p.uuid, name: p.name });
  }
  writeJsonAtomic(config.serverPath(FILES[kind]), list);
  return { viaConsole: false };
}

/**
 * Bedrock-Spieler stehen mit Floodgate-Name (".Name") und eigener UUID in den Listen.
 * Die Befehle "whitelist add .Name" und "op .Name" kennen sie nicht (kein Mojang-Konto), darum schreiben wir die Datei selbst.
 */
async function modifyBedrock(kind, action, tag, mc) {
  const prefix = floodgatePrefix();
  const list = readList(kind);
  const wanted = (prefix + (floodgateReplacesSpaces() ? tag.replace(/ /g, '_') : tag)).toLowerCase();
  const idx = list.findIndex((e) => String(e.name).toLowerCase() === wanted);
  const running = mc.isRunning();
  if (running && mc.state !== 'läuft') throw new UserError('Bitte warten, bis der Server fertig gestartet ist.', 409);

  if (action === 'remove') {
    if (idx < 0) throw new UserError(`${prefix}${tag} steht nicht auf der Liste.`, 404);
    if (running && kind === 'ops') {
      // Die OP-Liste lässt sich im Betrieb nur über den Befehl ändern; das geht, solange der Spieler online ist
      if (!mc.players.has(list[idx].name)) throw new UserError(`${list[idx].name} ist gerade nicht online. OP-Rechte können bei laufendem Server nur online entzogen werden. Bitte den Server stoppen oder warten, bis der Spieler da ist.`, 409);
      mc.command(`deop ${list[idx].name}`);
      await sleep(1500);
      return { viaConsole: true, bedrock: true };
    }
    list.splice(idx, 1);
  } else {
    if (idx >= 0) throw new UserError(`${list[idx].name} steht schon auf der Liste.`, 409);
    const p = await lookupBedrock(tag);
    if (running && kind === 'ops') {
      if (!mc.players.has(p.name)) throw new UserError(`${p.name} ist gerade nicht online. Bei laufendem Server geht OP für Bedrock-Spieler nur, wenn sie online sind. Bitte den Spieler beitreten lassen oder den Server stoppen.`, 409);
      mc.command(`op ${p.name}`);
      await sleep(1500);
      return { viaConsole: true, bedrock: true };
    }
    list.push(kind === 'ops' ? { uuid: p.uuid, name: p.name, level: 4, bypassesPlayerLimit: false } : { uuid: p.uuid, name: p.name });
  }
  writeJsonAtomic(config.serverPath(FILES[kind]), list);
  if (running && kind === 'whitelist') { mc.command('whitelist reload'); await sleep(1000); return { viaConsole: true, bedrock: true }; }
  return { viaConsole: false, bedrock: true };
}

module.exports = { readList, modify, offlineUuid, floodgatePrefix };
