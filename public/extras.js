'use strict';
/* Zusatz-Bereiche: Dateimanager, Automatik (Zeitplan, Discord), Cloud, Updates, Modpack-Suche,
   Welt zurücksetzen, Desktop-Benachrichtigungen, vorhandenen Server übernehmen. */

const enc = encodeURIComponent;
const fmtDate2 = (t) => new Date(t).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });

// ====================================================================== Dateimanager

const FM = { path: '', file: null };
const BIN_EXT = /\.(jar|zip|gz|dat|dat_old|mca|mcc|nbt|png|jpe?g|gif|webp|ogg|exe|dll|so|db|lock|bin|old|disabled|7z|rar|part)$/i;

function fileIcon(e) {
  if (e.dir) return '📁';
  if (/\.(jar|disabled)$/i.test(e.name)) return '🧩';
  if (/\.(json5?|ya?ml|toml|properties|cfg|conf|ini)$/i.test(e.name)) return '⚙';
  if (/\.(log|txt)$/i.test(e.name)) return '📄';
  if (/\.(png|jpe?g|gif|webp)$/i.test(e.name)) return '🖼';
  return '📄';
}

function joinPath(a, b) { return a ? `${a}/${b}` : b; }

async function loadFiles(path = FM.path) {
  const d = await api('GET', `/api/files?path=${enc(path)}`);
  FM.path = d.path;
  const parts = d.path ? d.path.split('/') : [];
  $('#fmCrumbs').replaceChildren(
    el('button', { class: 'crumb', onclick: () => loadFiles('') }, '🏠 Server'),
    ...parts.flatMap((p, i) => [el('span', { class: 'muted' }, '›'),
      el('button', { class: 'crumb', onclick: () => loadFiles(parts.slice(0, i + 1).join('/')) }, p)]));
  $('#fmUp').disabled = !d.path;
  const body = $('#fmBody');
  if (!d.entries.length) { body.replaceChildren(el('tr', {}, el('td', { colspan: 5, class: 'muted' }, 'Dieser Ordner ist leer.'))); return; }
  body.replaceChildren(...d.entries.map((e) => {
    const rel = joinPath(d.path, e.name);
    return el('tr', {},
      el('td', { class: 'fm-icon' }, fileIcon(e)),
      el('td', { class: 'file' }, el('button', { class: 'linkbtn', onclick: () => (e.dir ? loadFiles(rel) : openFile(rel)) }, e.name)),
      el('td', { class: 'right small muted hide-sm' }, e.dir ? '' : formatBytes(e.size)),
      el('td', { class: 'small muted hide-sm' }, fmtDate2(e.mtime)),
      el('td', { class: 'right fm-actions' },
        e.dir ? null : el('a', { class: 'btn small ghost', href: `/api/files/download?path=${enc(rel)}`, title: 'Herunterladen' }, '⬇'),
        el('button', {
          class: 'btn small ghost', title: 'Umbenennen',
          onclick: (ev) => guarded(ev.currentTarget, async () => {
            const to = prompt('Neuer Name:', e.name);
            if (!to || to === e.name) return;
            await api('POST', '/api/files/rename', { from: rel, to: joinPath(d.path, to) });
            await loadFiles();
          }),
        }, '✏'),
        el('button', {
          class: 'btn small ghost danger', title: 'Löschen',
          onclick: (ev) => guarded(ev.currentTarget, async () => {
            if (!confirm(`„${e.name}“ wirklich löschen?${e.dir ? '\n\nDer ganze Ordner mit allem Inhalt wird gelöscht.' : ''}\n\nDas kann nicht rückgängig gemacht werden.`)) return;
            await api('POST', '/api/files/delete', { path: rel });
            if (FM.file === rel) closeEditor();
            await loadFiles();
          }),
        }, '🗑')));
  }));
}

