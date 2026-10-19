'use strict';
/* Mehrbenutzer-Modus: Benutzermenü, Kontingent-Anzeige und Administration. Lokal passiert hier nichts. */

const ME = { user: null, usage: null };

const gb = (bytes) => `${(bytes / 1024 ** 3).toFixed(bytes < 1024 ** 3 ? 2 : 1).replace('.', ',')} GB`;

function usageBars(u) {
  const q = u.quota;
  const bar = (label, val, max, text) => el('div', { class: 'quota-row' },
    el('div', { class: 'quota-line' }, el('span', {}, label), el('b', {}, text)),
    el('div', { class: 'progress thin' }, el('div', { style: `width:${Math.min(100, max ? (val / max) * 100 : 0)}%` })));
  return [
    bar('Server', u.servers, q.maxServers, `${u.servers} von ${q.maxServers}`),
    bar('Speicherplatz', u.diskBytes, q.maxDiskGb * 1024 ** 3, `${gb(u.diskBytes)} von ${q.maxDiskGb} GB`),
    el('div', { class: 'muted small' }, `Pro Server höchstens ${q.maxRamGb} GB RAM. Zugeteilt: ${u.ramAllocatedGb} GB, davon laufend: ${u.ramRunningGb} GB.`),
  ];
}

async function refreshMe() {
  const d = await api('GET', '/api/me');
  ME.user = d.user;
  ME.usage = d.usage;
  APP.userId = d.user.id;
  return d;
}

function changePasswordDialog() {
  const cur = el('input', { type: 'password', autocomplete: 'current-password', maxlength: 200 });
  const nw = el('input', { type: 'password', autocomplete: 'new-password', maxlength: 200 });
  const body = el('div', { class: 'dlg-grid' },
    ME.user.provider === 'google' ? el('p', { class: 'muted small' }, 'Dein Konto nutzt die Anmeldung mit Google. Hier kannst du zusätzlich ein Passwort festlegen.') : el('label', {}, 'Aktuelles Passwort', cur),
    el('label', {}, 'Neues Passwort (mindestens 10 Zeichen)', nw));
  openDialog('Passwort ändern', body, [
    { label: 'Abbrechen' },
    {
      label: 'Speichern', primary: true, stay: true,
      onclick: async (e, close) => {
        try {
          await api('POST', '/api/me/password', { current: cur.value, next: nw.value });
          toast('Passwort geändert.', 'ok');
          close();
        } catch (err) { toast(err.message, 'error'); }
        return true;
      },
    },
  ]);
}

