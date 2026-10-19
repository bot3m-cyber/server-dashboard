'use strict';
/* Übersicht (Home): Status, Kennzahlen mit Verlauf, Serverliste, Spieler mit Köpfen,
   Aktivität, Mini-Terminal, Schnellaktionen. Nutzt Hilfen aus app.js ($, el, api, toast, guarded, state …). */

const recentLines = [];
const homeInfo = {
  memMb: null, addr: null, memHist: [], playHist: [], overview: null, activity: [], motd: '', iconStamp: Date.now(),
};

// ---------------------------------------------------------------- Hilfsfunktionen

/** Spielerkopf (vom lokalen Server, der ihn bei mc-heads.net holt und zwischenspeichert). */
function head(name, size = 24) {
  const box = el('span', { class: 'head', style: `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.5)}px` });
  const letter = () => { box.replaceChildren(String(name || '?').replace(/^\./, '').charAt(0).toUpperCase()); box.classList.add('letter'); };
  if (/^[A-Za-z0-9_]{1,16}$/.test(name)) {
    const img = el('img', { src: `/api/head/${encodeURIComponent(name)}`, alt: '', loading: 'lazy' });
    img.addEventListener('error', letter);
    box.append(img);
  } else {
    letter();
  }
  return box;
}

function fmtDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const p = (n) => String(n).padStart(2, '0');
  return d ? `${d} Tg ${h} Std` : `${p(h)}:${p(m)}:${p(s % 60)}`;
}

function timeAgo(t) {
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 45) return 'gerade eben';
  if (s < 3600) return `vor ${Math.max(1, Math.round(s / 60))} Min`;
  if (s < 86400) return `vor ${Math.round(s / 3600)} Std`;
  return `vor ${Math.round(s / 86400)} Tg`;
}

const MC_COLORS = {
  0: '#000000', 1: '#0000aa', 2: '#00aa00', 3: '#00aaaa', 4: '#aa0000', 5: '#aa00aa', 6: '#ffaa00', 7: '#aaaaaa',
  8: '#555555', 9: '#5555ff', a: '#55ff55', b: '#55ffff', c: '#ff5555', d: '#ff55ff', e: '#ffff55', f: '#ffffff',
};

/** Minecraft-Farbcodes (§a, §l …) als HTML darstellen, wie in der Serverliste. */
function mcText(text) {
  const frag = document.createDocumentFragment();
  let st = { color: '#aaaaaa', bold: false, italic: false, underline: false, strike: false };
  for (const part of String(text).split(/(§[0-9a-fk-or])/i)) {
    const code = /^§([0-9a-fk-or])$/i.exec(part);
    if (code) {
      const c = code[1].toLowerCase();
      if (MC_COLORS[c]) st = { color: MC_COLORS[c], bold: false, italic: false, underline: false, strike: false };
      else if (c === 'l') st.bold = true;
      else if (c === 'o') st.italic = true;
      else if (c === 'n') st.underline = true;
      else if (c === 'm') st.strike = true;
      else if (c === 'r') st = { color: '#aaaaaa', bold: false, italic: false, underline: false, strike: false };
      continue;
    }
    part.split('\n').forEach((line, i) => {
      if (i) frag.append(document.createElement('br'));
      if (!line) return;
      const span = el('span', {}, line);
      span.style.color = st.color;
      if (st.bold) span.style.fontWeight = '700';
      if (st.italic) span.style.fontStyle = 'italic';
      span.style.textDecoration = [st.underline && 'underline', st.strike && 'line-through'].filter(Boolean).join(' ') || 'none';
      frag.append(span);
    });
  }
  return frag;
}