async function openFile(rel) {
  if (BIN_EXT.test(rel)) { location.href = `/api/files/download?path=${enc(rel)}`; return; }
  await guarded(null, async () => {
    const r = await api('GET', `/api/files/read?path=${enc(rel)}`);
    FM.file = r.path;
    $('#fmEditName').textContent = r.path;
    $('#fmText').value = r.text;
    $('#fmEditor').hidden = false;
    $('#fmRunning').hidden = state.server.state === 'aus';
    $('#fmEditor').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
}
function closeEditor() { FM.file = null; $('#fmEditor').hidden = true; }

$('#fmSave').addEventListener('click', (e) => guarded(e.currentTarget, async () => {
  await api('POST', '/api/files/write', { path: FM.file, text: $('#fmText').value });
  toast('Gespeichert.', 'ok', 2500);
}));
$('#fmText').addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); $('#fmSave').click(); } });
$('#fmClose').addEventListener('click', closeEditor);
$('#fmUp').addEventListener('click', () => loadFiles(FM.path.split('/').slice(0, -1).join('/')));
$('#fmRefresh').addEventListener('click', () => guarded(null, () => loadFiles()));
$('#fmNewDir').addEventListener('click', () => guarded(null, async () => {
  const n = prompt('Name des neuen Ordners:');
  if (!n) return;
  await api('POST', '/api/files/mkdir', { path: joinPath(FM.path, n) });
  await loadFiles();
}));
$('#fmUpload').addEventListener('change', async (e) => {
  const list = [...e.target.files];
  e.target.value = '';
  let ok = 0;
  for (const f of list) {
    try {
      const res = await fetch('/api/files/upload', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Dir': enc(FM.path), 'X-Filename': enc(f.name) }, body: f });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
      ok++;
    } catch (err) { toast(`${f.name}: ${err.message}`, 'error'); }
  }
  if (ok) toast(`${ok} Datei(en) hochgeladen.`, 'ok');
  await loadFiles();
});

// ====================================================================== Automatik

const TYPE_LABEL = { restart: 'Neustart', backup: 'Backup', say: 'Nachricht', command: 'Befehl', stop: 'Stoppen', start: 'Starten' };

function describeSchedule(s) {
  const when = s.mode === 'interval' ? `alle ${s.everyMin} Minuten` : `täglich um ${s.time} Uhr`;
  const extra = s.command ? `: „${s.command}“` : s.type === 'restart' && s.warnSeconds ? ` (${s.warnSeconds} s Vorwarnung)` : '';
  return `${TYPE_LABEL[s.type]}${extra} · ${when}`;
}

async function loadAuto() {
  const d = await api('GET', '/api/automation');
  $('#autoCrash').checked = d.autoRestartOnCrash;
  $('#autoStop').value = d.autoStopMinutes;
  const ul = $('#schedList');
  ul.replaceChildren(...(d.schedules.length ? d.schedules.map((s) => el('li', {},
    el('span', { class: 'sched-body' },
      el('label', { class: 'checkline' }, el('input', {
        type: 'checkbox', checked: s.enabled,
        onchange: (e) => guarded(null, async () => { await api('POST', '/api/schedules', { ...s, enabled: e.target.checked }); await loadAuto(); }),
      }), el('b', {}, s.name)),
      el('div', { class: 'muted small' }, describeSchedule(s), s.lastRun ? ` · zuletzt ${fmtDate2(s.lastRun)}` : '')),
    el('span', { class: 'row' },
      el('button', { class: 'btn small', onclick: (e) => guarded(e.currentTarget, async () => { await api('POST', '/api/schedules/run', { id: s.id }); toast('Aufgabe ausgeführt.', 'ok', 2500); }) }, 'Jetzt ausführen'),
      el('button', { class: 'btn small ghost danger', onclick: (e) => guarded(e.currentTarget, async () => { await api('POST', '/api/schedules/delete', { id: s.id }); await loadAuto(); }) }, 'Löschen'))))
    : [el('li', { class: 'muted' }, 'Noch keine Aufgaben.')]));
  $('#webhookState').replaceChildren(d.webhook.set
    ? el('span', { style: 'color:var(--accent)' }, `✔ Webhook gespeichert (${d.webhook.hint})`)
    : el('span', { class: 'muted' }, 'Noch kein Webhook gespeichert.'));
  $('#webhookUrl').value = '';
  $('#wbStart').checked = d.webhook.events.start;
  $('#wbStop').checked = d.webhook.events.stop;
  $('#wbCrash').checked = d.webhook.events.crash;
  $('#wbJoin').checked = d.webhook.events.join;
  $('#btnWebhookTest').disabled = !d.webhook.set;
  $('#btnWebhookRemove').disabled = !d.webhook.set;
}

$('#btnAutoSave').addEventListener('click', (e) => guarded(e.currentTarget, async () => {
  await api('POST', '/api/automation', { autoRestartOnCrash: $('#autoCrash').checked, autoStopMinutes: Number($('#autoStop').value || 0) });
  toast('Gespeichert.', 'ok');
}));

function updateSchedForm() {
  const f = $('#schedForm');
  const type = f.elements.type.value;
  const mode = f.elements.mode.value;
  for (const l of $$('label[data-for]', f)) {
    const k = l.dataset.for;
    l.hidden = k === 'daily' ? mode !== 'daily' : k === 'interval' ? mode !== 'interval' : k === 'text' ? !(type === 'say' || type === 'command') : k === 'restart' ? type !== 'restart' : false;
  }
}
$('#schedForm').elements.type.addEventListener('change', updateSchedForm);
$('#schedForm').elements.mode.addEventListener('change', updateSchedForm);
$('#schedForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const v = (n) => f.elements[n].value;
  guarded($('button[type=submit]', f), async () => {
    await api('POST', '/api/schedules', {
      name: v('name'), type: v('type'), mode: v('mode'), time: v('time'), everyMin: Number(v('everyMin')), command: v('command'), warnSeconds: Number(v('warnSeconds')),
    });
    f.reset();
    updateSchedForm();
    toast('Aufgabe hinzugefügt.', 'ok');
    await loadAuto();
  });
});
updateSchedForm();

