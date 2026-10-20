'use strict';
/* Server-Dashboard – Oberfläche (ohne Framework) */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}

function formatBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0).replace('.', ',')} ${u[i]}`;
}
const fmtDate = (t) => new Date(t).toLocaleString('de-DE');

async function api(method, url, body) {
  const opt = { method, headers: {} };
  if (body !== undefined) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, opt);
  } catch {
    throw new Error('Das Dashboard ist nicht erreichbar. Läuft das Fenster mit start.bat noch?');
  }
  let data = null;
  try { data = await res.json(); } catch { /* keine JSON-Antwort */ }
  if (!res.ok) {
    const err = new Error(data?.error || `Fehler ${res.status}`);
    err.status = res.status;
    err.code = data?.code;
    if (res.status === 401 && data?.code === 'LOGIN') location.href = '/login'; // Sitzung abgelaufen (Mehrbenutzer-Modus)
    throw err;
  }
  return data;
}

function toast(msg, type = 'info', ms = 5000) {
  const t = el('div', { class: `toast ${type}`, role: type === 'error' ? 'alert' : 'status' }, msg);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), type === 'error' ? Math.max(ms, 9000) : ms);
}

/** Button sperren, Aktion ausführen, Fehler als Meldung zeigen. */
async function guarded(btn, fn) {
  if (btn) btn.disabled = true;
  try {
    return await fn();
  } catch (e) {
    toast(e.message, 'error');
    return undefined;
  } finally {
    if (btn) btn.disabled = false;
    updateControls();
  }
}

const state = { server: { state: 'aus' }, setup: null, job: null, tab: null };

// ====================================================================== Tabs

const loaders = {
  home: () => loadHome(),
  servers: () => loadServers(),
  files: () => loadFiles(),
  auto: () => loadAuto(),
  cloud: () => loadCloud(),
  bedrock: () => loadBedrock(),
  setup: loadSetup,
  console: () => loadCrash(false),
  mods: loadMods,
  settings: loadSettings,
  players: loadPlayers,
  invite: loadInvite,
  backups: loadBackups,
};

function showTab(name) {
  if (!loaders[name]) name = 'setup';
  state.tab = name;
  for (const s of $$('.tab')) s.hidden = s.id !== `tab-${name}`;
  for (const b of $$('#tabs button')) b.classList.toggle('active', b.dataset.tab === name);
  if (location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
  Promise.resolve(loaders[name]()).catch((e) => toast(e.message, 'error'));
  window.scrollTo(0, 0); // jede Seite beginnt oben
  if (name === 'console') scrollConsole(true);
}

$$('#tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

// ====================================================================== Aussehen

const APPEARANCE_KEY = 'server-dashboard-appearance-v2';
const APPEARANCE_DEFAULT = { mode: 'dark', palette: 'green', accent: '#65c77a', background: '#0d1210', panel: '#151d18' };
const THEME_PALETTES = {
  green: { accent: '#65c77a', dark: ['#0d1210', '#151d18'], light: ['#edf5ef', '#ffffff'] },
  blue: { accent: '#5aa8ff', dark: ['#0d1119', '#151d2a'], light: ['#eef5ff', '#ffffff'] },
  violet: { accent: '#bd83ff', dark: ['#120f18', '#1c1728'], light: ['#f6f0ff', '#ffffff'] },
  ember: { accent: '#f19a4c', dark: ['#17110d', '#251912'], light: ['#fff4eb', '#ffffff'] },
};

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift) => Math.max(0, Math.min(255, (n >> shift & 255) + amount)).toString(16).padStart(2, '0');
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `${n >> 16 & 255} ${n >> 8 & 255} ${n & 255}`;
}

function hueOffset(hex) {
  const value = parseInt(hex.slice(1), 16);
  const r = (value >> 16 & 255) / 255;
  const g = (value >> 8 & 255) / 255;
  const b = (value & 255) / 255;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min;
  if (!d) return '0deg';
  let hue = max === r ? (g - b) / d % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  hue = (hue * 60 + 360) % 360;
  return `${Math.round(hue - 130)}deg`;
}

function paletteSurface(palette, mode) {
  const values = THEME_PALETTES[palette]?.[mode];
  return values ? { background: values[0], panel: values[1] } : null;
}

function storedAppearance() {
  try { return { ...APPEARANCE_DEFAULT, ...JSON.parse(localStorage.getItem(APPEARANCE_KEY) || '{}') }; }
  catch { return { ...APPEARANCE_DEFAULT }; }
}

let appearance = storedAppearance();

function syncAppearanceControls() {
  for (const b of $$('#themeMode button')) b.classList.toggle('active', b.dataset.mode === appearance.mode);
  for (const b of $$('#themeSwatches button')) b.classList.toggle('active', b.dataset.palette === appearance.palette);
  $('#themeAccent').value = appearance.accent;
  $('#themeBackground').value = appearance.background;
  $('#themePanel').value = appearance.panel;
}

function applyAppearance(save = true) {
  const root = document.documentElement;
  document.body.classList.toggle('light-theme', appearance.mode === 'light');
  root.style.setProperty('--accent', appearance.accent);
  root.style.setProperty('--accent-2', shade(appearance.accent, -42));
  root.style.setProperty('--accent-deep', shade(appearance.accent, -86));
  root.style.setProperty('--accent-rgb', rgb(appearance.accent));
  root.style.setProperty('--art-hue', hueOffset(appearance.accent));
  root.style.setProperty('--bg', appearance.background);
  root.style.setProperty('--panel', appearance.panel);
  root.style.setProperty('--panel-2', appearance.mode === 'light' ? '#f4f7f5' : shade(appearance.panel, 7));
  root.style.setProperty('--border', appearance.mode === 'light' ? '#cbd7cf' : shade(appearance.panel, 26));
  if (save) localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance));
  syncAppearanceControls();
}

function setThemeMode(mode) {
  appearance.mode = mode;
  const surface = paletteSurface(appearance.palette, mode);
  if (surface) Object.assign(appearance, surface);
  applyAppearance();
}

for (const b of $$('#themeMode button')) b.addEventListener('click', () => setThemeMode(b.dataset.mode));
for (const b of $$('#themeSwatches button')) b.addEventListener('click', () => {
  appearance.palette = b.dataset.palette;
  appearance.accent = THEME_PALETTES[appearance.palette].accent;
  Object.assign(appearance, paletteSurface(appearance.palette, appearance.mode));
  applyAppearance();
});
$('#themeAccent').addEventListener('input', (e) => { appearance.palette = 'custom'; appearance.accent = e.target.value; applyAppearance(); });
$('#themeBackground').addEventListener('input', (e) => { appearance.palette = 'custom'; appearance.background = e.target.value; applyAppearance(); });
$('#themePanel').addEventListener('input', (e) => { appearance.palette = 'custom'; appearance.panel = e.target.value; applyAppearance(); });
$('#btnThemeReset').addEventListener('click', () => { appearance = { ...APPEARANCE_DEFAULT }; applyAppearance(); });
applyAppearance(false);

// ====================================================================== Kopfzeile / Status

const STATE_LABEL = { aus: 'Aus', startet: 'Startet …', läuft: 'Läuft', stoppt: 'Stoppt …' };
const STATE_CLASS = { aus: 'off', startet: 'starting', läuft: 'on', stoppt: 'stopping' };

function renderStatus(s) {
  state.server = s;
  const pill = $('#statusPill');
  pill.className = `pill ${s.state === 'aus' && s.crashed ? 'crashed' : STATE_CLASS[s.state] || 'off'}`;
  pill.textContent = s.state === 'aus' && s.crashed ? 'Abgestürzt' : STATE_LABEL[s.state] || s.state;
  updateControls();
  if (typeof updateHome === 'function') updateHome();
}

function updateControls() {
  const st = state.server.state;
  const jobRunning = !!state.job?.running;
  const setupIncomplete = !!state.setup && !state.setup.complete;
  $('#btnStart').disabled = st !== 'aus' || jobRunning || setupIncomplete;
  $('#btnStart').title = setupIncomplete ? 'Erst die Einrichtung abschließen' : '';
  $('#btnStop').disabled = st === 'aus' || st === 'stoppt';
  $('#btnRestart').disabled = st !== 'läuft' || jobRunning;
  $('#cmdInput').disabled = st === 'aus';
  if (typeof updateHome === 'function') updateHome();
}

$('#btnStart').addEventListener('click', (e) => guarded(e.currentTarget, async () => {
  await api('POST', '/api/server/start');
  hideCrash();
  showTab('console');
}));
$('#btnStop').addEventListener('click', (e) => guarded(e.currentTarget, async () => { if (await confirmServerAction('stop')) await api('POST', '/api/server/stop'); }));
$('#btnRestart').addEventListener('click', (e) => guarded(e.currentTarget, async () => { if (await confirmServerAction('restart')) await api('POST', '/api/server/restart'); }));

// ====================================================================== Live-Verbindung (SSE)

function connect() {
  const es = new EventSource('/api/events');
  es.onopen = () => { $('#connLost').hidden = true; };
  es.onerror = () => { $('#connLost').hidden = false; };
  es.addEventListener('status', (e) => renderStatus(JSON.parse(e.data)));
  es.addEventListener('history', (e) => {
    $('#console').textContent = '';
    if (typeof recentLines !== 'undefined') recentLines.length = 0;
    appendLines(JSON.parse(e.data));
  });
  es.addEventListener('activity', (e) => { if (typeof onActivity === 'function') onActivity(JSON.parse(e.data)); });
  es.addEventListener('lines', (e) => appendLines(JSON.parse(e.data)));
  es.addEventListener('players', (e) => {
    const p = JSON.parse(e.data);
    state.server.players = p.players;
    if (p.maxPlayers) state.server.maxPlayers = p.maxPlayers;
    if (state.tab === 'players') renderOnline(p.players, p.maxPlayers);
    if (typeof updateHome === 'function') updateHome();
  });
  es.addEventListener('crash', () => {
    toast('Der Server ist abgestürzt. Die Crash-Hilfe zeigt dir die Ursache.', 'error');
    if (typeof desktopNotify === 'function') desktopNotify('Server abgestürzt', 'Die Crash-Hilfe im Dashboard zeigt die Ursache.');
    showTab('console');
    loadCrash(true);
  });
  es.addEventListener('switched', () => location.reload());
  es.addEventListener('modmeta', () => { if (state.tab === 'mods') loadMods(); });
  es.addEventListener('job', (e) => renderJob(JSON.parse(e.data)));
  es.addEventListener('joblog', (e) => {
    const { id, line } = JSON.parse(e.data);
    if (state.job && state.job.id === id) appendJobLog(line);
  });
}

// ====================================================================== Aufgaben (Fortschritt)

let jobDismissed = null;

function renderJob(job) {
  const prev = state.job;
  state.job = job;
  updateControls();
  const panel = $('#jobPanel');
  if (!job || (!job.running && jobDismissed === job.id)) { panel.hidden = true; return; }
  // Alte, erfolgreich beendete Aufgaben beim Neuladen der Seite nicht anzeigen
  if (!job.running && !prev && !job.error) { panel.hidden = true; return; }
  panel.hidden = false;
  $('#jobTitle').textContent = job.running ? `${job.label} …` : job.error ? `${job.label}: fehlgeschlagen` : `${job.label}: fertig ✔`;
  const bar = $('#jobBar');
  const prog = $('.progress', panel);
  const p = job.progress;
  if (job.running && (!p || !p.total)) {
    prog.classList.add('indeterminate');
  } else {
    prog.classList.remove('indeterminate');
    const pct = !job.running && !job.error ? 100 : p && p.total ? Math.min(100, (p.done / p.total) * 100) : 0;
    bar.style.width = `${pct.toFixed(1)}%`;
  }
  $('#jobText').textContent = job.running ? p?.text || '' : (job.error ? '' : 'Erledigt.');
  $('#jobError').hidden = !job.error;
  $('#jobError').textContent = job.error || '';
  $('#jobClose').hidden = job.running;
  if (!prev || prev.id !== job.id) {
    $('#jobLog').textContent = '';
    for (const l of job.log || []) appendJobLog(l);
  }
  if (job.error) $('#jobDetails').open = true;

  if (prev && prev.id === job.id && prev.running && !job.running) {
    if (job.error) {
      toast(job.error, 'error');
    } else {
      toast(`${job.label}: fertig.`, 'ok');
      // Erfolgreiche Aufgaben blenden sich nach kurzer Zeit selbst aus
      setTimeout(() => {
        if (state.job?.id === job.id && !state.job.running) { jobDismissed = job.id; panel.hidden = true; }
      }, 8000);
    }
    if (['unpack', 'download', 'neoforge', 'install'].includes(job.type)) loadSetup();
    if (['backup', 'restore'].includes(job.type) && state.tab === 'backups') loadBackups();
    if (job.type === 'download' && state.tab === 'mods') loadMods();
    if (job.type === 'cloud') {
      if (state.tab === 'cloud') loadCloud();
      if (state.tab === 'servers') loadServers();
    }
    if (job.type === 'modinstall') {
      if (state.tab === 'mods') loadMods();
      if (state.tab === 'bedrock') loadBedrock();
    }
  }
}

function appendJobLog(line) {
  const pre = $('#jobLog');
  const atBottom = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 20;
  pre.append(`${line}\n`);
  if (pre.childNodes.length > 1500) pre.firstChild.remove();
  if (atBottom) pre.scrollTop = pre.scrollHeight;
}

$('#jobClose').addEventListener('click', () => {
  jobDismissed = state.job?.id;
  $('#jobPanel').hidden = true;
});

// ====================================================================== Einrichtung

async function loadSetup() {
  const s = await api('GET', '/api/setup');
  state.setup = s;
  renderSetup(s);
}

function setStep(id, done, locked) {
  const card = $(`#${id}`);
  card.classList.toggle('done', !!done);
  card.classList.toggle('locked', !!locked);
}

