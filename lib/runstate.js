'use strict';
// Merkt sich, welche Minecraft-Server gerade laufen, und ob sie beim nächsten Start des Dashboards
// automatisch wieder starten sollen (Haken im Reiter „Netzwerk & Betrieb“).
// Ein Server, den du im Dashboard bewusst stoppst, kommt aus der Liste und bleibt nach einem Neustart aus.
// Läuft er dagegen noch, wenn der Rechner oder das Dashboard heruntergefahren wird (oder abstürzt), startet er wieder.
const path = require('path');
const { DATA_DIR } = require('./paths');
const { readJson, writeJsonAtomic } = require('./util');

const FILE = path.join(DATA_DIR, 'runstate.json');
let cache = null;

function load() {
  const f = readJson(FILE, {});
  cache = { autoStart: !!f.autoStart, running: Array.isArray(f.running) ? f.running.map(String) : [] };
  return cache;
}

const get = () => cache || load();

function save() {
  writeJsonAtomic(FILE, get());
}

function setAutoStart(on) {
  get().autoStart = !!on;
  save();
}

function markRunning(id, { exclusive = false } = {}) {
  const s = get();
  const next = exclusive ? [id] : [...s.running.filter((x) => x !== id), id];
  if (next.length === s.running.length && next.every((x, i) => x === s.running[i])) return;
  s.running = next;
  save();
}

function markStopped(id) {
  const s = get();
  if (!s.running.includes(id)) return;
  s.running = s.running.filter((x) => x !== id);
  save();
}

module.exports = { FILE, get, setAutoStart, markRunning, markStopped };