function webhookEvents() {
  return { start: $('#wbStart').checked, stop: $('#wbStop').checked, crash: $('#wbCrash').checked, join: $('#wbJoin').checked };
}
$('#btnWebhookSave').addEventListener('click', (e) => guarded(e.currentTarget, async () => {
  const url = $('#webhookUrl').value.trim();
  await api('POST', '/api/webhook', { ...(url ? { url } : {}), events: webhookEvents() });
  toast('Gespeichert.', 'ok');
  await loadAuto();
}));
$('#btnWebhookTest').addEventListener('click', (e) => guarded(e.currentTarget, async () => { await api('POST', '/api/webhook/test'); toast('Test-Nachricht gesendet. Schau in deinen Discord-Kanal.', 'ok'); }));
$('#btnWebhookRemove').addEventListener('click', (e) => guarded(e.currentTarget, async () => {
  if (!confirm('Webhook wirklich entfernen?')) return;
  await api('POST', '/api/webhook', { url: '' });
  await loadAuto();
}));

// ====================================================================== Cloud

const CL = { status: null };

async function loadCloud() {
  const c = await api('GET', '/api/cloud');
  CL.status = c;
  $('#cloudPath').value = c.cloudDir || '';
  $('#cloudCandidates').replaceChildren(...c.candidates.map((p) => el('button', {
    class: 'chip', type: 'button', title: 'Diesen Ordner verwenden', onclick: () => { $('#cloudPath').value = p; $('#btnCloudSet').click(); },
  }, `☁ ${p}`)));
  const st = $('#cloudState');
  if (!c.cloudDir) st.replaceChildren(el('span', { class: 'muted' }, 'Noch kein Cloud-Ordner gewählt. Wähle oben einen erkannten Ordner oder gib einen Pfad ein.'));
  else if (!c.reachable) st.replaceChildren(el('span', { style: 'color:var(--warn)' }, '⚠ Der Cloud-Ordner ist gerade nicht erreichbar. Läuft die Cloud-Software?'));
  else st.replaceChildren(el('span', { style: 'color:var(--accent)' }, `✔ Verbunden: ${c.cloudDir}\\${c.sub}`), c.cloudLastSync ? el('div', { class: 'muted' }, `Zuletzt gesichert: ${fmtDate2(c.cloudLastSync)}`) : null);
  $('#cloudBackups').checked = c.cloudWithBackups;
  $('#cloudAuto').value = String(c.cloudAutoMinutes);
  for (const id of ['#btnCloudPush', '#btnCloudPushOne', '#btnCloudAuto']) $(id).disabled = !c.reachable;
  $('#btnCloudOff').disabled = !c.cloudDir;
  const ul = $('#cloudServers');
  ul.replaceChildren(...(c.cloudServers.length ? c.cloudServers.map((s) => el('li', {},
    el('span', { class: 'sched-body' },
      el('b', {}, s.name), el('span', { class: 'tag' }, s.type), s.mcVersion ? el('span', { class: 'tag' }, s.mcVersion) : null,
      s.local ? el('span', { class: 'tag good-tag' }, 'auf diesem PC') : null, s.backup ? el('span', { class: 'tag' }, 'mit Welt-Backup') : null,
      el('div', { class: 'muted small' }, `gesichert ${s.exportedAt ? fmtDate2(s.exportedAt) : ''} von „${s.machine || '?'}“`)),
    el('button', {
      class: 'btn small', onclick: (e) => guarded(e.currentTarget, async () => {
        if (!confirm(`„${s.name}“ als neuen Server auf diesen PC holen?\n\nEs wird ein neuer Ordner angelegt. Vorhandene Server bleiben unverändert.`)) return;
        jobDismissed = null;
        await api('POST', '/api/cloud/pull', { folder: s.folder });
      }),
    }, 'Auf diesen PC holen')))
    : [el('li', { class: 'muted' }, c.cloudDir ? 'Noch nichts in der Cloud. Klicke oben auf „Alle Server jetzt sichern“.' : 'Wähle zuerst einen Cloud-Ordner.')]));
}