function headerText(s) {
  if (s.type === 'modpack') {
    return s.pack ? `${s.name} · ${s.pack.name} · Minecraft ${s.pack.minecraft} · NeoForge ${s.pack.neoforge}` : `${s.name} · Modpack noch nicht eingerichtet`;
  }
  const what = `${s.typeLabel}${s.mcVersion ? ` ${s.mcVersion}` : ''}`;
  return s.name.toLowerCase().includes(what.toLowerCase()) ? s.name : `${s.name} · ${what}`;
}

function renderSetup(s) {
  const busy = !!state.job?.running;
  $('#packName').textContent = headerText(s);
  const modpack = s.type === 'modpack';
  $('#step1').hidden = !modpack;
  $('#step2').hidden = !modpack;
  $('#stepPlain').hidden = modpack;
  $('#neoforgeInfo').hidden = !modpack;
  $('#btnNeoforge').parentElement.hidden = !modpack;
  if (!modpack && typeof renderPlain === 'function') renderPlain(s);
  if (typeof applyKind === 'function') applyKind(s);
  if (modpack && typeof refreshPackUpdate === 'function') refreshPackUpdate();

  // Schritt 1
  setStep('step1', s.steps.pack, false);
  const pi = $('#packInfo');
  pi.hidden = !s.pack;
  if (s.pack) {
    pi.replaceChildren(
      el('b', {}, s.pack.name), ` (aus ${s.pack.source})`, el('br'),
      `Minecraft ${s.pack.minecraft} · NeoForge ${s.pack.neoforge} · ${s.pack.files} Dateien im Index`,
    );
  }

  // Schritt 2
  setStep('step2', s.steps.mods, !s.steps.pack);
  if (document.activeElement !== $('#serverDir')) $('#serverDir').value = s.serverDir;
  $('#skipClientOnly').checked = s.skipClientOnly;
  const planInfo = $('#planInfo');
  const det = $('#planDetails');
  if (s.plan) {
    const sm = s.plan.summary;
    planInfo.hidden = false;
    planInfo.replaceChildren(el('div', {}, el('b', {}, `${sm.install} Dateien`), ' kommen aktiv auf den Server, ',
      el('b', {}, `${sm.disabled}`), ' Client-Mods werden deaktiviert abgelegt, ',
      el('b', {}, `${sm.skip}`), ' werden übersprungen. ', `Download: ca. ${formatBytes(sm.bytes)}.`));
    if (s.plan.modrinthError) {
      planInfo.append(el('div', { class: 'small', style: 'color:var(--warn)' },
        `Modrinth war nicht erreichbar (${s.plan.modrinthError}). Client-Mods werden deshalb nicht erkannt. Lies Schritt 1 erneut ein, um es noch einmal zu versuchen.`));
    }
    const list = s.plan.notInstalled;
    det.hidden = !list.length;
    $('#planList').replaceChildren(...list.map((i) => el('li', {},
      el('span', {}, i.title ? `${i.title} ` : '', el('span', { class: 'muted' }, i.fileName)),
      el('span', { class: `tag ${i.action === 'skip' ? 'red' : ''}` }, i.action === 'skip' ? 'übersprungen' : 'deaktiviert'))));
  } else {
    planInfo.hidden = !s.planError;
    planInfo.textContent = s.planError || '';
    det.hidden = true;
  }
  $('#btnDownload').disabled = !s.steps.pack || busy || s.running;
  $('#btnDownload').textContent = s.steps.mods ? 'Mods erneut prüfen / herunterladen' : 'Mods herunterladen';

  // Schritt 3
  setStep('step3', modpack ? s.steps.neoforge : s.java.ok, modpack && !s.steps.pack);
  const j = s.java;
  const ji = $('#javaInfo');
  ji.replaceChildren(el('div', {}, j.ok ? '✔ ' : '✖ ', el('b', {}, j.message)));
  if (j.best) ji.append(el('div', { class: 'muted small' }, j.best.path === 'java' ? 'Aus dem Systempfad (PATH)' : j.best.path));
  $('#javaMissing').hidden = j.ok;
  $('#neoforgeInfo').textContent = s.pack
    ? (s.steps.neoforge ? `NeoForge ${s.pack.neoforge} ist installiert.` : `NeoForge ${s.pack.neoforge} wird von maven.neoforged.net geladen und als Server installiert.`)
    : '';
  $('#btnNeoforge').disabled = !s.steps.pack || !j.ok || busy || s.running;
  $('#btnNeoforge').textContent = s.steps.neoforge ? 'NeoForge neu installieren' : 'NeoForge installieren';

  // Schritt 4
  setStep('step4', s.steps.eula, false);
  $('#eulaCheck').checked = s.steps.eula;

  $('#setupDone').hidden = !s.complete;
  updateControls();
}

