'use strict';
// CurseForge-Katalog durchstöbern (Modpacks). Braucht einen kostenlosen API-Schlüssel von console.curseforge.com,
// den der Nutzer selbst einträgt. Er bleibt nur auf diesem PC und wird nie in die Cloud gesichert.
const config = require('./config');
const { UserError, netError } = require('./util');
const { UA } = require('./download');

const API = 'https://api.curseforge.com/v1';
const GAME_MINECRAFT = 432;
const CLASS_MODPACKS = 4471;
const LOADER_NEOFORGE = 6;
const SORT = { relevance: 1, downloads: 6, follows: 2, newest: 11, updated: 3 };

function hasKey() {
  return !!config.getSecret('curseforgeKey');
}

function setKey(key) {
  const k = String(key || '').trim();
  if (!k) { config.setSecret('curseforgeKey', null); return; }
  if (k.length < 20 || k.length > 200 || /\s/.test(k)) throw new UserError('Das sieht nicht wie ein CurseForge-Schlüssel aus.');
  config.setSecret('curseforgeKey', k);
}

async function search(query, { index = 'downloads', offset = 0 } = {}) {
  const key = config.getSecret('curseforgeKey');
  if (!key) throw new UserError('Für CurseForge brauchst du einen kostenlosen API-Schlüssel.', 400, 'CF_KEY');
  const q = String(query || '').trim().slice(0, 100);
  const params = new URLSearchParams({
    gameId: String(GAME_MINECRAFT), classId: String(CLASS_MODPACKS), modLoaderType: String(LOADER_NEOFORGE),
    sortField: String(SORT[index] || SORT.downloads), sortOrder: 'desc', pageSize: '20', index: String(Math.max(0, Math.min(10000, Number(offset) || 0))),
  });
  if (q) params.set('searchFilter', q);
  let res;
  try {
    res = await fetch(`${API}/mods/search?${params}`, { headers: { 'x-api-key': key, Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  } catch (e) {
    throw netError(e, 'CurseForge');
  }
  if (res.status === 401 || res.status === 403) throw new UserError('CurseForge hat den Schlüssel abgelehnt. Bitte prüfe ihn.', 400, 'CF_KEY');
  if (!res.ok) throw new UserError(`CurseForge antwortet mit Fehler ${res.status}.`, 502);
  const j = await res.json();
  const safeUrl = (u) => (typeof u === 'string' && /^https:\/\/(www\.)?curseforge\.com\//.test(u) ? u : null);
  return {
    total: j.pagination?.totalCount || 0,
    results: (j.data || []).map((m) => ({
      id: String(m.id), source: 'curseforge', title: m.name, description: m.summary, downloads: m.downloadCount,
      icon: m.logo?.thumbnailUrl || null, author: m.authors?.[0]?.name || '', updated: m.dateModified,
      categories: (m.categories || []).map((c) => c.name).slice(0, 4), url: safeUrl(m.links?.websiteUrl),
      versions: [...new Set((m.latestFilesIndexes || []).map((f) => f.gameVersion))].slice(0, 3),
    })),
  };
}

module.exports = { hasKey, setKey, search };
