'use strict';
// Versionsnummer der Oberfläche. Wird an alle Skript- und Stil-Adressen gehängt (app.js?v=…),
// damit Browser nach einem Update nie alte und neue Dateien mischen (häufig auf dem Handy).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
let cache = { at: 0, v: '0' };

function version() {
  if (Date.now() - cache.at < 3000) return cache.v;
  const h = crypto.createHash('sha1');
  try {
    for (const f of fs.readdirSync(PUBLIC_DIR).sort()) {
      if (!/\.(js|css|html)$/.test(f)) continue;
      const st = fs.statSync(path.join(PUBLIC_DIR, f));
      h.update(`${f}:${st.size}:${Math.floor(st.mtimeMs)};`);
    }
  } catch { /* Ordner nicht lesbar: Version bleibt gleich */ }
  cache = { at: Date.now(), v: h.digest('hex').slice(0, 10) };
  return cache.v;
}

/** index.html mit Versionsnummer an allen Skripten und Stilen. */
function indexHtml() {
  const raw = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  const v = version();
  return raw
    .replace(/(<script src=")([A-Za-z0-9._-]+\.js)(")/g, `$1$2?v=${v}$3`)
    .replace(/(<link rel="stylesheet" href=")([A-Za-z0-9._-]+\.css)(")/g, `$1$2?v=${v}$3`);
}

module.exports = { version, indexHtml, PUBLIC_DIR };