$('#mrpackFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!/\.mrpack$/i.test(file.name)) { toast('Bitte eine .mrpack-Datei wählen.', 'error'); return; }
  const info = $('#uploadInfo');
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/setup/upload');
  xhr.setRequestHeader('Content-Type', 'application/octet-stream');
  xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name));
  xhr.upload.onprogress = (ev) => {
    if (ev.lengthComputable) info.textContent = `Übertrage ${file.name}: ${Math.round((ev.loaded / ev.total) * 100)} %`;
  };
  xhr.onload = () => {
    info.textContent = '';
    let data = {};
    try { data = JSON.parse(xhr.responseText); } catch { /* egal */ }
    if (xhr.status >= 400) toast(data.error || `Fehler ${xhr.status}`, 'error');
    else jobDismissed = null;
  };
  xhr.onerror = () => { info.textContent = ''; toast('Die Datei konnte nicht übertragen werden.', 'error'); };
  xhr.send(file);
});

$('#btnMrpackPath').addEventListener('click', (e) => guarded(e.currentTarget, async () => {
  const p = $('#mrpackPath').value.trim();
  if (!p) throw new Error('Bitte einen Pfad eingeben.');
  await api('POST', '/api/setup/path', { path: p });
}));

$('#btnServerDir').addEventListener('click', (e) => guarded(e.currentTarget, async () => {
  const p = $('#serverDir').value.trim();
  try {
    await api('POST', '/api/setup/serverdir', { path: p });
  } catch (err) {
    if (err.code !== 'NOT_EMPTY') throw err;
    if (!confirm(`${err.message}\n\nVorhandene Dateien mit gleichem Namen können überschrieben werden.`)) return;
    await api('POST', '/api/setup/serverdir', { path: p, force: true });
  }
  toast('Server-Ordner gespeichert.', 'ok');
  await loadSetup();
}));

