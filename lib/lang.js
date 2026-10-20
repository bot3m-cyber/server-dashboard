'use strict';
// Sprachdateien. Jede Sprache ist eine JSON-Datei: { "_meta": { "code": "en", "name": "English", "locale": "en-GB" }, "strings": { "Deutscher Satz": "Übersetzung" } }
//  - eingebaute Sprachen: public/lang/<code>.json (kommen mit Updates)
//  - eigene oder angepasste Sprachen: data/lang/<code>.json (gehen vor und bleiben bei Updates erhalten)
// Fehlt ein Satz in einer Datei, bleibt er deutsch. Dateien mit demselben Namen in data/lang/ überschreiben nur die Sätze, die sie enthalten.
const fs = require('fs');
const path = require('path');
const { APP_DIR, DATA_DIR } = require('./paths');

const BUILTIN = path.join(APP_DIR, 'public', 'lang');
const CUSTOM = path.join(DATA_DIR, 'lang');
const CODE_RE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;

function readFile(dir, code) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, `${code}.json`), 'utf8'));
    if (!j || typeof j !== 'object') return null;
    return { meta: j._meta && typeof j._meta === 'object' ? j._meta : {}, strings: j.strings && typeof j.strings === 'object' ? j.strings : {} };
  } catch {
    return null;
  }
}

/** Die fertige Sprache (eingebaut plus eigene Anpassungen) oder null. */
function get(code) {
  if (!CODE_RE.test(code || '')) return null;
  const base = readFile(BUILTIN, code);
  const mine = readFile(CUSTOM, code);
  if (!base && !mine) return null;
  const strings = {};
  for (const src of [base, mine]) {
    if (!src) continue;
    for (const [k, v] of Object.entries(src.strings)) if (typeof k === 'string' && typeof v === 'string' && v.trim()) strings[k] = v;
  }
  const meta = { code, name: code, locale: code, ...(base?.meta || {}), ...(mine?.meta || {}), code };
  return { _meta: meta, strings };
}

/** Alle verfügbaren Sprachen für die Auswahl. */
function list() {
  const codes = new Set();
  for (const dir of [BUILTIN, CUSTOM]) {
    try { for (const f of fs.readdirSync(dir)) if (f.endsWith('.json') && CODE_RE.test(f.slice(0, -5))) codes.add(f.slice(0, -5)); } catch { /* Ordner fehlt */ }
  }
  const out = [];
  for (const code of codes) {
    const lang = get(code);
    if (!lang) continue;
    out.push({ code, name: lang._meta.name || code, locale: lang._meta.locale || code, builtin: !!readFile(BUILTIN, code), custom: !!readFile(CUSTOM, code), count: Object.keys(lang.strings).length });
  }
  if (!out.some((l) => l.code === 'de')) out.push({ code: 'de', name: 'Deutsch', locale: 'de-DE', builtin: true, custom: false, count: 0 });
  return out.sort((a, b) => (a.code === 'de' ? -1 : b.code === 'de' ? 1 : a.name.localeCompare(b.name)));
}

module.exports = { get, list, CODE_RE, BUILTIN, CUSTOM };
