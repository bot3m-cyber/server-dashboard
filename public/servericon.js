'use strict';
/* Server-Icon wählen: fertige 64 × 64-PNGs oder ein eigenes PNG hochladen.
   base ist '/api/server' (aktiver Server) oder '/api/servers/<id>' (ein bestimmter Server). */

let ICON_STAMP = Date.now(); // damit Browser nach einer Änderung das neue Bild laden
const FEATURED_SERVER_ICONS = [
  { id: 'enderchest', name: 'Endertruhe' },
  { id: 'netherportal', name: 'Netherportal' },
  { id: 'cherrytree', name: 'Kirschbaum' },
  { id: 'fox', name: 'Fuchs' },
  { id: 'axolotl', name: 'Axolotl' },
];

async function openIconDialog(base, serverName, onDone) {
  let icons = [];
  try { icons = (await api('GET', '/api/server-icons')).icons; } catch (e) { toast(e.message, 'error'); return; }
  let close = () => {};
  const finish = (r) => {
    ICON_STAMP = Date.now();
    toast(r?.restartNeeded ? 'Icon gespeichert. Es gilt nach einem Neustart des Servers.' : 'Icon gespeichert.', 'ok');
    close();
    onDone?.(r);
  };
  const current = el('img', { class: 'icon-current', alt: '', src: `${base}/icon?t=${Date.now()}` });
  current.addEventListener('error', () => { current.style.visibility = 'hidden'; });
  const saveFeatured = async (icon) => {
    const image = await fetch(`/assets/server-icons/${icon.id}.png`);
    if (!image.ok) throw new Error('Das Icon konnte nicht geladen werden.');
    const res = await fetch(`${base}/icon`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: await image.blob(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
    return data;
  };
  const choice = (i, featured) => el('button', {
    type: 'button', class: `icon-choice${featured ? ' icon-choice-featured' : ''}`, title: `${i.name} verwenden`,
    onclick: (e) => guarded(e.currentTarget, async () => finish(featured
      ? await saveFeatured(i)
      : await api('POST', `${base}/icon/preset`, { preset: i.id }))),
  }, el('img', { src: featured ? `/assets/server-icons/${i.id}.png` : `/api/server-icons/${i.id}.png`, alt: '' }), el('span', {}, i.name));
  const file = el('input', { type: 'file', accept: 'image/png', hidden: true });
  file.addEventListener('change', async () => {
    const f = file.files[0];
    file.value = '';
    if (!f) return;
    await guarded(null, async () => {
      const res = await fetch(`${base}/icon`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: f });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
      finish(data);
    });
  });
  const body = el('div', {},
    el('div', { class: 'icon-now' }, el('div', { class: 'icon-current-box' }, current), el('div', { class: 'muted small' }, 'So sieht der Server in der Serverliste von Minecraft aus. Wähle ein Icon oder lade ein eigenes hoch.')),
    el('div', { class: 'icon-section-title' }, el('strong', {}, 'Neue Motive'), el('span', { class: 'muted small' }, 'Für die Minecraft-Serverliste · 64 × 64 Pixel')),
    el('div', { class: 'icon-grid' }, ...FEATURED_SERVER_ICONS.map(i => choice(i, true))),
    el('div', { class: 'icon-section-title' }, el('strong', {}, 'Klassiker')),
    el('div', { class: 'icon-grid' }, ...icons.map(i => choice(i, false))),
    el('div', { class: 'row' },
      el('button', { class: 'btn', type: 'button', onclick: () => file.click() }, 'Eigenes Bild hochladen …'),
      el('span', { class: 'muted small' }, 'PNG, genau 64 × 64 Pixel'), file));
  close = openDialog(`Server-Icon${serverName ? ` für „${serverName}“` : ''}`, body, [{ label: 'Schließen' }]);
}