$('#btnCloudSet').addEventListener('click', (e) => guarded(e.currentTarget, async () => {
  await api('POST', '/api/cloud/folder', { path: $('#cloudPath').value.trim() });
  toast('Cloud-Ordner gespeichert.', 'ok');
  await loadCloud();
}));
$('#btnCloudOff').addEventListener('click', (e) => guarded(e.currentTarget, async () => {
  if (!confirm('Die Verbindung zum Cloud-Ordner lösen? Die Dateien dort bleiben erhalten.')) return;
  await api('POST', '/api/cloud/folder', { path: null });
  await loadCloud();
}));
$('#btnCloudPush').addEventListener('click', (e) => guarded(e.currentTarget, async () => { jobDismissed = null; await api('POST', '/api/cloud/push', { all: true, withBackups: $('#cloudBackups').checked }); }));
$('#btnCloudPushOne').addEventListener('click', (e) => guarded(e.currentTarget, async () => { jobDismissed = null; await api('POST', '/api/cloud/push', { all: false, withBackups: $('#cloudBackups').checked }); }));
$('#btnCloudAuto').addEventListener('click', (e) => guarded(e.currentTarget, async () => {
  await api('POST', '/api/cloud/settings', { autoMinutes: Number($('#cloudAuto').value), withBackups: $('#cloudBackups').checked });
  toast('Gespeichert.', 'ok');
}));

// ====================================================================== Updates (Mods/Plugins)

let pendingUpdates = [];

$('#btnCheckUpdates').addEventListener('click', (e) => guarded(e.currentTarget, async () => {
  toast('Suche nach Updates …', 'info', 2500);
  const r = await api('GET', '/api/updates');
  pendingUpdates = r.updates;
  $('#updatesBox').hidden = false;
  const ul = $('#updatesList');
  if (!r.updates.length) {
    ul.replaceChildren(el('li', {}, '✔ Alles ist auf dem neuesten Stand.'));
    $('#btnApplyUpdates').hidden = true;
    return;
  }
  $('#btnApplyUpdates').hidden = false;
  ul.replaceChildren(...r.updates.map((u) => el('li', {},
    el('label', { class: 'checkline' }, el('input', { type: 'checkbox', checked: true, 'data-file': u.file }),
      el('span', {}, el('b', {}, u.title || u.file), el('div', { class: 'muted small' }, `${u.file} → ${u.newName}`))),
    el('span', { class: `tag ${u.type === 'release' ? 'good-tag' : ''}` }, `${u.newVersion} (${u.type === 'release' ? 'stabil' : u.type})`))));
}));

$('#btnApplyUpdates').addEventListener('click', (e) => guarded(e.currentTarget, async () => {
  const files = $$('#updatesList input:checked').map((i) => i.dataset.file);
  if (!files.length) throw new Error('Bitte mindestens ein Update auswählen.');
  if (state.server.state !== 'aus') throw new Error('Bitte zuerst den Server stoppen.');
  if (!confirm(`${files.length} Update(s) einspielen?\n\nVorher sichern lohnt sich: Neue Versionen können Welten verändern.`)) return;
  jobDismissed = null;
  await api('POST', '/api/updates/apply', { files });
  $('#updatesBox').hidden = true;
}));

// ====================================================================== Modpack bei Modrinth suchen

$('#packSearchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  guarded($('button', e.currentTarget), async () => {
    const r = await api('GET', `/api/modpacks/search?q=${enc($('#packSearch').value.trim())}`);
    const ul = $('#packResults');
    if (!r.results.length) { ul.replaceChildren(el('li', { class: 'muted' }, 'Nichts gefunden.')); return; }
    ul.replaceChildren(...r.results.map((m) => el('li', {},
      m.icon ? el('img', { src: m.icon, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : el('div', { class: 'noicon' }),
      el('div', { class: 'body' }, el('b', {}, m.title), el('span', { class: 'muted small' }, ` von ${m.author} · ${Intl.NumberFormat('de-DE').format(m.downloads)} Downloads`),
        el('div', { class: 'desc' }, m.description)),
      el('button', {
        class: 'btn small primary',
        onclick: (ev) => guarded(ev.currentTarget, async () => {
          if (!confirm(`„${m.title}“ als Modpack einlesen?\n\nDanach unter Schritt 2 die Mods herunterladen.`)) return;
          jobDismissed = null;
          await api('POST', '/api/modpacks/install', { id: m.id });
        }),
      }, 'Installieren'))));
  });
});

