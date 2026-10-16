'use strict';
// Modpacks direkt bei Modrinth suchen und installieren; auf Updates prüfen.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const config = require('./config');
const modrinth = require('./modrinth');
const { downloadVerified } = require('./download');
const { UserError } = require('./util');

const INDEXES = ['relevance', 'downloads', 'follows', 'newest', 'updated'];

/** Modpacks bei Modrinth durchstöbern oder suchen (mit Sortierung und Blättern). */
async function search(query, { index = 'downloads', offset = 0 } = {}) {
  const facets = [['project_type:modpack'], ['categories:neoforge'], ['server_side:required', 'server_side:optional']];
  const q = String(query || '').trim().slice(0, 100);
  const idx = INDEXES.includes(index) ? (index === 'relevance' && !q ? 'downloads' : index) : 'downloads';
  const off = Math.max(0, Math.min(10000, Number(offset) || 0));
  const url = `${modrinth.API}/search?query=${encodeURIComponent(q)}&facets=${encodeURIComponent(JSON.stringify(facets))}&limit=20&offset=${off}&index=${idx}`;
  const r = await modrinth.getJson(url);
  return {
    total: r.total_hits || 0,
    results: r.hits.map((h) => ({
      id: h.project_id, source: 'modrinth', slug: h.slug, title: h.title, description: h.description, downloads: h.downloads, follows: h.follows,
      icon: h.icon_url, author: h.author, updated: h.date_modified, versions: (h.versions || []).slice(-3),
      categories: (h.display_categories || h.categories || []).filter((c) => !['neoforge', 'forge', 'fabric', 'quilt'].includes(c)).slice(0, 4),
      url: `https://modrinth.com/modpack/${h.slug}`,
    })),
  };
}

async function latestVersion(projectId) {
  const url = `${modrinth.API}/project/${encodeURIComponent(projectId)}/version?loaders=${encodeURIComponent('["neoforge"]')}`;
  const arr = await modrinth.getJson(url);
  if (!Array.isArray(arr) || !arr.length) throw new UserError('Für dieses Modpack gibt es keine NeoForge-Version.');
  return arr.find((v) => v.version_type === 'release') || arr[0];
}

/** Lädt die neueste .mrpack und liest sie wie eine hochgeladene Datei ein. */
async function install(ctx, projectId) {
  const setup = require('./setup');
  const v = await latestVersion(projectId);
  const f = v.files.find((x) => x.primary && /\.mrpack$/i.test(x.filename)) || v.files.find((x) => /\.mrpack$/i.test(x.filename));
  if (!f) throw new UserError('Dieses Projekt enthält keine .mrpack-Datei.');
  const tmp = path.join(config.DATA_DIR, `download-${config.get().id}.mrpack`);
  ctx.log(`Lade ${f.filename} …`);
  let total = f.size || 0;
  let done = 0;
  try {
    await downloadVerified([f.url], tmp, {
      sha512: f.hashes.sha512, label: f.filename,
      onBytes: (n) => { done += n; ctx.progress(done, total || done, `${Math.round(done / 1048576)} MB`); },
    });
    await setup.importMrpack(tmp, ctx, f.filename);
  } finally {
    await fsp.rm(tmp, { force: true }).catch(() => {});
  }
  config.update({ packProjectId: projectId, packVersionNumber: v.version_number });
  ctx.log('Modpack eingelesen. Weiter mit „Mods herunterladen“.');
  return { version: v.version_number };
}

/** Gibt es eine neuere Modpack-Version? (nur für über die Suche installierte Modpacks) */
async function updateInfo() {
  const cfg = config.get();
  if (!cfg.packProjectId) return { known: false };
  try {
    const v = await latestVersion(cfg.packProjectId);
    return { known: true, latest: v.version_number, current: cfg.packVersionNumber || null, newer: !!cfg.packVersionNumber && v.version_number !== cfg.packVersionNumber };
  } catch (e) {
    return { known: true, error: e.message };
  }
}

module.exports = { search, install, updateInfo, fs };
