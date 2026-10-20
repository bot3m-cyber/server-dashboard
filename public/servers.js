'use strict';
/* Meine Server: Liste, neuen Server anlegen (Typ + Version), Einrichtung für Nicht-Modpack-Server,
   Plugins/Mods je nach Typ, Empfehlungen. Nutzt Hilfen aus app.js ($, el, api, toast, guarded, state …). */

const SV = { types: [], picked: null, nameTouched: false, runningId: null };

const TYPE_ASSET = {
  modpack: 'assets/brands/modrinth.svg',
  paper: 'assets/brands/paper.png',
  purpur: 'assets/brands/purpur.svg',
  fabric: 'assets/brands/fabric.png',
  neoforge: 'assets/brands/neoforge.png',
  vanilla: 'assets/minecraft-grass-block.svg',
};

function typeVisual(type, label, className = 'type-visual') {
  return el('span', { class: `${className} ${className}-${type}` },
    el('img', { src: TYPE_ASSET[type] || TYPE_ASSET.vanilla, alt: '', 'aria-hidden': 'true' }),
    el('span', { class: 'sr-only' }, label));
}

// ---------------------------------------------------------------- Server-Liste

async function loadServers() {
  const d = await api('GET', '/api/servers');
  SV.types = d.types;
  SV.runningId = d.runningId;
  renderServerCards(d.servers);
  renderTypeCards();
  loadPresets().catch((e) => toast(e.message, 'error'));
}

function serverCard(s, anyRunning) {
  const ver = s.packName ? `${s.packName} · ${s.mcVersion || ''}` : [s.typeLabel, s.mcVersion].filter(Boolean).join(' ');
  const switchBlocked = anyRunning && !s.active;
  // Eigenes Server-Icon (falls vorhanden), sonst das Bild des Server-Typs
  const typeIcon = typeVisual(s.type, s.typeLabel || s.type, 'sc-icon');
  const ownIcon = el('img', { class: 'sc-own-icon', alt: '', src: `/api/servers/${s.id}/icon?t=${ICON_STAMP}`, title: 'Server-Icon (in der Serverliste von Minecraft)' });
  ownIcon.addEventListener('error', () => ownIcon.replaceWith(typeIcon));
  return el('div', { class: `server-card${s.active ? ' active' : ''}` },
    ownIcon,
    el('div', { class: 'sc-body' },
      el('div', { class: 'sc-name' }, s.name,
        s.active ? el('span', { class: 'tag good-tag' }, s.running ? 'läuft' : 'aktiv') : null,
        !s.complete ? el('span', { class: 'tag' }, 'nicht fertig eingerichtet') : null),
      el('div', { class: 'muted small' }, ver),
      el('div', { class: 'muted small mono sc-dir' }, s.serverDir)),
    el('div', { class: 'sc-actions' },
      s.active ? el('button', { class: 'btn small', onclick: () => showTab('home') }, 'Übersicht')
        : el('button', {
          class: 'btn small primary', disabled: switchBlocked, title: switchBlocked ? 'Erst den laufenden Server stoppen' : '',
          onclick: (e) => guarded(e.currentTarget, async () => { await api('POST', '/api/servers/activate', { id: s.id }); }),
        }, 'Öffnen'),
      el('button', {
        class: 'btn small ghost', title: 'Server-Icon ändern',
        onclick: () => openIconDialog(`/api/servers/${s.id}`, s.name, () => { loadServers(); if (s.active) { homeInfo.iconStamp = Date.now(); } }),
      }, 'Icon ändern'),
      el('button', {
        class: 'btn small ghost',
        onclick: (e) => guarded(e.currentTarget, async () => {
          const name = prompt('Neuer Name:', s.name);
          if (!name || name === s.name) return;
          await api('POST', '/api/servers/rename', { id: s.id, name });
          await loadServers();
          if (s.active) $('#packName').textContent = $('#packName').textContent.replace(s.name, name);
        }),
      }, 'Umbenennen'),
      el('button', {
        class: 'btn small ghost danger', disabled: s.running,
        onclick: (e) => guarded(e.currentTarget, async () => {
          if (!confirm(`„${s.name}“ aus der Liste entfernen?\n\nDie Dateien (Welt, Mods …) bleiben im Ordner erhalten:\n${s.serverDir}`)) return;
          const wipe = confirm('Soll der Server-Ordner mit Welt und allen Dateien auch GELÖSCHT werden?\n\nOK = alles löschen (nicht rückgängig zu machen)\nAbbrechen = Dateien behalten');
          await api('POST', '/api/servers/delete', { id: s.id, deleteFiles: wipe });
          await loadServers();
        }),
      }, 'Entfernen')));
}

