'use strict';
/* Zusatzfunktionen: Übersicht, Mods hinzufügen/verbessern, Auto-Backup, Bedrock.
   Wird nach app.js geladen und nutzt dessen Hilfsfunktionen ($, el, api, toast, guarded, state …). */

// ====================================================================== Mods hinzufügen

async function uploadJars(files) {
  const jars = [...files].filter((f) => /\.jar$/i.test(f.name));
  if (!jars.length) { toast('Bitte .jar-Dateien auswählen.', 'error'); return; }
  let ok = 0;
  for (const f of jars) {
    try {
      const res = await fetch('/api/mods/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(f.name) }, body: f,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
      ok++;
      if (data.warning) toast(data.warning, 'warn', 12000);
    } catch (e) {
      toast(`${f.name}: ${e.message}`, 'error');
    }
  }
  if (ok) toast(`${ok} Mod${ok > 1 ? 's' : ''} hinzugefügt. Gilt ab dem nächsten Serverstart.`, 'ok');
  await loadMods();
}

const dz = $('#dropZone');
['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
dz.addEventListener('drop', (e) => uploadJars(e.dataTransfer.files));
$('#modFiles').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; uploadJars(f); });

let modSearchOffset = 0;

function modResultItem(m) {
  return el('li', {},
    m.icon ? el('img', { src: m.icon, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : el('div', { class: 'noicon' }),
    el('div', { class: 'body' },
      el('b', {}, m.title), el('span', { class: 'muted small' }, ` von ${m.author} · ${Intl.NumberFormat('de-DE').format(m.downloads)} Downloads`),
      m.supportsVersion === false ? el('span', { class: 'tag red' }, 'nicht für deine Version') : null,
      el('div', { class: 'desc' }, m.description)),
    el('button', {
      class: 'btn small primary',
      onclick: (ev) => guarded(ev.currentTarget, async () => { jobDismissed = null; await api('POST', '/api/modrinth/install', { id: m.id }); }),
    }, 'Installieren'));
}

async function runModSearch(append) {
  if (!append) modSearchOffset = 0;
  const q = encodeURIComponent($('#modSearch').value.trim());
  const all = ($('#modSearchAll').checked ? '&all=1' : '') + `&sort=${encodeURIComponent($('#modSearchSort').value)}`;
  const r = await api('GET', `/api/modrinth/search?q=${q}&offset=${modSearchOffset}${all}`);
  const ul = $('#modResults');
  if (!append && !r.results.length) {
    ul.replaceChildren(el('li', { class: 'muted' }, 'Nichts gefunden. Probiere den Haken „Auch Treffer zeigen …“ oder einen anderen Suchbegriff.'));
    $('#modSearchMore').hidden = true; $('#modSearchCount').textContent = '';
    return;
  }
  const items = r.results.map(modResultItem);
  if (append) ul.append(...items); else ul.replaceChildren(...items);
  modSearchOffset += r.results.length;
  $('#modSearchMore').hidden = modSearchOffset >= r.total;
  $('#modSearchCount').textContent = `${Math.min(modSearchOffset, r.total)} von ${Intl.NumberFormat('de-DE').format(r.total)} Treffern (Modrinth)`;
}

$('#modSearchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  guarded($('button', e.currentTarget), () => runModSearch(false));
});
$('#modSearchSort').addEventListener('change', () => guarded(null, () => runModSearch(false)));
$('#modSearchAll').addEventListener('change', () => guarded(null, () => runModSearch(false)));
$('#modSearchMore').addEventListener('click', (e) => guarded(e.currentTarget, () => runModSearch(true)));

// ====================================================================== Mods verbessern

function listBlock(title, items, hint) {
  if (!items.length) return null;
  return el('div', { class: 'imp-block' },
    el('b', {}, `${title} (${items.length})`), hint ? el('div', { class: 'muted small' }, hint) : null,
    el('ul', { class: 'imp-list' }, ...items.map((i) => el('li', {}, typeof i === 'string' ? i : i.label))));
}

function renderImprove(r, applied) {
  const box = $('#improveResult');
  box.hidden = false;
  const nothing = !r.clientOnly.length && !r.excluded.length;
  box.replaceChildren(
    el('h3', {}, applied ? '✔ Mods verbessert' : 'Das würde verbessert werden'),
    nothing ? el('p', {}, 'Alles in Ordnung: Keine reine Client-Mod und kein Ausschluss ist noch aktiv.') : null,
    listBlock(applied ? 'Reine Client-Mods deaktiviert' : 'Reine Client-Mods (laufen nicht auf dem Server)', r.clientOnly),
    listBlock(applied ? 'Von der Ausschlussliste deaktiviert' : 'Stehen auf der Ausschlussliste', r.excluded),
    listBlock('Passen vielleicht nicht zu deiner Version (nur Hinweis, wurde nichts geändert)', r.mismatch,
      'Laut Modrinth ist die Datei nicht für diese Minecraft-Version oder NeoForge gedacht.'),
    r.unknown.length ? el('div', { class: 'muted small' }, `${r.unknown.length} Mod(s) kennt Modrinth nicht (z. B. eigene oder umbenannte Dateien). Die bleiben unverändert.`) : null,
  );
}

$('#btnImprove').addEventListener('click', (e) => guarded(e.currentTarget, async () => {
  toast('Prüfe alle Mods bei Modrinth …', 'info', 3000);
  const preview = await api('POST', '/api/mods/improve', { apply: false });
  renderImprove(preview, false);
  const n = preview.clientOnly.length + preview.excluded.length;
  if (!n) return;
  if (state.server.state !== 'aus') { toast('Zum Anwenden bitte zuerst den Server stoppen.', 'warn'); return; }
  if (!confirm(`${n} Mod(s) deaktivieren?\n\nDie Dateien werden zu .jar.disabled umbenannt, nichts wird gelöscht. Du kannst jede Mod wieder einschalten.`)) return;
  const done = await api('POST', '/api/mods/improve', { apply: true });
  renderImprove(done, true);
  toast(`${done.changed.length} Mod(s) deaktiviert.`, 'ok');
  await loadMods();
}));

// ====================================================================== Auto-Backup

async function loadAutoBackup() {
  const a = await api('GET', '/api/settings/autobackup');
  $('#abHours').value = String(a.hours);
  $('#abKeep').value = a.keep;
}
$('#btnAutoBackup').addEventListener('click', (e) => guarded(e.currentTarget, async () => {
  await api('POST', '/api/settings/autobackup', { hours: Number($('#abHours').value), keep: Number($('#abKeep').value) });
  toast('Gespeichert.', 'ok');
}));

// ====================================================================== Bedrock

async function loadBedrock() {
  const [b, net] = await Promise.all([api('GET', '/api/bedrock'), api('GET', '/api/network').catch(() => null)]);
  const row = (name, m) => el('li', {}, el('span', {}, name), m
    ? el('span', { class: 'tag' }, m.enabled ? `✔ installiert (${m.file})` : 'deaktiviert')
    : el('span', { class: 'tag red' }, 'nicht installiert'));
  $('#bedrockMods').replaceChildren(row('Geyser', b.geyser), row('Floodgate', b.floodgate));
  const both = b.geyser?.enabled && b.floodgate?.enabled;
  const installBtn = $('#btnBedrockInstall');
  installBtn.disabled = b.running || both || !!state.job?.running;
  installBtn.innerHTML = both
    ? 'Bereits installiert ✔'
    : '<svg class="action-icon" aria-hidden="true"><use href="assets/icons.svg#install"></use></svg> Geyser + Floodgate installieren';
  $('#bedrockCfgInfo').textContent = b.configFound
    ? 'Die Geyser-Einstellungen wurden gefunden.'
    : 'Die Geyser-Einstellungen gibt es erst nach dem ersten Serverstart mit Geyser. Danach kannst du sie hier ändern.';
  $('#bedrockAuth').disabled = !b.configFound || b.running;
  $('#btnBedrockAuth').disabled = !b.configFound || b.running;
  if (b.authType) $('#bedrockAuth').value = b.authType;
  const bport = net?.hosted ? net.bedrockPort : b.port;
  $('#bedrockPort').textContent = bport;
  for (const e of $$('.bedrockPort2')) e.textContent = bport;
  const ips = net ? net.ips.filter((i) => !i.tailscale) : [];
  $('#bedrockAddr').replaceChildren(...ips.map((i) => el('div', { class: 'ip' }, el('b', {}, i.address), el('span', { class: 'small muted' }, `Port ${bport}`))));
}
$('#btnBedrockInstall').addEventListener('click', (e) => guarded(e.currentTarget, async () => { jobDismissed = null; await api('POST', '/api/bedrock/install'); }));
$('#btnBedrockAuth').addEventListener('click', (e) => guarded(e.currentTarget, async () => {
  await api('POST', '/api/bedrock/auth', { type: $('#bedrockAuth').value });
  toast('Gespeichert. Gilt nach dem nächsten Serverstart.', 'ok');
}));



// ====================================================================== Spielerkarten (Spieler-Tab)

function playerCard(name) {
  const isOp = !!state.ops?.has(name.toLowerCase());
  const act = (action, label, cls, ask) => el('button', {
    class: `btn small ${cls || ''}`,
    onclick: (e) => guarded(e.currentTarget, async () => {
      let reason = '';
      if (ask) {
        reason = prompt(`${label}: ${name}\nGrund (optional, wird dem Spieler angezeigt):`, '');
        if (reason === null) return;
      }
      await api('POST', '/api/player-action', { name, action, reason });
      toast(`${name}: ${label} ausgeführt.`, 'ok');
      setTimeout(() => loadPlayers().catch(() => {}), 1500);
    }),
  }, label);
  return el('li', { class: 'pcard-row' },
    head(name, 44),
    el('div', { class: 'pcard-name' }, el('b', {}, name), isOp ? el('span', { class: 'tag' }, 'OP') : null),
    el('div', { class: 'pcard-actions' },
      act(isOp ? 'deop' : 'op', isOp ? 'OP entziehen' : 'OP geben'),
      el('select', {
        class: 'btn small', 'aria-label': `Spielmodus für ${name}`,
        onchange: (e) => { const v = e.target.value; e.target.value = ''; if (!v) return; guarded(null, async () => { await api('POST', '/api/player-action', { name, action: v }); toast(`${name}: Spielmodus geändert.`, 'ok'); }); },
      }, el('option', { value: '' }, 'Spielmodus …'), el('option', { value: 'survival' }, 'Überleben'), el('option', { value: 'creative' }, 'Kreativ'),
      el('option', { value: 'adventure' }, 'Abenteuer'), el('option', { value: 'spectator' }, 'Zuschauer')),
      act('kick', 'Kicken', '', true),
      act('ban', 'Bannen', 'danger', true)));
}

// ====================================================================== Konsole: Filter & Suche

const consoleFilter = { mode: 'all', q: '' };

function applyConsoleFilter() {
  consoleEl.className = `log console f-${consoleFilter.mode}`;
  const q = consoleFilter.q.toLowerCase();
  for (const d of consoleEl.children) d.hidden = !!q && !d.textContent.toLowerCase().includes(q);
}

for (const b of $$('#consoleFilter button')) {
  b.addEventListener('click', () => {
    consoleFilter.mode = b.dataset.f;
    for (const x of $$('#consoleFilter button')) x.classList.toggle('active', x === b);
    applyConsoleFilter();
    scrollConsole(true);
  });
}
$('#consoleSearch').addEventListener('input', (e) => { consoleFilter.q = e.target.value.trim(); applyConsoleFilter(); });

// ====================================================================== Befehlspalette (Strg+K)

const palette = { open: false, items: [], index: 0 };

function paletteActions() {
  const st = state.server.state;
  const acts = [
    { icon: '▶', label: 'Server starten', ok: st === 'aus', run: () => api('POST', '/api/server/start') },
    { icon: '■', label: 'Server stoppen', ok: st === 'läuft' || st === 'startet', run: async () => { if (await confirmServerAction('stop')) await api('POST', '/api/server/stop'); } },
    { icon: '↻', label: 'Server neu starten', ok: st === 'läuft', run: async () => { if (await confirmServerAction('restart')) await api('POST', '/api/server/restart'); } },
    { icon: '💾', label: 'Welt sichern', ok: true, run: async () => { jobDismissed = null; await api('POST', '/api/backups'); } },
    { icon: '✨', label: 'Mods verbessern (Client-Mods abschalten)', ok: true, run: () => { showTab('mods'); setTimeout(() => $('#btnImprove').click(), 400); } },
    { icon: '📋', label: 'Server-Adresse kopieren', ok: !!homeInfo.addr, run: () => navigator.clipboard.writeText(homeInfo.addr).then(() => toast('Adresse kopiert.', 'ok')) },
    { icon: 'ℹ', label: 'Info: Freund verbindet sich mit PC (Java)', ok: true, run: () => openInfo('java') },
    { icon: 'ℹ', label: 'Info: Freunde verbinden sich mit Bedrock (Handy, Switch, Xbox, PlayStation)', ok: true, run: () => openInfo('bedrock') },
  ];
  for (const b of $$('#tabs button')) acts.push({ icon: '➜', label: `Gehe zu: ${b.textContent.trim()}`, ok: true, run: () => showTab(b.dataset.tab) });
  return acts.filter((a) => a.ok);
}

function renderPalette() {
  const q = $('#paletteInput').value.trim();
  const ql = q.toLowerCase();
  let items = paletteActions().filter((a) => !ql || a.label.toLowerCase().includes(ql));
  if (q && state.server.state !== 'aus') {
    items.push({ icon: '⌨', label: `Befehl senden: ${q.replace(/^\//, '')}`, run: () => api('POST', '/api/server/command', { command: q }) });
  }
  palette.items = items;
  palette.index = Math.min(palette.index, Math.max(0, items.length - 1));
  $('#paletteList').replaceChildren(...items.map((a, i) => el('li', {
    class: i === palette.index ? 'sel' : null,
    onmousemove: () => { palette.index = i; renderPalette(); },
    onclick: () => runPalette(i),
  }, el('span', { class: 'pi' }, a.icon), a.label)));
  if (!items.length) $('#paletteList').append(el('li', { class: 'muted' }, 'Nichts gefunden.'));
}

function openPalette() {
  palette.open = true;
  palette.index = 0;
  $('#palette').hidden = false;
  $('#paletteInput').value = '';
  renderPalette();
  $('#paletteInput').focus();
}
function closePalette() {
  palette.open = false;
  $('#palette').hidden = true;
}
async function runPalette(i) {
  const a = palette.items[i];
  closePalette();
  if (!a) return;
  try { await a.run(); } catch (e) { toast(e.message, 'error'); }
}

$('#paletteInput').addEventListener('input', () => { palette.index = 0; renderPalette(); });
$('#paletteInput').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { palette.index = Math.min(palette.items.length - 1, palette.index + 1); renderPalette(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { palette.index = Math.max(0, palette.index - 1); renderPalette(); e.preventDefault(); }
  else if (e.key === 'Enter') { runPalette(palette.index); e.preventDefault(); }
});
$('#palette').addEventListener('mousedown', (e) => { if (e.target === $('#palette')) closePalette(); });
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); palette.open ? closePalette() : openPalette(); }
  else if (e.key === 'Escape' && palette.open) closePalette();
});
$('#qPalette').addEventListener('click', openPalette);
