'use strict';
// Impressum und Datenschutzerklärung. Die Texte liegen als Vorlagen in lib/legaltext/ (Deutsch und Englisch).
// Wer das Dashboard selbst betreibt, kann sie überschreiben: Dateien mit denselben Namen in data/legal/ gehen vor
// und bleiben bei Updates erhalten. Der Betreiber (GitHub-Name) stellt sich im Dashboard unter „Netzwerk & Betrieb“ ein.
const fs = require('fs');
const path = require('path');
const { APP_DIR, DATA_DIR } = require('./paths');
const { readJson, writeJsonAtomic, UserError } = require('./util');

const FILE = path.join(DATA_DIR, 'legal.json');
const PAGES = ['impressum', 'datenschutz'];
const LANGS = ['de', 'en'];
const NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/** Standard-Betreiber: der Eigentümer des Projekts bei GitHub (aus package.json). */
function repoInfo() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8'));
    const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url || '';
    const m = String(url).match(/github\.com[/:]([^/]+)\/([^/.#]+)/i);
    if (m) return { owner: m[1], repo: m[2], url: `https://github.com/${m[1]}/${m[2]}` };
  } catch { /* keine Angabe */ }
  return { owner: '', repo: '', url: 'https://github.com' };
}

const get = () => {
  const f = readJson(FILE, {});
  const r = repoInfo();
  const operator = NAME_RE.test(String(f.operator || '')) ? f.operator : r.owner;
  return { operator, defaultOperator: r.owner, custom: !!f.operator, repoUrl: r.url };
};

function save(operator) {
  const v = String(operator || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/^@/, '');
  if (v && !NAME_RE.test(v)) throw new UserError('Das ist kein gültiger GitHub-Benutzername (Buchstaben, Ziffern und Bindestriche).');
  writeJsonAtomic(FILE, { operator: v });
  return get();
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Der Text einer Seite (nur der Inhalt) in der gewünschten Sprache. */
function fragment(page, lang) {
  const l = LANGS.includes(lang) ? lang : 'de';
  const file = `${page}.${l}.html`;
  for (const dir of [path.join(DATA_DIR, 'legal'), path.join(__dirname, 'legaltext')]) {
    try { return { html: fs.readFileSync(path.join(dir, file), 'utf8'), lang: l, custom: dir.startsWith(DATA_DIR) }; } catch { /* nächster Ort */ }
  }
  return null;
}

/** Komplette Seite für den Browser. */
function render(page, lang) {
  if (!PAGES.includes(page)) return null;
  const frag = fragment(page, lang) || fragment(page, 'de');
  if (!frag) return null;
  const s = get();
  const body = frag.html
    .replaceAll('{{operator}}', esc(s.operator || '—'))
    .replaceAll('{{operatorUrl}}', s.operator ? `https://github.com/${encodeURIComponent(s.operator)}` : esc(s.repoUrl))
    .replaceAll('{{repoUrl}}', esc(s.repoUrl));
  const t = frag.lang === 'en'
    ? { back: '← Back to the dashboard', other: 'Deutsch', otherLang: 'de', imp: 'Legal notice', dsg: 'Privacy policy' }
    : { back: '← Zurück zum Dashboard', other: 'English', otherLang: 'en', imp: 'Impressum', dsg: 'Datenschutz' };
  const title = page === 'impressum' ? t.imp : t.dsg;
  return `<!doctype html>
<html lang="${frag.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} – Server-Dashboard</title>
<link rel="icon" href="/assets/logo.svg" type="image/svg+xml">
<link rel="stylesheet" href="/style.css">
<link rel="stylesheet" href="/legal.css">
</head>
<body class="legal-body">
<main class="legal-card">
  <nav class="legal-nav">
    <a href="/">${t.back}</a>
    <span><a href="/impressum?lang=${frag.lang}">${t.imp}</a> · <a href="/datenschutz?lang=${frag.lang}">${t.dsg}</a> · <a href="?lang=${t.otherLang}">${t.other}</a></span>
  </nav>
  <article>${body}</article>
</main>
</body>
</html>`;
}

module.exports = { get, save, render, PAGES, LANGS, repoInfo };