$('#skipClientOnly').addEventListener('change', (e) => guarded(null, async () => {
  await api('POST', '/api/setup/clientonly', { enabled: e.target.checked });
  await loadSetup();
}));

$('#btnDownload').addEventListener('click', (e) => guarded(e.currentTarget, async () => {
  jobDismissed = null;
  await api('POST', '/api/setup/download');
}));

$('#btnJavaCheck').addEventListener('click', (e) => guarded(e.currentTarget, async () => {
  await api('GET', '/api/java');
  await loadSetup();
}));

$('#btnJavaPath').addEventListener('click', (e) => guarded(e.currentTarget, async () => {
  await api('POST', '/api/java', { path: $('#javaPath').value });
  toast('Java-Pfad gespeichert.', 'ok');
  await loadSetup();
}));

$('#btnNeoforge').addEventListener('click', (e) => guarded(e.currentTarget, async () => {
  jobDismissed = null;
  await api('POST', '/api/setup/neoforge');
}));

$('#btnEula').addEventListener('click', (e) => guarded(e.currentTarget, async () => {
  if (!$('#eulaCheck').checked) throw new Error('Bitte erst das Häkchen bei der EULA setzen.');
  await api('POST', '/api/setup/eula', { accepted: true });
  toast('EULA gespeichert.', 'ok');
  await loadSetup();
}));

// ====================================================================== Konsole

const consoleEl = $('#console');

function lineClass(l) {
  if (l.startsWith('[Dashboard]')) return 'sys';
  if (l.startsWith('> ')) return 'cmd';
  if (/\/(ERROR|FATAL)\]|\bException\b|^\s+at /.test(l)) return 'err';
  if (/\/WARN\]/.test(l)) return 'warn';
  if (/\]: <[^>]{1,32}> /.test(l)) return 'chat';
  return null;
}

function scrollConsole(force) {
  if (force || $('#autoScroll').checked) consoleEl.scrollTop = consoleEl.scrollHeight;
}

function appendLines(lines) {
  if (!lines.length) return;
  const frag = document.createDocumentFragment();
  for (const l of lines) frag.append(el('div', { class: lineClass(l) }, l));
  consoleEl.append(frag);
  if (typeof consoleFilter !== 'undefined' && consoleFilter.q) applyConsoleFilter();
  if (typeof recentLines !== 'undefined') {
    recentLines.push(...lines);
    if (recentLines.length > 60) recentLines.splice(0, recentLines.length - 60);
    renderMini();
  }
  while (consoleEl.childElementCount > 3000) consoleEl.firstElementChild.remove();
  scrollConsole(false);
}

const cmdHistory = { list: [], pos: 0 };
$('#cmdForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#cmdInput');
  const cmd = input.value.trim();
  if (!cmd) return;
  cmdHistory.list.push(cmd);
  if (cmdHistory.list.length > 100) cmdHistory.list.shift();
  cmdHistory.pos = cmdHistory.list.length;
  input.value = '';
  guarded(null, () => api('POST', '/api/server/command', { command: cmd }));
});
$('#cmdInput').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp' && cmdHistory.pos > 0) {
    cmdHistory.pos--;
    e.target.value = cmdHistory.list[cmdHistory.pos];
    e.preventDefault();
  } else if (e.key === 'ArrowDown') {
    cmdHistory.pos = Math.min(cmdHistory.list.length, cmdHistory.pos + 1);
    e.target.value = cmdHistory.list[cmdHistory.pos] || '';
    e.preventDefault();
  }
});

// ====================================================================== Crash-Hilfe

let crashHidden = false;

function hideCrash() {
  $('#crashPanel').hidden = true;
}

const HL_RE = /Mod loading issue for:|Mod file:|Missing or unsupported mandatory dependencies|Mod ID: '/;