async function refreshPackUpdate() {
  const box = $('#packUpdate');
  try {
    const u = await api('GET', '/api/modpacks/update');
    box.hidden = !(u.known && u.newer);
    if (u.known && u.newer) box.replaceChildren('🔔 Es gibt eine neuere Version dieses Modpacks: ', el('b', {}, u.latest), ` (installiert: ${u.current}). Suche das Modpack oben, um es neu einzulesen.`);
  } catch { box.hidden = true; }
}

// ====================================================================== Welt zurücksetzen

$('#btnWorldReset').addEventListener('click', (e) => guarded(e.currentTarget, async () => {
  if (state.server.state !== 'aus') throw new Error('Bitte zuerst den Server stoppen.');
  if (!confirm('Wirklich eine NEUE WELT erzeugen?\n\nDie aktuelle Welt wird vorher als Backup gesichert und dann gelöscht.')) return;
  if ((prompt('Zur Sicherheit bitte NEUE WELT eintippen:') || '').trim().toUpperCase() !== 'NEUE WELT') { toast('Abgebrochen.', 'info'); return; }
  jobDismissed = null;
  await api('POST', '/api/world/reset', { seed: $('#worldSeed').value });
}));

// ====================================================================== Desktop-Benachrichtigungen

function notifyEnabled() {
  try { return localStorage.getItem('desktopNotify') === '1' && 'Notification' in window && Notification.permission === 'granted'; } catch { return false; }
}
function desktopNotify(title, body) {
  if (!notifyEnabled()) return;
  try { new Notification(title, { body }); } catch { /* nicht möglich */ }
}
function updateNotifyButton() {
  const b = $('#btnNotify');
  if (!('Notification' in window)) { b.disabled = true; b.textContent = 'Wird von diesem Browser nicht unterstützt'; return; }
  b.textContent = notifyEnabled() ? '🔔 Benachrichtigungen sind an (ausschalten)' : '🔔 Desktop-Benachrichtigungen aktivieren';
}
$('#btnNotify').addEventListener('click', async () => {
  try {
    if (notifyEnabled()) { localStorage.setItem('desktopNotify', '0'); updateNotifyButton(); return; }
    const p = await Notification.requestPermission();
    if (p === 'granted') { localStorage.setItem('desktopNotify', '1'); toast('Benachrichtigungen sind an.', 'ok'); } else toast('Der Browser hat die Benachrichtigungen nicht erlaubt.', 'warn');
  } catch { toast('Benachrichtigungen sind hier nicht möglich.', 'warn'); }
  updateNotifyButton();
});
updateNotifyButton();

// ====================================================================== Vorhandenen Server übernehmen

$('#btnAdoptDetect').addEventListener('click', (e) => guarded(e.currentTarget, async () => {
  const p = $('#adoptPath').value.trim();
  const f = await api('POST', '/api/servers/detect', { path: p });
  const label = { neoforge: 'NeoForge', paper: 'Paper', purpur: 'Purpur', fabric: 'Fabric', vanilla: 'Vanilla' }[f.type] || f.type;
  $('#adoptInfo').hidden = false;
  $('#adoptInfo').replaceChildren(el('b', {}, `✔ ${label}${f.mcVersion ? ` · Minecraft ${f.mcVersion}` : ''}`),
    f.loaderVersion ? ` · Version ${f.loaderVersion}` : '', f.xmxGb ? ` · RAM ${f.xmxGb} GB` : '', f.motd ? el('div', { class: 'muted small' }, `Name in der Serverliste: ${f.motd}`) : null);
  $('#adoptRow').hidden = false;
  $('#adoptName').value = f.motd || p.split(/[\\/]/).filter(Boolean).pop() || 'Mein Server';
}));
$('#btnAdopt').addEventListener('click', (e) => guarded(e.currentTarget, async () => {
  await api('POST', '/api/servers/adopt', { name: $('#adoptName').value, path: $('#adoptPath').value.trim() });
  toast('Server übernommen.', 'ok');
}));
