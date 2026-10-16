'use strict';
// server.properties lesen/schreiben (Kommentare und unbekannte Einträge bleiben erhalten).
const fs = require('fs');
const config = require('./config');
const { UserError, writeTextAtomic } = require('./util');

const FIELDS = {
  motd: { type: 'string', def: 'A Minecraft Server', max: 150 },
  'max-players': { type: 'int', def: '20', min: 1, max: 500 },
  difficulty: { type: 'enum', def: 'easy', values: ['peaceful', 'easy', 'normal', 'hard'] },
  gamemode: { type: 'enum', def: 'survival', values: ['survival', 'creative', 'adventure', 'spectator'] },
  'view-distance': { type: 'int', def: '10', min: 3, max: 32 },
  'simulation-distance': { type: 'int', def: '10', min: 3, max: 32 },
  'online-mode': { type: 'bool', def: 'true' },
  'white-list': { type: 'bool', def: 'false' },
  'enforce-whitelist': { type: 'bool', def: 'false' },
  'server-port': { type: 'int', def: '25565', min: 1024, max: 65535 },
};

function file() {
  return config.serverPath('server.properties');
}

function readRaw() {
  try { return fs.readFileSync(file(), 'utf8'); } catch { return ''; }
}

function unescapeProp(v) {
  return v.replace(/\\u([0-9a-fA-F]{4})|\\(.)/g, (m, hex, ch) => {
    if (hex) return String.fromCharCode(parseInt(hex, 16));
    return { t: '\t', n: '\n', r: '\r', f: '\f' }[ch] ?? ch;
  });
}

function escapeProp(v) {
  return String(v)
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function parse(text) {
  const map = {};
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim() || /^\s*[#!]/.test(line)) continue;
    const i = line.search(/[=:]/);
    if (i < 0) continue;
    map[line.slice(0, i).trim()] = unescapeProp(line.slice(i + 1).replace(/^\s+/, ''));
  }
  return map;
}

function get(key, fallback) {
  const v = parse(readRaw())[key];
  return v === undefined || v === '' ? fallback : v;
}

function getForm() {
  const raw = readRaw();
  const map = parse(raw);
  const values = {};
  for (const [k, f] of Object.entries(FIELDS)) values[k] = map[k] ?? f.def;
  return { values, exists: raw.length > 0 };
}

function validate(key, value) {
  const f = FIELDS[key];
  const v = String(value ?? '').trim();
  if (f.type === 'int') {
    const n = Number(v);
    if (!Number.isInteger(n) || n < f.min || n > f.max) throw new UserError(`„${key}“ muss eine Zahl zwischen ${f.min} und ${f.max} sein.`);
    return String(n);
  }
  if (f.type === 'bool') {
    if (v !== 'true' && v !== 'false') throw new UserError(`„${key}“ muss true oder false sein.`);
    return v;
  }
  if (f.type === 'enum') {
    if (!f.values.includes(v)) throw new UserError(`Ungültiger Wert für „${key}“.`);
    return v;
  }
  if (v.length > f.max) throw new UserError(`„${key}“ darf höchstens ${f.max} Zeichen lang sein.`);
  return String(value ?? '').replace(/[\r\n]/g, ' ');
}

function updateText(text, changes) {
  const lines = text ? text.split(/\r?\n/) : ['#Minecraft server properties'];
  const done = new Set();
  const out = lines.map((line) => {
    if (!line.trim() || /^\s*[#!]/.test(line)) return line;
    const i = line.search(/[=:]/);
    if (i < 0) return line;
    const key = line.slice(0, i).trim();
    if (key in changes) {
      done.add(key);
      return `${key}=${escapeProp(changes[key])}`;
    }
    return line;
  });
  while (out.length && out[out.length - 1] === '') out.pop();
  for (const [k, v] of Object.entries(changes)) if (!done.has(k)) out.push(`${k}=${escapeProp(v)}`);
  return `${out.join('\n')}\n`;
}

function saveForm(values) {
  if (!values || typeof values !== 'object') throw new UserError('Keine Werte übermittelt.');
  const changes = {};
  for (const k of Object.keys(FIELDS)) if (k in values) changes[k] = validate(k, values[k]);
  writeTextAtomic(file(), updateText(readRaw(), changes));
  return getForm();
}

function set(changes) {
  writeTextAtomic(file(), updateText(readRaw(), changes));
}

function saveRaw(text) {
  if (typeof text !== 'string') throw new UserError('Ungültiger Inhalt.');
  if (text.length > 200000) throw new UserError('Die Datei ist zu groß.');
  writeTextAtomic(file(), text.endsWith('\n') ? text : `${text}\n`);
}

module.exports = { FIELDS, readRaw, parse, get, getForm, saveForm, saveRaw, set };