function renderCrashText(text) {
  const pre = $('#crashText');
  const frag = document.createDocumentFragment();
  let firstHl = null;
  for (const line of String(text).split(/\r?\n/)) {
    if (HL_RE.test(line)) {
      const s = el('span', { class: 'hl' }, line);
      if (!firstHl) firstHl = s;
      frag.append(s);
    } else {
      frag.append(`${line}\n`);
    }
  }
  pre.replaceChildren(frag);
  if (firstHl) setTimeout(() => { pre.scrollTop = Math.max(0, firstHl.offsetTop - 60); }, 0);
}

function disableButton(file, label = 'Diese Mod deaktivieren') {
  return el('button', {
    class: 'btn danger small',
    onclick: (e) => guarded(e.currentTarget, async () => {
      if (!confirm(`„${file}“ deaktivieren?\n\nDie Datei wird zu ${file}.disabled umbenannt. Du kannst sie unter „Mods“ wieder einschalten.`)) return;
      await api('POST', '/api/mods/disable', { file });
      toast(`${file} wurde deaktiviert. Starte den Server jetzt neu.`, 'ok');
      await loadCrash(true);
    }),
  }, label);
}

async function loadCrash(force) {
  if (!force && crashHidden) return;
  const c = await api('GET', '/api/crash');
  const panel = $('#crashPanel');
  if (!c.crashed && !force) { panel.hidden = true; return; }
  if (!c.report && !c.logTail && !c.issues?.length) {
    panel.hidden = !c.crashed;
    if (!c.crashed) { toast('Es gibt keinen Crash-Report.', 'info'); return; }
  }
  crashHidden = false;
  panel.hidden = false;
  $('h2', panel).textContent = c.crashed ? 'Der Server ist abgestürzt' : 'Letzter Crash-Report';
  $('#crashSummary').textContent = c.report
    ? `Crash-Report vom ${fmtDate(c.report.time)}${c.crashed && c.code ? ` · Beendet mit Code ${c.code}` : ''}`
    : 'Es wurde kein Crash-Report geschrieben. Unten stehen die letzten Zeilen der Server-Ausgabe.';

  const box = $('#crashIssues');
  box.replaceChildren();
  for (const i of c.issues || []) {
    const what = el('div', { class: 'what' },
      i.modId ? el('div', {}, 'Problem mit der Mod: ', el('b', {}, i.modId)) : null,
      i.modFile ? el('div', { class: 'small muted' }, 'Datei: ', i.modFile) : null);
    let action;
    if (i.jar && i.enabled) action = disableButton(i.jar);
    else if (i.jar && !i.enabled) action = el('span', { class: 'tag' }, 'bereits deaktiviert');
    else action = el('span', { class: 'small muted' }, 'Datei nicht im mods-Ordner gefunden');
    box.append(el('div', { class: 'issue' }, what, action));
  }
  for (const d of c.missingDeps || []) {
    const what = el('div', { class: 'what' },
      el('div', {}, 'Fehlende Mod: ', el('b', {}, d.missing), ' (gebraucht von ', el('b', {}, d.requestedBy), ')'),
      el('div', { class: 'small muted' }, `Entweder „${d.missing}“ unter „Mods“ wieder einschalten oder „${d.requestedBy}“ deaktivieren.`));
    let action = null;
    if (d.jar && d.enabled) action = disableButton(d.jar, `${d.requestedBy} deaktivieren`);
    box.append(el('div', { class: 'issue' }, what, action));
  }
  if (!c.issues?.length && !c.missingDeps?.length) {
    box.append(el('p', { class: 'muted small' }, 'Keine eindeutige Mod als Ursache gefunden. Schau im Bericht nach Zeilen mit „Caused by“ oder „Exception“.'));
  }
  $('#crashFileName').textContent = c.report ? `Crash-Report: ${c.report.name}` : 'Letzte Server-Ausgabe';
  renderCrashText(c.report ? c.report.text : c.logTail || '');
}

$('#btnCrashReload').addEventListener('click', (e) => guarded(e.currentTarget, () => loadCrash(true)));
$('#btnCrashHide').addEventListener('click', () => { crashHidden = true; hideCrash(); });
$('#btnShowLastCrash').addEventListener('click', (e) => guarded(e.currentTarget, () => loadCrash(true)));

// ====================================================================== Mods

let modsCache = [];
let excludes = [];

async function loadMods() {
  const d = await api('GET', '/api/mods');
  modsCache = d.mods;
  excludes = d.excludes;
  $('#modsRunning').hidden = !d.running;
  renderExcludes();
  renderMods();
}

function renderExcludes() {
  $('#excludeList').replaceChildren(...excludes.map((x, i) => el('li', {},
    el('span', {}, x),
    el('button', {
      title: 'Entfernen', 'aria-label': `${x} entfernen`,
      onclick: () => saveExcludes(excludes.filter((_, j) => j !== i)),
    }, '✕'))));
  if (!excludes.length) $('#excludeList').append(el('li', { class: 'muted' }, 'Die Liste ist leer.'));
}

async function saveExcludes(list) {
  await guarded(null, async () => {
    const r = await api('POST', '/api/excludes', { excludes: list });
    excludes = r.excludes;
    renderExcludes();
    await loadMods();
  });
}

$('#excludeForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('#excludeInput').value.trim();
  if (!v) return;
  $('#excludeInput').value = '';
  saveExcludes([...excludes, v]);
});

$('#btnExcludeApply').addEventListener('click', (e) => guarded(e.currentTarget, async () => {
  const r = await api('POST', '/api/excludes/apply');
  toast(r.changed.length ? `Deaktiviert: ${r.changed.join(', ')}` : 'Keine aktive Mod passt zur Ausschlussliste.', 'ok');
  await loadMods();
}));

const modSel = new Set();

