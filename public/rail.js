'use strict';
/* Info-Leiste rechts (bei breiten Bildschirmen): Live-Status, Spieler, Schnellzugriffe, Aktivität,
   Mini-Konsole, Tastenkürzel und Tipps passend zum aktuellen Tab. */

const RAIL_TIPS = {
  home: ['Mit Strg+K erreichst du jede Aktion ohne Maus.', 'Beim Server-Icon wird ein PNG mit genau 64 × 64 Pixeln verlangt.', 'Der RAM-Wert zeigt den ganzen Java-Prozess, nicht nur den Heap.'],
  servers: ['Presets installieren alles mit einem Klick: Server, Plugins und Einstellungen.', 'Vorhandene Server lassen sich übernehmen, ohne dass Dateien verändert werden.', 'Es läuft immer nur ein Server gleichzeitig.'],
  console: ['Mit Pfeil hoch holst du frühere Befehle zurück.', 'Mit den Filtern siehst du nur Chat, Warnungen oder Fehler.', 'Stoppe den Server immer über „Stopp“, damit die Welt gespeichert wird.'],
  mods: ['„Mods verbessern“ schaltet reine Client-Mods ab, ohne etwas zu löschen.', 'Gelöschte Mods liegen im Ordner mods_old/geloescht und lassen sich zurückholen.', 'Updates prüfen lohnt sich nach jedem Minecraft-Update.'],
  players: ['OPs dürfen alle Befehle. Vergib das Recht sparsam.', 'Die Whitelist schaltest du unter „Einstellungen“ ein.', 'Mit Kicken und Bannen kannst du Spieler direkt vom Server werfen.'],
  invite: ['Für Freunde von außerhalb muss Port 25565 (TCP) im Router freigegeben sein.', 'Klappt die Portfreigabe nicht, helfen playit.gg oder Tailscale.', 'Im Heimnetz reicht die IP aus dem Kasten.'],
  backups: ['Automatische Backups stellst du unten bei „Automatisch sichern“ ein.', 'Vor jedem Update oder Wechsel der Version: erst ein Backup.', 'Beim Wiederherstellen wird die aktuelle Welt vorher automatisch gesichert.'],
  files: ['Mit Strg+S speicherst du im Editor.', 'Protokolle liegen im Ordner logs, Mod-Einstellungen in config.', 'Ändere Dateien möglichst bei gestopptem Server.'],
  auto: ['Ein Neustart mitten in der Nacht mit 60 Sekunden Vorwarnung hält den Server frisch.', 'Ein Discord-Webhook meldet dir Abstürze aufs Handy.', 'Auto-Stopp spart Strom, wenn niemand mehr online ist.'],
  cloud: ['Der Cloud-Ordner wird von OneDrive, Google Drive oder Dropbox synchronisiert.', 'Mods selbst werden nicht gesichert, sie lassen sich neu laden.', 'Auf einem neuen PC holst du den Server mit einem Klick zurück.'],
  bedrock: ['Geyser braucht UDP-Port 19132 im Router.', 'Mit Floodgate brauchen Bedrock-Spieler keinen Java-Account.', 'Konsolen verbinden sich über BedrockConnect (siehe Info-Knopf).'],
  settings: ['Für etwa 100 Mods reichen meist 8 bis 10 GB RAM.', 'Eine kleinere Sichtweite macht den Server deutlich flüssiger.', 'Änderungen an den Einstellungen gelten nach einem Neustart.'],
  setup: ['Die Einrichtung brauchst du nur bei einem neuen Modpack.', 'Schritte, die schon erledigt sind, bekommen einen grünen Haken.'],
};

const RAIL = { sig: '' };

function railVisible() {
  const r = $('#rail');
  return !!r && getComputedStyle(r).display !== 'none';
}

function railCard(title, ...children) {
  return el('section', { class: 'card rail-card' }, el('h3', {}, title), ...children);
}

function railStat(label, value) {
  return el('div', { class: 'rail-stat' }, el('span', { class: 'muted small' }, label), el('b', {}, value));
}