function renderServerCards(list) {
  const any = list.some((s) => s.running);
  $('#serverCards').replaceChildren(...list.map((s) => serverCard(s, any)));
}

// ---------------------------------------------------------------- Neuen Server anlegen

function renderTypeCards() {
  $('#typeCards').replaceChildren(...SV.types.map((t) => el('button', {
    type: 'button', class: `type-card${SV.picked === t.id ? ' sel' : ''}`,
    onclick: () => pickType(t.id),
  }, typeVisual(t.id, t.label, 'tc-icon'), el('b', {}, t.label), el('span', { class: 'muted small' }, t.desc),
  el('span', { class: 'tag' }, t.kind === 'plugins' ? 'Plugins' : t.kind === 'mods' ? 'Mods' : 'keine Erweiterungen'))));
}

async function loadVersionsInto(select, type, snapshots) {
  select.replaceChildren(el('option', {}, 'Lade Versionen …'));
  select.disabled = true;
  try {
    const r = await api('GET', `/api/versions?type=${encodeURIComponent(type)}&snapshots=${snapshots ? 1 : 0}`);
    select.replaceChildren(...r.versions.map((v) => el('option', { value: v.id }, v.stable ? v.id : `${v.id} (Test-Version)`)));
    select.disabled = false;
    return r.versions;
  } catch (e) {
    select.replaceChildren(el('option', {}, 'Nicht verfügbar'));
    toast(e.message, 'error');
    return [];
  }
}

function suggestName() {
  if (SV.nameTouched || !SV.picked) return;
  const t = SV.types.find((x) => x.id === SV.picked);
  const v = $('#nsVersion').value;
  $('#nsName').value = t.versions && v && !/Lade|Nicht/.test(v) ? `${t.label} ${v}` : t.label;
}

async function pickType(id) {
  SV.picked = id;
  SV.nameTouched = false;
  renderTypeCards();
  const t = SV.types.find((x) => x.id === id);
  $('#newServerForm').hidden = false;
  $('#nsVersionLabel').hidden = !t.versions;
  $('#nsSnapLabel').hidden = !t.versions;
  $('#nsEulaLabel').hidden = false;
  $('#mpBox').hidden = id !== 'modpack';
  if (id === 'modpack') mpOpen();
  $('#nsSubmit').textContent = id === 'modpack' ? 'Leeres Modpack-Profil anlegen (selbst einrichten)' : 'Server anlegen und installieren';
  if (t.versions) {
    await loadVersionsInto($('#nsVersion'), id, $('#nsSnapshots').checked);
  }
  suggestName();
  $('#newServerForm').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

$('#nsName').addEventListener('input', () => { SV.nameTouched = true; });
$('#nsVersion').addEventListener('change', suggestName);
$('#nsSnapshots').addEventListener('change', async () => {
  await loadVersionsInto($('#nsVersion'), SV.picked, $('#nsSnapshots').checked);
  suggestName();
});

$('#newServerForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!SV.picked) return;
  const t = SV.types.find((x) => x.id === SV.picked);
  if (t.id !== 'modpack' && !$('#nsEula').checked && !confirm('Du hast die Minecraft-EULA nicht angehakt. Der Server startet erst nach deiner Zustimmung (in der Einrichtung). Trotzdem anlegen?')) return;
  guarded($('#nsSubmit'), async () => {
    jobDismissed = null;
    await api('POST', '/api/servers', {
      name: $('#nsName').value, type: SV.picked, mcVersion: t.versions ? $('#nsVersion').value : undefined,
      ramGb: Number($('#nsRam').value), acceptEula: $('#nsEula').checked,
    });
    // Der Server meldet "switched": die Seite lädt neu. Danach zeigt die Einrichtung den Fortschritt.
    if (t.id === 'modpack') location.hash = '#setup';
  });
});

// ---------------------------------------------------------------- Einrichtung für Nicht-Modpack-Server

