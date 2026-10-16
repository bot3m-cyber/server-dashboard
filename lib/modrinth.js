'use strict';
// Fragt bei Modrinth nach, ob eine Mod auf dem Server laufen kann (client_side / server_side).
const { UserError, netError } = require('./util');
const { UA } = require('./download');

const API = 'https://api.modrinth.com/v2';

async function getJson(url, opts = {}) {
  let res;
  try {
    res = await fetch(url, {
      ...opts,
      headers: { 'User-Agent': UA, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    throw netError(e, 'Modrinth');
  }
  if (!res.ok) throw new UserError(`Modrinth antwortet mit Fehler ${res.status}.`, 502);
  return res.json();
}

async function projects(ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    if (!chunk.length) continue;
    const arr = await getJson(`${API}/projects?ids=${encodeURIComponent(JSON.stringify(chunk))}`);
    for (const p of arr) {
      out[p.id] = { id: p.id, slug: p.slug, title: p.title, icon_url: p.icon_url, client_side: p.client_side, server_side: p.server_side };
    }
  }
  return out;
}

/** sha1-Hash einer Datei → Modrinth-Projekt-ID (für Mods aus overrides/). */
async function projectIdsBySha1(hashes) {
  if (!hashes.length) return {};
  const r = await getJson(`${API}/version_files`, { method: 'POST', body: JSON.stringify({ hashes, algorithm: 'sha1' }) });
  const out = {};
  for (const [h, v] of Object.entries(r)) out[h] = v.project_id;
  return out;
}

/** sha1 -> komplette Modrinth-Version (mit project_id, game_versions, loaders). */
async function versionsBySha1(hashes) {
  if (!hashes.length) return {};
  return getJson(`${API}/version_files`, { method: 'POST', body: JSON.stringify({ hashes, algorithm: 'sha1' }) });
}

/** Sucht NeoForge-Mods für die Minecraft-Version, die auf Servern laufen. */
const SORTS = ['relevance', 'downloads', 'follows', 'newest', 'updated'];

async function search(query, mc, loaders = ['neoforge'], opts = {}) {
  // Plugins führt Modrinth als eigenen Projekt-Typ ("plugin"), Mods als "mod"
  const facets = [['project_type:mod', 'project_type:plugin'], loaders.map((l) => `categories:${l}`), ['server_side:required', 'server_side:optional']];
  if (!opts.allVersions) facets.splice(1, 0, [`versions:${mc}`]);
  const q = String(query || '').trim();
  const offset = Math.max(0, Math.min(10000, Number(opts.offset) || 0));
  const url = `${API}/search?query=${encodeURIComponent(q)}&facets=${encodeURIComponent(JSON.stringify(facets))}`
    + `&limit=30&offset=${offset}&index=${SORTS.includes(opts.sort) ? opts.sort : (q ? 'relevance' : 'downloads')}`;
  const r = await getJson(url);
  return {
    total: r.total_hits || 0,
    hits: r.hits.map((h) => ({
      id: h.project_id, slug: h.slug, title: h.title, description: h.description, downloads: h.downloads,
      icon: h.icon_url, author: h.author, supportsVersion: Array.isArray(h.versions) ? h.versions.includes(mc) : null,
    })),
  };
}

/** Neueste passende Version (bevorzugt "release") oder null. */
async function bestVersion(idOrSlug, mc, loaders = ['neoforge']) {
  const url = `${API}/project/${encodeURIComponent(idOrSlug)}/version`
    + `?game_versions=${encodeURIComponent(JSON.stringify([mc]))}&loaders=${encodeURIComponent(JSON.stringify(loaders))}`;
  const arr = await getJson(url);
  if (!Array.isArray(arr) || !arr.length) return null;
  return arr.find((v) => v.version_type === 'release') || arr[0];
}

module.exports = { projects, projectIdsBySha1, versionsBySha1, search, bestVersion, getJson, API };