function spark(svg, data, max) {
  if (!svg) return;
  if (data.length < 2) { svg.replaceChildren(); return; }
  const w = 120;
  const h = 32;
  const top = Math.max(max || 0, ...data, 1);
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * w).toFixed(1)},${(h - 2 - (v / top) * (h - 6)).toFixed(1)}`);
  svg.innerHTML = `<polygon points="0,${h} ${pts.join(' ')} ${w},${h}" fill="currentColor" opacity=".16"/>`
    + `<polyline points="${pts.join(' ')}" fill="none" stroke="currentColor" stroke-width="1.6" vector-effect="non-scaling-stroke"/>`;
}

const isRunning = () => state.server.state === 'läuft';

// ---------------------------------------------------------------- Terminal im Mini-Format

function renderMini() {
  if (state.tab !== 'home') return;
  const box = $('#miniConsole');
  const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
  box.replaceChildren(...recentLines.slice(-40).map((l) => el('div', { class: lineClass(l) }, l)));
  if (stick) box.scrollTop = box.scrollHeight;
}

$('#miniCmdForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#miniCmd');
  const cmd = input.value.trim();
  if (!cmd) return;
  input.value = '';
  guarded(null, () => api('POST', '/api/server/command', { command: cmd }));
});

const CHIPS = ['list', 'neoforge tps', 'time query daytime', 'seed', 'gamerule keepInventory true', 'difficulty normal'];
$('#cmdChips').replaceChildren(...CHIPS.map((c) => el('button', {
  class: 'chip', type: 'button', onclick: () => { $('#miniCmd').value = c; $('#miniCmd').focus(); },
}, c)));

// ---------------------------------------------------------------- Schnellaktionen

const QUICK = [
  ['☀️ Tag', 'time set day'], ['🌙 Nacht', 'time set night'], ['⛅ Wetter klar', 'weather clear'], ['🌧 Regen', 'weather rain'],
  ['💾 Welt speichern', 'save-all'], ['🔒 Whitelist an', 'whitelist on'], ['🔓 Whitelist aus', 'whitelist off'],
];
$('#quickActions').replaceChildren(...QUICK.map(([label, cmd]) => el('button', {
  class: 'btn small qa', 'data-cmd': cmd,
  onclick: (e) => guarded(e.currentTarget, async () => { await api('POST', '/api/server/command', { command: cmd }); toast(`${label} ausgeführt`, 'ok', 2500); }),
}, label)));

$('#sayForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const msg = $('#sayInput').value.trim();
  if (!msg) return;
  guarded($('button', e.currentTarget), async () => { await api('POST', '/api/server/command', { command: `say ${msg}` }); $('#sayInput').value = ''; });
});

// ---------------------------------------------------------------- Aktivität & Spieler

function activityRow(a) {
  const text = {
    join: [el('b', {}, a.name), ' ist beigetreten'],
    leave: [el('b', {}, a.name), ' hat den Server verlassen'],
    chat: [el('b', {}, a.name), `: ${a.text}`],
    advancement: [el('b', {}, a.name), ` 🏆 ${a.text}`],
  }[a.type] || [a.name];
  return el('li', { class: `feed-${a.type}` }, head(a.name, 24), el('span', { class: 'feed-text' }, ...text), el('span', { class: 'feed-time muted small' }, timeAgo(a.t)));
}

function renderFeed() {
  const ul = $('#activityFeed');
  const items = homeInfo.activity.slice(-12).reverse();
  ul.replaceChildren(...(items.length ? items.map(activityRow) : [el('li', { class: 'muted' }, 'Noch nichts passiert. Hier erscheinen Beitritte, Chat und Erfolge.')]));
}

function renderHomePlayers() {
  const pl = state.server.players || [];
  const run = isRunning();
  $('#homePlayerCount').textContent = run ? `(${pl.length}${state.server.maxPlayers ? ` von ${state.server.maxPlayers}` : ''})` : '';
  $('#homePlayers').replaceChildren(...(!run ? [el('li', { class: 'muted' }, 'Der Server läuft nicht.')]
    : !pl.length ? [el('li', { class: 'muted' }, 'Gerade ist niemand online.')]
      : pl.map((n) => el('li', { class: 'pcard', title: n }, head(n, 40), el('span', {}, n)))));
}

/** Vom Live-Kanal: neuer Eintrag im Aktivitäts-Feed. */
function onActivity(a) {
  homeInfo.activity.push(a);
  if (homeInfo.activity.length > 80) homeInfo.activity.shift();
  if (state.tab === 'home') renderFeed();
  if (a.type === 'join' && typeof desktopNotify === 'function') desktopNotify(`${a.name} ist beigetreten`, `Jetzt online: ${(state.server.players || []).length}`);
  if (a.type === 'join') toast(el('span', { class: 'toast-player' }, head(a.name, 22), el('b', {}, a.name), ' ist beigetreten'), 'ok', 4000);
}

// ---------------------------------------------------------------- Serverliste, Welt & System

function renderSlp() {
  const run = isRunning();
  const pl = state.server.players || [];
  $('#slpMotd').replaceChildren(homeInfo.motd ? mcText(homeInfo.motd) : el('span', { class: 'muted' }, 'A Minecraft Server'));
  $('#slpCount').textContent = `${run ? pl.length : '–'}/${state.server.maxPlayers || homeInfo.maxPlayers || '–'}`;
  const su = state.setup;
  $('#slpVer').textContent = !su ? '' : su.type === 'modpack' && su.pack ? `NeoForge ${su.pack.neoforge} · ${su.pack.minecraft}`
    : [su.typeLabel, su.mcVersion].filter(Boolean).join(' ');
  $('#slpBars').className = `slp-bars ${run ? 'on' : ''}`;
}

function renderWorldInfo() {
  const o = homeInfo.overview;
  const dl = $('#worldInfo');
  if (!o) { dl.replaceChildren(); return; }
  const lb = o.lastBackup;
  const old = lb && Date.now() - lb.time > 24 * 3600e3;
  const rows = [
    ['Welt', o.worldExists ? `${o.world} · ${formatBytes(o.worldBytes)}` : 'noch nicht erstellt'],
    ['Letztes Backup', lb ? `${timeAgo(lb.time)}${old ? ' ⚠' : ''}` : 'noch keins'],
    ['Backups', `${o.backupCount}`],
    ['Mods', `${o.modsActive} aktiv · ${o.modsTotal - o.modsActive} aus`],
    ['Freier Speicher', o.freeBytes != null ? formatBytes(o.freeBytes) : '–'],
  ];
  dl.replaceChildren(...rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));
}

$('#iconFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  await guarded(null, async () => {
    const res = await fetch('/api/server/icon', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: f });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
    homeInfo.iconStamp = Date.now();
    $('#slpIcon').style.visibility = '';
    $('#slpIcon').src = `/api/server/icon?t=${homeInfo.iconStamp}`;
    toast(data.restartNeeded ? 'Icon gespeichert. Gilt nach einem Neustart.' : 'Icon gespeichert.', 'ok');
  });
});
$('#slpIcon').addEventListener('error', (e) => { e.target.style.visibility = 'hidden'; });

// ---------------------------------------------------------------- Kopfbereich & Kennzahlen

function updateHome() {
  const hero = $('#hero');
  if (!hero) return;
  const s = state.server;
  const setupDone = !state.setup || state.setup.complete;
  const btn = $('#heroBtn');
  const crashed = s.state === 'aus' && s.crashed;
  const busy = s.state === 'startet' || s.state === 'stoppt';
  const running = s.state === 'läuft';
  hero.className = `hero card ${running ? 'running' : busy ? 'busy' : crashed ? 'crashed' : ''}`;
  $('#heroDot').className = `dot ${running ? 'on' : busy ? 'busy' : crashed ? 'crashed' : 'off'}`;
  const text = { aus: 'Server ist aus', startet: 'Server startet …', läuft: 'Server läuft', stoppt: 'Server wird gestoppt …' }[s.state] || s.state;
  $('#heroState').textContent = crashed ? 'Server ist abgestürzt' : text;
  $('#heroSub').textContent = !setupDone ? 'Die Einrichtung ist noch nicht fertig'
    : crashed ? 'Unter „Server & Konsole“ zeigt die Crash-Hilfe die Ursache'
      : s.state === 'aus' ? 'Bereit zum Starten'
        : s.state === 'startet' ? 'Ein großes Modpack braucht dafür 1 bis 3 Minuten'
          : running ? 'Spieler können sich jetzt verbinden' : 'Die Welt wird gespeichert';
  btn.hidden = running;
  $('#heroSecondary').hidden = !running;
  btn.className = `btn hero-btn${setupDone ? '' : ' setup'}`;
  if (!setupDone) { btn.textContent = '⚙ EINRICHTUNG FORTSETZEN'; btn.disabled = false; }
  else if (s.state === 'aus') { btn.textContent = crashed ? '▶ ERNEUT STARTEN' : '▶ SERVER STARTEN'; btn.disabled = !!state.job?.running; }
  else { btn.textContent = s.state === 'startet' ? 'Startet …' : 'Stoppt …'; btn.disabled = true; }
  $('#heroStop').disabled = s.state === 'stoppt';
  $('#heroRestart').disabled = !!state.job?.running || s.state === 'stoppt';

  for (const b of $$('.qa')) b.disabled = !running;
  $('#sayForm').querySelectorAll('input,button').forEach((x) => { x.disabled = !running; });
  $('#miniCmd').disabled = s.state === 'aus';
  $('#miniCmdForm button').disabled = s.state === 'aus';

  const pl = s.players || [];
  $('#tilePlayers').textContent = running ? `${pl.length}${s.maxPlayers ? ` / ${s.maxPlayers}` : ''}` : '–';
  $('#tilePlayerNames').textContent = running && pl.length ? pl.slice(0, 6).join(', ') : '';
  renderHomePlayers();
  renderSlp();
  tickHome();
}

function tickHome() {
  const s = state.server;
  if (!$('#tileUptime')) return;
  $('#tileUptime').textContent = s.state === 'läuft' && s.readyAt ? fmtDuration(Date.now() - s.readyAt) : s.state === 'startet' ? 'startet …' : '–';
  $('#tileUptimeSub').textContent = s.state === 'läuft' && s.readyAt ? `seit ${new Date(s.readyAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr` : '';

  const t = s.state === 'läuft' ? s.tps : null;
  const tv = $('#tileTps');
  tv.textContent = t ? t.tps.toFixed(1).replace('.', ',') : '–';
  tv.className = `tile-value ${t ? (t.tps >= 19 ? 'good' : t.tps >= 15 ? 'warnc' : 'bad') : ''}`;
  $('#tileTpsSub').textContent = t ? `${t.mspt != null ? `Tick-Zeit ${t.mspt.toFixed(1).replace('.', ',')} ms · ` : ''}${t.tps >= 19 ? 'läuft flüssig' : t.tps >= 15 ? 'leichte Ruckler' : 'Server hängt'}`
    : s.state === 'läuft' ? 'wird gemessen …' : '20 ist perfekt';

  // Der Java-Prozess belegt mehr als das Heap-Limit (Xmx), weil Mods auch Nativspeicher brauchen.
  const mem = homeInfo.memMb;
  const show = s.state !== 'aus' && mem;
  $('#tileMem').textContent = show ? `${(mem / 1024).toFixed(1).replace('.', ',')} GB` : '–';
  $('#tileMemSub').textContent = state.ram ? `Heap-Limit ${state.ram.xmxGb} GB · PC hat ${state.ram.totalGb} GB` : '';
  spark($('#sparkMem'), homeInfo.memHist, (state.ram?.totalGb || 16) * 1024 * 0.5);
  spark($('#sparkPlayers'), homeInfo.playHist, s.maxPlayers || 4);
}

async function pollStats() {
  if (state.server.state === 'aus') { homeInfo.memMb = null; return; }
  try {
    homeInfo.memMb = (await api('GET', '/api/server/stats')).memMb;
    if (homeInfo.memMb) homeInfo.memHist.push(homeInfo.memMb);
    homeInfo.playHist.push((state.server.players || []).length);
    for (const h of [homeInfo.memHist, homeInfo.playHist]) if (h.length > 60) h.shift();
  } catch { /* egal */ }
  if (state.tab === 'home') tickHome();
}
setInterval(pollStats, 5000);

async function loadHome() {
  const [setup, net, ram, props, act, ov] = await Promise.all([
    api('GET', '/api/setup'), api('GET', '/api/network').catch(() => null), api('GET', '/api/settings/ram').catch(() => null),
    api('GET', '/api/properties').catch(() => null), api('GET', '/api/activity').catch(() => null), api('GET', '/api/overview').catch(() => null),
  ]);
  state.setup = setup;
  state.ram = ram;
  homeInfo.motd = props?.values?.motd || '';
  homeInfo.maxPlayers = props?.values?.['max-players'] || null;
  homeInfo.activity = act?.activity || [];
  homeInfo.overview = ov;
  $('#packName').textContent = headerText(setup);
  const lan = net?.ips.find((i) => i.likelyLan) || net?.ips[0];
  homeInfo.addr = lan ? `${lan.address}${net.port === 25565 ? '' : `:${net.port}`}` : null;
  $('#tileAddr').textContent = homeInfo.addr || 'nicht gefunden';
  $('#slpIcon').style.visibility = '';
  $('#slpIcon').src = `/api/server/icon?t=${homeInfo.iconStamp}`;
  renderMini();
  renderFeed();
  renderWorldInfo();
  updateHome();
  pollStats();
}

// Welt & System und Zeitangaben regelmäßig auffrischen, solange die Übersicht offen ist
setInterval(async () => {
  if (state.tab !== 'home') return;
  try { homeInfo.overview = await api('GET', '/api/overview'); renderWorldInfo(); renderFeed(); } catch { /* egal */ }
}, 30000);

$('#heroBtn').addEventListener('click', (e) => guarded(e.currentTarget, async () => {
  if (state.setup && !state.setup.complete) { showTab('setup'); return; }
  await api('POST', '/api/server/start');
  hideCrash();
}));
$('#heroStop').addEventListener('click', (e) => guarded(e.currentTarget, () => api('POST', '/api/server/stop')));
$('#heroRestart').addEventListener('click', (e) => guarded(e.currentTarget, () => api('POST', '/api/server/restart')));
$('#btnCopyAddr').addEventListener('click', () => {
  if (!homeInfo.addr) return;
  navigator.clipboard.writeText(homeInfo.addr).then(() => toast('Adresse kopiert.', 'ok'), () => toast('Kopieren nicht möglich.', 'error'));
});
$('#qBackup').addEventListener('click', (e) => guarded(e.currentTarget, async () => { jobDismissed = null; await api('POST', '/api/backups'); }));
$('#qMods').addEventListener('click', () => showTab('mods'));
$('#qConsole').addEventListener('click', () => showTab('console'));
$('#qInvite').addEventListener('click', () => showTab('invite'));
setInterval(tickHome, 1000);