function renderPlain(s) {
  const busy = !!state.job?.running;
  const info = $('#plainInfo');
  info.replaceChildren(el('b', {}, `${s.typeLabel} ${s.mcVersion || ''}`.trim()),
    s.loaderVersion ? el('span', { class: 'muted' }, ` · ${s.type === 'paper' || s.type === 'purpur' ? 'Build' : 'Version'} ${s.loaderVersion}`) : null,
    el('div', { class: 'muted small' }, s.steps.install ? '✔ Installiert. Weiter mit der EULA und Java.' : 'Noch nicht installiert. Ein Klick lädt Server-Datei und richtet alles ein.'));
  $('#btnPlainInstall').textContent = s.steps.install ? 'Neu installieren' : 'Jetzt installieren';
  $('#btnPlainInstall').disabled = busy || state.server.state !== 'aus';
  setStep('stepPlain', s.steps.install, false);
  $('#stepPlain h2 .num').textContent = '1';
  $('#step3 h2 .num').textContent = '2';
  $('#step4 h2 .num').textContent = '3';
  if (!$('#upgradeVersion').options.length || $('#upgradeVersion').dataset.type !== s.type) {
    $('#upgradeVersion').dataset.type = s.type;
    loadVersionsInto($('#upgradeVersion'), s.type, $('#upgradeSnapshots').checked).then(() => { if (s.mcVersion) $('#upgradeVersion').value = s.mcVersion; });
  }
}

$('#btnPlainInstall').addEventListener('click', (e) => guarded(e.currentTarget, async () => { jobDismissed = null; await api('POST', '/api/setup/install'); }));
$('#upgradeSnapshots').addEventListener('change', () => {
  loadVersionsInto($('#upgradeVersion'), state.setup.type, $('#upgradeSnapshots').checked);
});
$('#btnUpgrade').addEventListener('click', (e) => guarded(e.currentTarget, async () => {
  const v = $('#upgradeVersion').value;
  if (!v || /Lade|Nicht/.test(v)) return;
  if (!confirm(`Auf Minecraft ${v} wechseln?\n\nDie Welt wird vorher automatisch gesichert. Plugins und Mods müssen danach evtl. aktualisiert werden.`)) return;
  jobDismissed = null;
  await api('POST', '/api/servers/upgrade', { mcVersion: v });
}));

// ---------------------------------------------------------------- Plugins oder Mods je nach Typ

function applyKind(s) {
  state.kind = s.kind;
  const plugins = s.kind === 'plugins';
  const none = s.kind === 'none';
  const word = plugins ? 'Plugins' : 'Mods';
  const nav = $('#tabs [data-tab=mods]');
  nav.hidden = none;
  nav.lastChild.textContent = ` ${word}`;
  $('#tab-mods > h1').textContent = word;
  for (const h of $$('#tab-mods .card h2')) {
    if (!h.dataset.orig) h.dataset.orig = h.textContent;
    const label = plugins ? h.dataset.orig.replace('Mods', 'Plugins').replace('Mod', 'Plugin') : h.dataset.orig;
    const count = h.querySelector('#modCount');
    if (count) h.firstChild.textContent = `${label.trim()} `;
    else h.textContent = label;
  }
  $('#qMods').innerHTML = `<svg class="action-icon" aria-hidden="true"><use href="assets/icons.svg#mods"></use></svg> ${plugins ? 'Plugin' : 'Mod'} hinzufügen`;
  $('#qMods').hidden = none;
  $('#cardUpdates').hidden = none;
  $('#cardImprove').hidden = plugins || none;
  $('#cardExclude').hidden = plugins || none;
  $('#modsRunning').textContent = `Der Server läuft. ${word} können nur bei gestopptem Server ein- und ausgeschaltet werden.`;
  renderRecommended(s);
}