function renderMods() {
  const q = $('#modFilter').value.trim().toLowerCase();
  const running = state.server.state !== 'aus';
  const list = modsCache.filter((m) => !q || m.file.toLowerCase().includes(q) || m.modIds.join(' ').toLowerCase().includes(q)
    || (m.name || '').toLowerCase().includes(q) || (m.title || '').toLowerCase().includes(q));
  const label = (m) => (m.title || m.name || m.file).toLowerCase();
  const sorts = {
    name: (x, y) => label(x).localeCompare(label(y), 'de'),
    'name-desc': (x, y) => label(y).localeCompare(label(x), 'de'),
    enabled: (x, y) => (y.enabled - x.enabled) || label(x).localeCompare(label(y), 'de'),
    disabled: (x, y) => (x.enabled - y.enabled) || label(x).localeCompare(label(y), 'de'),
    size: (x, y) => (y.size || 0) - (x.size || 0),
  };
  list.sort(sorts[$('#modSort').value] || sorts.name);
  const active = modsCache.filter((m) => m.enabled).length;
  $('#modCount').textContent = `(${active} aktiv, ${modsCache.length - active} deaktiviert)`;
  const tbody = $('#modTable');
  if (!modsCache.length) {
    tbody.replaceChildren(el('tr', {}, el('td', { colspan: 7, class: 'muted' }, 'Noch keine Mods im Server-Ordner. Erst die Einrichtung (Schritt 2) erledigen.')));
    return;
  }
  tbody.replaceChildren(...list.map((m) => el('tr', { class: m.enabled ? null : 'off' },
    el('td', {}, el('input', {
      type: 'checkbox', checked: modSel.has(m.file), 'aria-label': `${m.file} auswählen`,
      onchange: (e) => { if (e.target.checked) modSel.add(m.file); else modSel.delete(m.file); updateModBulk(); },
    })),
    el('td', {}, el('input', {
      type: 'checkbox', checked: m.enabled, disabled: running, 'aria-label': `${m.file} aktiv`,
      onchange: (e) => guarded(null, async () => {
        try {
          await api('POST', '/api/mods/toggle', { file: m.file, enabled: e.target.checked });
          m.enabled = e.target.checked;
        } catch (err) {
          e.target.checked = !e.target.checked;
          throw err;
        }
        renderMods();
      }),
    })),
    el('td', { class: 'icon-cell' }, m.iconUrl
      ? el('img', { class: 'mod-icon', src: m.iconUrl, alt: '', loading: 'lazy' })
      : el('div', { class: 'mod-icon letter' }, (m.title || m.name || m.file).charAt(0).toUpperCase())),
    el('td', { class: 'file' }, (m.title || m.name) ? el('div', {}, m.title || m.name) : null,
      el('div', { class: (m.title || m.name) ? 'small muted' : null }, m.file),
      m.excluded ? el('span', { class: 'tag red' }, 'Ausschlussliste') : null,
      m.server === 'unsupported' ? el('span', { class: 'tag' }, 'nur Client') : null),
    el('td', { class: 'hide-sm small muted' }, m.modIds.join(', ')),
    el('td', { class: 'hide-sm right small muted' }, formatBytes(m.size)),
    el('td', { class: 'right' }, el('button', {
      class: 'btn small ghost danger', title: 'Löschen', disabled: running,
      onclick: (e) => guarded(e.currentTarget, () => deleteMods([m.file])),
    }, '🗑')))));
  updateModBulk();
}

function updateModBulk() {
  const n = modSel.size;
  $('#modBulk').hidden = !n;
  $('#modSelCount').textContent = `${n} ausgewählt`;
  $('#btnModDelete').disabled = state.server.state !== 'aus';
}

async function deleteMods(files) {
  if (state.server.state !== 'aus') throw new Error('Zum Löschen bitte zuerst den Server stoppen.');
  const word = state.kind === 'plugins' ? 'Plugin' : 'Mod';
  const what = files.length === 1 ? `„${files[0]}“` : `${files.length} ${word}s`;
  if (!confirm(`${what} löschen?\n\nDie Dateien werden nicht endgültig gelöscht, sondern in den Ordner ${state.kind === 'plugins' ? 'plugins' : 'mods'}_old/geloescht verschoben. Dort kannst du sie zurückholen.`)) return;
  const r = await api('POST', '/api/mods/delete', { files });
  for (const f of files) modSel.delete(f);
  toast(`${r.removed} Datei(en) gelöscht (liegen in ${r.trash}).`, 'ok', 6000);
  await loadMods();
}

$('#btnModDelete').addEventListener('click', (e) => guarded(e.currentTarget, () => deleteMods([...modSel])));
$('#btnModSelNone').addEventListener('click', () => { modSel.clear(); renderMods(); });
$('#modSelAll').addEventListener('change', (e) => {
  const q = $('#modFilter').value.trim().toLowerCase();
  for (const m of modsCache) {
    if (q && !(m.file + ' ' + m.modIds.join(' ') + ' ' + (m.name || '') + ' ' + (m.title || '')).toLowerCase().includes(q)) continue;
    if (e.target.checked) modSel.add(m.file); else modSel.delete(m.file);
  }
  renderMods();
});

$('#modFilter').addEventListener('input', renderMods);
$('#modSort').addEventListener('change', renderMods);

// ====================================================================== Einstellungen

async function loadSettings() {
  const [ram, props] = await Promise.all([api('GET', '/api/settings/ram'), api('GET', '/api/properties')]);
  const max = ram.maxGb || Math.max(2, ram.totalGb - 1);
  $('#xmx').max = max;
  $('#xms').max = max;
  $('#xmx').value = ram.xmxGb;
  $('#xms').value = ram.xmsGb;
  $('#ramTotal').textContent = ram.maxGb && document.body.classList.contains('hosted')
    ? `Für Minecraft stehen auf dieser Seite insgesamt ca. ${ram.totalGb} GB zur Verfügung. Du kannst höchstens ${ram.maxGb} GB pro Server einstellen.`
    : `Dein PC hat ca. ${ram.totalGb} GB Arbeitsspeicher.`;
  updateRamLabels();
  renderProps(props);
}

function updateRamLabels() {
  const xmx = Number($('#xmx').value);
  if (Number($('#xms').value) > xmx) $('#xms').value = xmx;
  $('#xmxVal').textContent = `${xmx} GB`;
  $('#xmsVal').textContent = `${$('#xms').value} GB`;
}
$('#xmx').addEventListener('input', updateRamLabels);
$('#xms').addEventListener('input', () => {
  if (Number($('#xms').value) > Number($('#xmx').value)) $('#xmx').value = $('#xms').value;
  updateRamLabels();
});