function renderUserMenu() {
  const m = $('#userMenu');
  const u = ME.user;
  const label = u.name || u.email;
  const panel = el('div', { class: 'user-panel', hidden: true },
    el('div', { class: 'user-who' }, el('b', {}, label), el('span', { class: 'muted small' }, u.email), u.role === 'admin' ? el('span', { class: 'tag' }, 'Administrator') : null),
    ...usageBars(ME.usage),
    el('button', { class: 'btn small', type: 'button', onclick: changePasswordDialog }, 'Passwort ändern'),
    el('button', { class: 'btn small', type: 'button', onclick: async () => { try { await api('POST', '/auth/logout'); } finally { location.href = '/login'; } } }, 'Abmelden'));
  const btn = el('button', { class: 'btn user-btn', type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false', title: u.email },
    el('span', { class: 'avatar', 'aria-hidden': 'true' }, (label[0] || '?').toUpperCase()), el('span', { class: 'user-name' }, label));
  btn.addEventListener('click', () => { panel.hidden = !panel.hidden; btn.setAttribute('aria-expanded', String(!panel.hidden)); });
  document.addEventListener('click', (e) => { if (!m.contains(e.target)) { panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
  m.replaceChildren(btn, panel);
  m.hidden = false;
}

// ---------------------------------------------------------------- Kontingent im Reiter „Meine Server“

function installQuotaCard() {
  const tab = $('#tab-servers');
  const card = el('div', { class: 'card hosted-only', id: 'quotaCard' });
  tab.querySelector('h1')?.after(card);
  const orig = loaders.servers;
  loaders.servers = async () => {
    const r = orig();
    refreshMe().then(() => {
      card.replaceChildren(el('h2', {}, 'Dein Kontingent'), ...usageBars(ME.usage),
        el('p', { class: 'muted small' }, `Auf dieser Seite stehen insgesamt ca. ${ME.usage.budgetGb} GB RAM für Minecraft-Server bereit (zurzeit belegt: ${ME.usage.runningTotalGb} GB).`));
    }).catch(() => {});
    return r;
  };
}

// ---------------------------------------------------------------- Administration

function numInput(v, min, max, step = 1) {
  return el('input', { type: 'number', min, max, step, value: v ?? '', class: 'num' });
}

async function loadAdmin() {
  const d = await api('GET', '/api/admin/users');
  const s = d.settings;
  const reg = el('select', {}, el('option', { value: 'open' }, 'Offen – jeder kann ein Konto erstellen'), el('option', { value: 'closed' }, 'Geschlossen – nur bestehende Konten'));
  reg.value = s.registration;
  const dq = s.defaultQuota;
  const qs = numInput(dq.maxServers, 0, 50), qr = numInput(dq.maxRamGb, 1, 256), qd = numInput(dq.maxDiskGb, 1, 10000);
  const total = numInput(s.totalRamGb ?? '', 1, 1024);
  total.placeholder = 'automatisch';
  const reserve = numInput(s.reserveRamGb, 0, 64);
  const settings = el('div', { class: 'card' },
    el('h2', {}, 'Einstellungen der Seite'),
    el('div', { class: 'dlg-grid' },
      el('label', {}, 'Registrierung', reg),
      el('label', {}, 'Standard: Server pro Benutzer', qs),
      el('label', {}, 'Standard: RAM pro Server (GB)', qr),
      el('label', {}, 'Standard: Speicher pro Benutzer (GB)', qd),
      el('label', {}, 'RAM für alle Server zusammen (GB, leer = automatisch)', total),
      el('label', {}, 'RAM-Reserve fürs System (GB)', reserve)),
    el('p', { class: 'muted small' }, `Zurzeit nutzbar für Minecraft: ${d.budgetGb} GB. Laufend belegt: ${d.runningTotalGb} GB.`),
    el('button', {
      class: 'btn primary', type: 'button',
      onclick: (e) => guarded(e.currentTarget, async () => {
        await api('POST', '/api/admin/settings', {
          registration: reg.value, defaultQuota: { maxServers: qs.value, maxRamGb: qr.value, maxDiskGb: qd.value },
          totalRamGb: total.value === '' ? null : total.value, reserveRamGb: reserve.value,
        });
        toast('Gespeichert.', 'ok');
        loadAdmin();
      }),
    }, 'Speichern'));

  const act = (label, fn, cls = '') => el('button', { class: `btn small ${cls}`, type: 'button', onclick: (e) => guarded(e.currentTarget, fn) }, label);
  const rows = d.users.map((u) => {
    const self = u.id === ME.user.id;
    const q = u.quota;
    const qBtn = act(u.customQuota ? 'Kontingent ✎' : 'Kontingent (Standard) ✎', async () => {
      const a = numInput(q?.maxServers ?? dq.maxServers, 0, 50), b = numInput(q?.maxRamGb ?? dq.maxRamGb, 1, 256), c = numInput(q?.maxDiskGb ?? dq.maxDiskGb, 1, 10000);
      openDialog(`Kontingent für ${u.email}`, el('div', { class: 'dlg-grid' },
        el('label', {}, 'Server', a), el('label', {}, 'RAM pro Server (GB)', b), el('label', {}, 'Speicher (GB)', c)), [
        { label: 'Standard verwenden', onclick: async () => { await api('POST', '/api/admin/users/update', { id: u.id, quota: null }); loadAdmin(); } },
        { label: 'Speichern', primary: true, onclick: async () => { await api('POST', '/api/admin/users/update', { id: u.id, quota: { maxServers: a.value, maxRamGb: b.value, maxDiskGb: c.value } }); loadAdmin(); } },
      ]);
    });
    return el('tr', {},
      el('td', {}, el('b', {}, u.name || u.email.split('@')[0]), el('div', { class: 'muted small' }, u.email, u.provider === 'google' ? ' · Google' : '')),
      el('td', {}, u.role === 'admin' ? el('span', { class: 'tag' }, 'Admin') : 'Benutzer'),
      el('td', {}, `${u.servers}${u.running ? ` (${u.running} läuft)` : ''}`),
      el('td', {}, `${u.ramAllocatedGb} GB`),
      el('td', {}, gb(u.diskBytes)),
      el('td', {}, u.disabled ? el('span', { class: 'tag red' }, 'gesperrt') : 'aktiv'),
      el('td', { class: 'actions' },
        self ? el('span', { class: 'muted small' }, 'das bist du') : [
          act(u.role === 'admin' ? 'Zum Benutzer' : 'Zum Admin', async () => { await api('POST', '/api/admin/users/update', { id: u.id, role: u.role === 'admin' ? 'user' : 'admin' }); loadAdmin(); }),
          act(u.disabled ? 'Entsperren' : 'Sperren', async () => { await api('POST', '/api/admin/users/update', { id: u.id, disabled: !u.disabled }); loadAdmin(); }),
          qBtn,
          act('Löschen', async () => {
            if (!confirm(`Konto ${u.email} samt allen Servern und Dateien endgültig löschen?`)) return;
            await api('POST', '/api/admin/users/delete', { id: u.id });
            toast('Konto gelöscht.', 'ok');
            loadAdmin();
          }, 'danger'),
        ]));
  });
  const table = el('div', { class: 'card' },
    el('h2', {}, `Benutzer (${d.users.length})`),
    el('div', { class: 'table-wrap' }, el('table', { class: 'table' },
      el('thead', {}, el('tr', {}, ...['Benutzer', 'Rolle', 'Server', 'RAM', 'Speicher', 'Status', ''].map((h) => el('th', {}, h)))),
      el('tbody', {}, ...rows))));
  $('#adminBody').replaceChildren(settings, table);
}

function installAdmin() {
  const btn = el('button', { 'data-tab': 'admin' });
  btn.innerHTML = '<svg class="ni" aria-hidden="true"><use href="assets/icons.svg#shield"/></svg> Benutzer';
  $('#tabs').append(btn);
  btn.addEventListener('click', () => showTab('admin'));
  $('main').append(el('section', { id: 'tab-admin', class: 'tab', hidden: true },
    el('h1', {}, 'Benutzer verwalten'), el('p', { class: 'lead' }, 'Nur für Administratoren: Konten, Kontingente und Einstellungen dieser Seite.'), el('div', { id: 'adminBody' })));
  loaders.admin = loadAdmin;
}

(async function initHosted() {
  await APP.ready;
  if (!APP.hosted) return;
  try {
    await refreshMe();
  } catch { return; }
  renderUserMenu();
  installQuotaCard();
  if (ME.user.role === 'admin') installAdmin();
  const net = document.getElementById('inviteAddrTitle');
  if (net) {
    net.textContent = 'Adresse deines Servers';
    document.getElementById('inviteAddrText').textContent = 'Freunde verbinden sich in Minecraft über Multiplayer → Server hinzufügen mit dieser Adresse (inklusive Port):';
  }
  setTimeout(maybeShowTutorial, 1200);
})();