// Empfehlungen (Modrinth-Projekte): [slug, Titel, Beschreibung]
const REC_PLUGINS = [
  ['luckperms', 'LuckPerms', 'Rechte und Rollen für Spieler'],
  ['essentialsx', 'EssentialsX', 'Homes, Warps, Teleport und viele Befehle'],
  ['worldedit', 'WorldEdit', 'Bauen mit Befehlen'],
  ['worldguard', 'WorldGuard', 'Bereiche schützen'],
  ['coreprotect', 'CoreProtect', 'Griefing nachverfolgen und rückgängig machen'],
  ['griefprevention', 'GriefPrevention', 'Grundstücke mit der Goldschaufel schützen'],
  ['chunky', 'Chunky', 'Welt vorladen, dadurch weniger Ruckler'],
  ['viaversion', 'ViaVersion', 'Auch Spieler mit neueren Minecraft-Versionen'],
  ['viabackwards', 'ViaBackwards', 'Auch Spieler mit älteren Minecraft-Versionen'],
  ['simple-voice-chat', 'Simple Voice Chat', 'Sprachchat im Spiel'],
  ['bluemap', 'BlueMap', 'Live-Karte deiner Welt im Browser'],
  ['placeholderapi', 'PlaceholderAPI', 'Platzhalter für andere Plugins'],
];
const REC_MODS = [
  ['spark', 'spark', 'Profiler: findet, was den Server bremst'],
  ['lithium', 'Lithium', 'Macht den Server schneller'],
  ['ferrite-core', 'FerriteCore', 'Spart Arbeitsspeicher'],
  ['chunky', 'Chunky', 'Welt vorladen, dadurch weniger Ruckler'],
  ['simple-voice-chat', 'Simple Voice Chat', 'Sprachchat im Spiel'],
  ['bluemap', 'BlueMap', 'Live-Karte deiner Welt im Browser'],
];
const REC_FABRIC = [['fabric-api', 'Fabric API', 'Wird von fast allen Fabric-Mods gebraucht'], ...REC_MODS];

const recIconCache = new Map();