$('#btnRamSave').addEventListener('click', (e) => guarded(e.currentTarget, async () => {
  const r = await api('POST', '/api/settings/ram', { xmsGb: Number($('#xms').value), xmxGb: Number($('#xmx').value) });
  toast(r.restartNeeded ? 'RAM gespeichert. Gilt nach einem Neustart des Servers.' : 'RAM gespeichert.', 'ok');
}));

function renderProps(p) {
  const f = $('#propsForm');
  for (const [k, v] of Object.entries(p.values)) {
    const input = f.elements[k];
    if (!input) continue;
    if (input.type === 'checkbox') input.checked = v === 'true';
    else input.value = v;
  }
  $('#propsRaw').value = p.raw || '';
  if (!p.exists) $('#propsRaw').placeholder = 'Die Datei gibt es noch nicht. Sie wird beim ersten Serverstart oder beim Speichern oben angelegt.';
}

$('#propsForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const values = {};
  for (const input of f.elements) {
    if (!input.name) continue;
    values[input.name] = input.type === 'checkbox' ? String(input.checked) : input.value;
  }
  guarded($('button[type=submit]', f), async () => {
    const r = await api('POST', '/api/properties', { values });
    renderProps(r);
    toast(r.restartNeeded ? 'Gespeichert. Starte den Server neu, damit die Änderungen gelten.' : 'Einstellungen gespeichert.', 'ok');
  });
});

$('#btnRawSave').addEventListener('click', (e) => guarded(e.currentTarget, async () => {
  const r = await api('POST', '/api/properties/raw', { text: $('#propsRaw').value });
  renderProps(r);
  toast(r.restartNeeded ? 'Gespeichert. Gilt nach einem Neustart.' : 'server.properties gespeichert.', 'ok');
}));
$('#btnRawReload').addEventListener('click', (e) => guarded(e.currentTarget, async () => renderProps(await api('GET', '/api/properties'))));

// ====================================================================== Spieler

function renderOnline(list, max) {
  $('#onlineCount').textContent = state.server.state === 'läuft' ? `(${list.length}${max ? ` von ${max}` : ''})` : '';
  const ul = $('#onlineList');
  if (state.server.state !== 'läuft') ul.replaceChildren(el('li', { class: 'muted' }, 'Der Server läuft gerade nicht.'));
  else if (!list.length) ul.replaceChildren(el('li', { class: 'muted' }, 'Niemand online.'));
  else ul.replaceChildren(...list.map((n) => playerCard(n)));
}

function renderPlayerList(ul, list, kind) {
  if (!list.length) {
    ul.replaceChildren(el('li', { class: 'muted' }, 'Noch niemand eingetragen.'));
    return;
  }
  ul.replaceChildren(...list.map((p) => el('li', {},
    el('span', { class: 'pl-name' }, head(p.name, 28), p.name, kind === 'ops' && p.level ? el('span', { class: 'tag' }, `Level ${p.level}`) : null),
    el('button', {
      class: 'btn small ghost',
      onclick: (e) => guarded(e.currentTarget, async () => {
        await api('POST', `/api/players/${kind}`, { action: 'remove', name: p.name });
        toast(`${p.name} entfernt.`, 'ok');
        await loadPlayers();
      }),
    }, 'Entfernen'))));
}

async function loadPlayers() {
  const d = await api('GET', '/api/players');
  state.ops = new Set(d.ops.map((o) => String(o.name).toLowerCase()));
  renderOnline(d.online, d.maxPlayers);
  renderPlayerList($('#whitelistList'), d.whitelist, 'whitelist');
  renderPlayerList($('#opsList'), d.ops, 'ops');
  const ws = $('#whitelistState');
  $('#wlToggle').checked = d.whitelistEnabled;
  ws.replaceChildren(d.whitelistEnabled
    ? el('span', { style: 'color:var(--accent)' }, '✔ Nur diese Spieler dürfen auf den Server.')
    : el('span', { style: 'color:var(--warn)' }, 'Ausgeschaltet: Jeder mit der Adresse kann beitreten.'));
  loadBulkServers().catch(() => {});
  if (!d.onlineMode) ws.append(el('div', { class: 'muted' }, 'Hinweis: online-mode ist aus, deshalb werden Offline-UUIDs verwendet.'));
}

for (const form of $$('#tab-players form[data-list]')) {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('input', form);
    const name = input.value.trim();
    if (!name) return;
    guarded($('button', form), async () => {
      const r = await api('POST', `/api/players/${form.dataset.list}`, { action: 'add', name, bedrock: $('input.isBedrock', form).checked });
      input.value = '';
      toast(r.viaConsole ? `${name}: Befehl an den Server geschickt.` : `${name} hinzugefügt.`, 'ok');
      await loadPlayers();
    });
  });
}

// ---- Spieler auf mehreren Servern eintragen

async function loadBulkServers() {
  const d = await api('GET', '/api/players/servers');
  const box = $('#bulkServers');
  const keep = new Set($$('input', box).filter((i) => i.checked).map((i) => i.value));
  box.replaceChildren(...d.servers.map((s) => el('label', { class: 'checkline small' },
    el('input', { type: 'checkbox', value: s.id, checked: keep.size ? keep.has(s.id) : s.current, disabled: !s.ready }),
    s.name, s.current ? el('span', { class: 'tag' }, 'ausgewählt') : null,
    s.whitelistEnabled ? el('span', { class: 'tag' }, 'Whitelist an') : null,
    !s.ready ? el('span', { class: 'muted' }, ' (noch nicht eingerichtet)') : null)));
}

function bulkScope() { return $('input[name=bulkScope]:checked').value; }
for (const r of $$('input[name=bulkScope]')) r.addEventListener('change', () => { $('#bulkServers').hidden = bulkScope() !== 'selected'; });