function renderRail() {
  if (!railVisible()) return;
  const s = state.server;
  const tab = state.tab || 'home';
  const running = s.state === 'läuft';
  const players = s.players || [];
  const act = (typeof homeInfo !== 'undefined' ? homeInfo.activity : []).slice(-5).reverse();
  const lines = typeof recentLines !== 'undefined' ? recentLines.slice(-7) : [];
  const tips = RAIL_TIPS[tab] || RAIL_TIPS.home;
  const tip = tips[Math.floor(Date.now() / 15000) % tips.length];
  const mem = typeof homeInfo !== 'undefined' ? homeInfo.memMb : null;
  const sig = JSON.stringify([s.state, s.crashed, s.readyAt && Math.floor((Date.now() - s.readyAt) / 1000), players, s.maxPlayers, s.tps?.tps, mem, act.map((a) => a.t), lines.length && lines[lines.length - 1], tab, tip, !!state.job?.running]);
  if (sig === RAIL.sig) return;
  RAIL.sig = sig;

  const cards = [];
  const label = { aus: 'Aus', startet: 'Startet …', läuft: 'Läuft', stoppt: 'Stoppt …' }[s.state] || s.state;
  cards.push(railCard('Live-Status',
    el('div', { class: 'rail-state' }, el('span', { class: `dot ${running ? 'on' : s.state === 'aus' ? (s.crashed ? 'crashed' : 'off') : 'busy'}` }),
      el('b', {}, s.crashed && s.state === 'aus' ? 'Abgestürzt' : label)),
    el('div', { class: 'rail-grid' },
      railStat('Laufzeit', running && s.readyAt ? fmtDuration(Date.now() - s.readyAt) : '–'),
      railStat('Spieler', running ? `${players.length}${s.maxPlayers ? ` / ${s.maxPlayers}` : ''}` : '–'),
      railStat('TPS', running && s.tps ? s.tps.tps.toFixed(1).replace('.', ',') : '–'),
      railStat('RAM', mem && s.state !== 'aus' ? `${(mem / 1024).toFixed(1).replace('.', ',')} GB` : '–'))));

  cards.push(railCard(`Spieler online${running ? ` (${players.length})` : ''}`,
    el('div', { class: 'rail-players' }, ...(running && players.length ? players.slice(0, 12).map((n) => el('span', { class: 'rail-player', title: n }, head(n, 26), n))
      : [el('span', { class: 'muted small' }, running ? 'Gerade ist niemand online.' : 'Der Server läuft nicht.')]))));

  cards.push(railCard('Schnellzugriff',
    el('div', { class: 'rail-actions' },
      el('button', { class: 'btn small', onclick: (e) => guarded(e.currentTarget, async () => { jobDismissed = null; await api('POST', '/api/backups'); }) }, '💾 Sichern'),
      el('button', { class: 'btn small', onclick: () => showTab('console') }, '⌨ Konsole'),
      el('button', { class: 'btn small', onclick: () => showTab('files') }, '📁 Dateien'),
      el('button', { class: 'btn small', onclick: () => showTab('mods') }, '🧩 Mods'),
      el('button', { class: 'btn small', onclick: () => (typeof openInfo === 'function' ? openInfo('java') : showTab('invite')) }, '🔗 Verbinden'),
      el('button', { class: 'btn small', onclick: () => showTab('backups') }, '🗂 Backups'))));

  if (tab !== 'home' && tab !== 'console') {
    cards.push(railCard('Konsole', el('div', { class: 'log rail-console' },
      ...(lines.length ? lines.map((l) => el('div', { class: lineClass(l) }, l)) : [el('div', { class: 'muted' }, 'Noch keine Ausgabe.')]))));
  }

  cards.push(railCard('Letzte Aktivität', el('ul', { class: 'rail-feed' },
    ...(act.length ? act.map((a) => el('li', {}, head(a.name, 20),
      el('span', {}, el('b', {}, a.name), a.type === 'join' ? ' beigetreten' : a.type === 'leave' ? ' hat verlassen' : a.type === 'chat' ? `: ${a.text}` : ` 🏆 ${a.text}`)))
      : [el('li', { class: 'muted small' }, 'Noch nichts passiert.')]))));

  cards.push(railCard('Tastenkürzel', el('ul', { class: 'rail-keys' },
    el('li', {}, el('kbd', {}, 'Strg'), '+', el('kbd', {}, 'K'), el('span', {}, 'Aktionen & Befehle')),
    el('li', {}, el('kbd', {}, 'Strg'), '+', el('kbd', {}, 'F'), el('span', {}, 'Auf der Seite suchen')),
    el('li', {}, el('kbd', {}, 'Esc'), el('span', {}, 'Fenster schließen')))));

  cards.push(el('section', { class: 'card rail-card rail-tip' }, el('h3', {}, '💡 Tipp'), el('p', { class: 'small' }, tip)));

  $('#rail').replaceChildren(...cards);
}

setInterval(renderRail, 1000);
// Aktivität einmal laden, damit die Leiste auch auf anderen Tabs gefüllt ist
setTimeout(async () => {
  try {
    if (typeof homeInfo !== 'undefined' && !homeInfo.activity.length) homeInfo.activity = (await api('GET', '/api/activity')).activity || [];
  } catch { /* egal */ }
  renderRail();
}, 1500);