async function loadRecommendedIcons(slugs) {
  const unknown = slugs.filter((slug) => !recIconCache.has(slug));
  if (!unknown.length) return recIconCache;
  try {
    const rows = await Promise.all(unknown.map(async (slug) => {
      const res = await fetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(slug)}`);
      if (!res.ok) throw new Error('Modrinth nicht erreichbar');
      const project = await res.json();
      recIconCache.set(slug, { icon: project.icon_url });
    }));
    void rows;
  } catch { /* Die Empfehlungen bleiben auch ohne Internet bedienbar. */ }
  return recIconCache;
}

async function renderRecommended(s) {
  const card = $('#cardRecommended');
  if (s.kind === 'none') { card.hidden = true; return; }
  card.hidden = false;
  const list = s.kind === 'plugins' ? REC_PLUGINS : s.type === 'fabric' ? REC_FABRIC : REC_MODS;
  const icons = await loadRecommendedIcons(list.map(([slug]) => slug));
  if (state.setup !== s) return;
  $('#recList').replaceChildren(...list.map(([slug, title, desc]) => {
    const info = icons.get(slug);
    return el('li', {},
    info?.icon ? el('img', { src: info.icon, alt: '', loading: 'lazy' }) : el('div', { class: 'noicon' }, title.charAt(0)),
    el('div', { class: 'body' }, el('b', {}, title), el('div', { class: 'desc' }, desc)),
    el('button', {
      class: 'btn small primary',
      onclick: (e) => guarded(e.currentTarget, async () => { jobDismissed = null; await api('POST', '/api/modrinth/install', { id: slug }); }),
    }, 'Installieren'));
  }));
}


// ---------------------------------------------------------------- Server-Presets

const PS = { list: [], picked: null, nameTouched: false, token: 0 };
const PRESET_ICONS = { crossplay: 'crossplay', survival: 'survival', performance: 'spark', creative: 'creative', freunde: 'friends', friends: 'friends', fabric: 'mods', neoforge: 'setup' };

function presetIcon(p, className = 'tc-icon') {
  const prefix = p.id?.split('-')[0] || 'default';
  const key = PRESET_ICONS[p.id] || PRESET_ICONS[prefix] || 'servers';
  const visual = el('span', { class: `${className} preset-visual preset-${prefix}` });
  visual.innerHTML = `<svg aria-hidden="true"><use href="assets/icons.svg#${key}"></use></svg>`;
  return visual;
}

async function loadPresets() {
  if (!PS.list.length) PS.list = (await api('GET', '/api/presets')).presets;
  $('#presetCards').replaceChildren(...PS.list.map((p) => el('button', {
    type: 'button', class: `type-card${PS.picked?.id === p.id ? ' sel' : ''}`, onclick: () => pickPreset(p.id),
  }, presetIcon(p), el('b', {}, p.name), el('span', { class: 'muted small' }, p.desc),
  el('span', { class: 'tag' }, `${p.typeLabel} · ${p.kind === 'plugins' ? 'Plugins' : 'Mods'}`))));
}

async function refreshPresetVersions() {
  const p = PS.picked;
  const token = ++PS.token;
  const sel = $('#psVersion');
  sel.replaceChildren(el('option', {}, 'Suche passende Version …'));
  sel.disabled = true;
  $('#psVersionHint').textContent = '';
  try {
    const r = await api('GET', `/api/presets/suggest?preset=${enc(p.id)}&bedrock=${$('#psBedrock').checked ? 1 : 0}`);
    if (token !== PS.token) return;
    sel.replaceChildren(...r.versions.map((v) => el('option', { value: v }, v === r.version ? `${v} (empfohlen)` : v)));
    sel.value = r.version;
    sel.disabled = false;
    $('#psVersionHint').textContent = r.missing.length
      ? `Für diese Version gibt es bei Modrinth noch nicht alles. Es fehlt: ${r.missing.join(', ')}. Das wird beim Installieren übersprungen.`
      : 'Für diese Version sind alle Bestandteile verfügbar.';
  } catch (e) {
    sel.replaceChildren(el('option', {}, 'Nicht verfügbar'));
    toast(e.message, 'error');
  }
}

async function pickPreset(id) {
  PS.picked = PS.list.find((x) => x.id === id);
  PS.nameTouched = false;
  const p = PS.picked;
  await loadPresets();
  $('#presetForm').hidden = false;
  $('#presetTitle').replaceChildren(presetIcon(p, 'preset-title-icon'), document.createTextNode(p.name));
  $('#presetDesc').textContent = p.desc;
  $('#psBedrock').checked = !!p.bedrockDefault;
  $('#presetKind').textContent = `Wird installiert: ${p.typeLabel}-Server, ${p.kind === 'plugins' ? 'Plugins' : 'Mods'} und Einstellungen`;
  $('#presetContent').replaceChildren(...p.content.map((c) => el('span', { class: 'chip' }, c.title)),
    el('span', { class: 'chip' }, `RAM ${p.ramGb} GB`));
  $('#psName').value = p.name;
  $('#psRam').value = String(p.ramGb);
  $('#presetForm').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  await refreshPresetVersions();
}

$('#psName').addEventListener('input', () => { PS.nameTouched = true; });
$('#psBedrock').addEventListener('change', () => { if (PS.picked) refreshPresetVersions(); });

$('#presetForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const p = PS.picked;
  if (!p) return;
  const version = $('#psVersion').value;
  if (!version || /Suche|Nicht/.test(version)) { toast('Bitte warten, bis eine Version gefunden wurde.', 'warn'); return; }
  if (!$('#psEula').checked && !confirm('Du hast die Minecraft-EULA nicht angehakt. Der Server startet erst nach deiner Zustimmung (in der Einrichtung). Trotzdem installieren?')) return;
  guarded($('#psSubmit'), async () => {
    jobDismissed = null;
    await api('POST', '/api/presets/create', {
      preset: p.id, name: $('#psName').value, mcVersion: version, ramGb: Number($('#psRam').value),
      bedrock: $('#psBedrock').checked, acceptEula: $('#psEula').checked,
    });
  });
});


// ---------------------------------------------------------------- Modpacks durchstöbern (Modrinth / CurseForge)

const MP = { offset: 0, total: 0, loaded: false, timer: null, token: 0, hasKey: false };

const MP_SORTS = [['downloads', 'Beliebteste'], ['relevance', 'Relevanz'], ['follows', 'Meist gefolgt'], ['updated', 'Zuletzt aktualisiert'], ['newest', 'Neueste']];

function mpCard(m) {
  const cf = m.source === 'curseforge';
  const fmtN = (n) => Intl.NumberFormat('de-DE', { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0);
  return el('li', { class: 'mp-card' },
    m.icon ? el('img', { src: m.icon, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : el('div', { class: 'noicon' }),
    el('div', { class: 'body' },
      el('div', {}, el('b', {}, m.title), el('span', { class: 'muted small' }, ` von ${m.author || '?'}`)),
      el('div', { class: 'desc' }, m.description),
      el('div', { class: 'mp-meta small muted' },
        el('span', {}, `⬇ ${fmtN(m.downloads)}`), m.follows != null ? el('span', {}, `♥ ${fmtN(m.follows)}`) : null,
        m.updated ? el('span', {}, `🕒 ${new Date(m.updated).toLocaleDateString('de-DE')}`) : null,
        ...(m.versions || []).map((v) => el('span', { class: 'tag' }, v)), ...(m.categories || []).map((c) => el('span', { class: 'tag' }, c)))),
    el('div', { class: 'mp-actions' },
      cf
        ? (m.url ? el('a', { class: 'btn small', href: m.url, target: '_blank', rel: 'noopener', title: 'Direkt-Installation gibt es für CurseForge noch nicht' }, 'Auf CurseForge öffnen') : null)
        : el('button', {
          class: 'btn small primary',
          onclick: (ev) => guarded(ev.currentTarget, async () => {
            if (!$('#nsEula').checked && !confirm('Du hast die Minecraft-EULA nicht angehakt. Der Server startet erst nach deiner Zustimmung. Trotzdem installieren?')) return;
            if (!confirm(`„${m.title}“ als neuen Server installieren?\n\nDas lädt je nach Modpack mehrere hundert MB und dauert ein paar Minuten.`)) return;
            jobDismissed = null;
            const name = SV.nameTouched && $('#nsName').value.trim() ? $('#nsName').value.trim() : m.title.slice(0, 40);
            await api('POST', '/api/modpacks/create', { id: m.id, name, ramGb: Number($('#nsRam').value), acceptEula: $('#nsEula').checked });
          }),
        }, 'Als Server installieren'),
      m.url && !cf ? el('a', { class: 'btn small ghost', href: m.url, target: '_blank', rel: 'noopener', title: 'Auf Modrinth ansehen' }, '↗') : null));
}

async function mpLoad(reset) {
  const token = ++MP.token;
  const source = $('#mpSource').value;
  const ul = $('#mpResults');
  if (reset) { MP.offset = 0; ul.replaceChildren(el('li', { class: 'muted' }, 'Lade Modpacks …')); }
  $('#mpMore').disabled = true;
  $('#mpCfKey').hidden = true;
  try {
    const r = await api('GET', `/api/modpacks/search?source=${source}&q=${enc($('#mpSearch').value.trim())}&index=${$('#mpSort').value}&offset=${MP.offset}`);
    if (token !== MP.token) return;
    MP.total = r.total;
    const cards = r.results.map(mpCard);
    if (reset) ul.replaceChildren(...(cards.length ? cards : [el('li', { class: 'muted' }, 'Nichts gefunden.')]));
    else ul.append(...cards);
    MP.offset += r.results.length;
    $('#mpMore').hidden = MP.offset >= MP.total || !r.results.length;
    $('#mpCount').textContent = r.total ? `${Intl.NumberFormat('de-DE').format(r.total)} Modpacks` : '';
  } catch (e) {
    if (token !== MP.token) return;
    if (e.code === 'CF_KEY') {
      $('#mpCfKey').hidden = false;
      ul.replaceChildren(el('li', { class: 'muted' }, 'Für CurseForge fehlt noch der Schlüssel (siehe oben).'));
      $('#mpMore').hidden = true;
    } else {
      ul.replaceChildren(el('li', { style: 'color:var(--error)' }, e.message));
    }
  } finally {
    $('#mpMore').disabled = false;
  }
}

function mpReload() { clearTimeout(MP.timer); MP.timer = setTimeout(() => mpLoad(true), 350); }

$('#mpSort').replaceChildren(...MP_SORTS.map(([v, l]) => el('option', { value: v }, l)));
$('#mpSearchForm').addEventListener('submit', (e) => { e.preventDefault(); mpLoad(true); });
$('#mpSearch').addEventListener('input', mpReload);
$('#mpSort').addEventListener('change', () => mpLoad(true));
$('#mpSource').addEventListener('change', () => mpLoad(true));
$('#mpMore').addEventListener('click', () => mpLoad(false));
$('#btnCfKeySave').addEventListener('click', (e) => guarded(e.currentTarget, async () => {
  await api('POST', '/api/curseforge/key', { key: $('#cfKey').value });
  $('#cfKey').value = '';
  toast('Schlüssel gespeichert.', 'ok');
  await mpLoad(true);
}));

/** Beim Wählen von "Modpack": sofort die beliebtesten Modpacks zeigen, ohne dass man suchen muss. */
function mpOpen() {
  if (!MP.loaded) { MP.loaded = true; mpLoad(true); }
}