async function runBulk(action, btn) {
  const name = $('#bulkName').value.trim();
  if (!name) { toast('Bitte einen Spielernamen eingeben.', 'error'); return; }
  if (action === 'remove' && bulkScope() !== 'current' && !confirm(`${name} wirklich auf den gewählten Servern austragen?`)) return;
  await guarded(btn, async () => {
    const r = await api('POST', '/api/players/bulk', {
      action, name, bedrock: $('#bulkBedrock').checked, whitelist: $('#bulkWl').checked, op: $('#bulkOp').checked,
      scope: bulkScope(), servers: $$('#bulkServers input:checked').map((i) => i.value),
    });
    const ul = $('#bulkResult');
    ul.hidden = false;
    ul.replaceChildren(...r.results.map((x) => el('li', { class: x.skipped ? 'muted' : null }, x.skipped ? '– ' : x.ok ? '✔ ' : '✖ ', el('b', {}, x.server), x.kind ? ` · ${x.kind}: ` : ': ', x.message)));
    if (r.error) toast(r.error, 'error');
    else if (r.results.every((x) => x.ok)) { toast(action === 'add' ? `${name} eingetragen.` : `${name} ausgetragen.`, 'ok'); $('#bulkName').value = ''; }
    await loadPlayers();
  });
}
$('#bulkForm').addEventListener('submit', (e) => { e.preventDefault(); runBulk('add', $('#bulkAdd')); });
$('#bulkRemove').addEventListener('click', (e) => runBulk('remove', e.currentTarget));

$('#wlToggle').addEventListener('change', (e) => guarded(null, async () => {
  try {
    await api('POST', '/api/players/whitelist-mode', { enabled: e.target.checked });
    toast(e.target.checked ? 'Whitelist eingeschaltet.' : 'Whitelist ausgeschaltet.', 'ok');
  } catch (err) {
    e.target.checked = !e.target.checked;
    throw err;
  }
  await loadPlayers();
}));

$('#broadcastForm').addEventListener('submit', (e) => {
  e.preventDefault();
  guarded($('button', e.currentTarget), async () => {
    await api('POST', '/api/players/broadcast', { text: $('#broadcastText').value });
    $('#broadcastText').value = '';
    toast('Nachricht gesendet.', 'ok');
  });
});

$('#btnPlayersRefresh').addEventListener('click', (e) => guarded(e.currentTarget, async () => {
  await api('POST', '/api/players/refresh');
  await loadPlayers();
}));

// ====================================================================== Freunde einladen

async function loadInvite() {
  const d = await api('GET', '/api/network');
  const box = $('#lanIps');
  const lan = d.ips.filter((i) => !i.tailscale);
  const portSuffix = d.port === 25565 ? '' : `:${d.port}`;
  box.replaceChildren(...(lan.length ? lan : d.ips).map((i) => el('div', { class: 'ip' },
    el('b', {}, `${i.address}${portSuffix}`),
    el('span', { class: 'small muted' }, i.adapter, i.likelyLan ? '' : ' (vermutlich virtueller Adapter)'),
    el('button', {
      class: 'btn small ghost',
      onclick: () => navigator.clipboard.writeText(`${i.address}${portSuffix}`).then(() => toast('Kopiert.', 'ok'), () => toast('Kopieren nicht möglich.', 'error')),
    }, 'Kopieren'))));
  if (!d.ips.length) box.replaceChildren(el('div', { class: 'muted' }, 'Keine Netzwerkverbindung gefunden.'));
  if (d.domain) {
    const addr = `${d.domain}${portSuffix}`;
    box.append(el('div', { class: 'ip' }, el('b', {}, addr), el('span', { class: 'small muted' }, 'Deine Domain'),
      el('button', { class: 'btn small ghost', onclick: () => navigator.clipboard.writeText(addr).then(() => toast('Kopiert.', 'ok'), () => toast('Kopieren nicht möglich.', 'error')) }, 'Kopieren')));
  }
  const ts = d.ips.find((i) => i.tailscale);
  if (ts) box.append(el('div', { class: 'small muted' }, `Tailscale-IP: ${ts.address}${portSuffix}`));
  $('#portNum').textContent = d.port;
  const main = d.ips.find((i) => i.likelyLan);
  $('#targetIp').textContent = main ? main.address : 'deine lokale IP';
}

$('#btnPublicIp').addEventListener('click', (e) => guarded(e.currentTarget, async () => {
  const r = await api('GET', '/api/network/public');
  $('#publicIp').textContent = r.ip;
}));

// ====================================================================== Backups

async function loadBackups() {
  loadAutoBackup().catch(() => {});
  const d = await api('GET', '/api/backups');
  $('#worldName').textContent = d.world;
  $('#backupDir').textContent = `Speicherort: ${d.dir}`;
  const tbody = $('#backupTable');
  if (!d.backups.length) {
    tbody.replaceChildren(el('tr', {}, el('td', { colspan: 4, class: 'muted' }, 'Noch keine Backups vorhanden.')));
    return;
  }
  tbody.replaceChildren(...d.backups.map((b) => el('tr', {},
    el('td', { class: 'file' }, b.name),
    el('td', { class: 'hide-sm small' }, fmtDate(b.time)),
    el('td', { class: 'right small' }, formatBytes(b.size)),
    el('td', { class: 'right' },
      el('div', { class: 'row', style: 'justify-content:flex-end;margin:0' },
        el('button', {
          class: 'btn small',
          disabled: d.running,
          title: d.running ? 'Erst den Server stoppen' : null,
          onclick: (e) => guarded(e.currentTarget, async () => {
            if (!confirm(`Welt aus „${b.name}“ wiederherstellen?\n\nDie aktuelle Welt wird vorher automatisch gesichert und dann ersetzt.`)) return;
            jobDismissed = null;
            await api('POST', '/api/backups/restore', { name: b.name });
          }),
        }, 'Wiederherstellen'),
        el('button', {
          class: 'btn small ghost danger',
          onclick: (e) => guarded(e.currentTarget, async () => {
            if (!confirm(`Backup „${b.name}“ endgültig löschen?`)) return;
            await api('POST', '/api/backups/delete', { name: b.name });
            await loadBackups();
          }),
        }, 'Löschen'))))));
}

$('#btnBackup').addEventListener('click', (e) => guarded(e.currentTarget, async () => {
  jobDismissed = null;
  await api('POST', '/api/backups');
}));

// ====================================================================== Start

(async function init() {
  connect();
  let initial = location.hash.slice(1);
  try {
    const s = await api('GET', '/api/setup');
    state.setup = s;
    renderSetup(s);
    if (!loaders[initial]) initial = s.complete ? 'home' : 'setup';
  } catch (e) {
    toast(e.message, 'error');
  }
  showTab(initial || 'setup');
})();
