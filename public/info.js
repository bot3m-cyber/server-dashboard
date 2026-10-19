'use strict';
/* Info-Button: Anleitung, wie sich Freunde auf verschiedenen Geräten verbinden (inkl. Adresse). */

const INFO = { platform: 'java', group: 'java', net: null, bedrock: null, publicIp: null };
const GROUPS = { java: ['java'], bedrock: ['bedrock', 'switch', 'xbox', 'ps'] };
const BC_DNS = '104.238.130.180';

const PLATFORMS = [
  ['java', '💻', 'PC (Java)'],
  ['bedrock', '📱', 'Windows / Handy (Bedrock)'],
  ['switch', '🎮', 'Nintendo Switch'],
  ['xbox', '🟢', 'Xbox'],
  ['ps', '🔵', 'PlayStation'],
];

function infoAddr(kind) {
  const lan = INFO.net?.ips.find((i) => i.likelyLan) || INFO.net?.ips[0];
  const javaPort = INFO.net?.port || 25565;
  const port = kind === 'java' ? javaPort : (INFO.net?.hosted ? INFO.net.bedrockPort : INFO.bedrock?.port) || 19132;
  return { lan: lan?.address || null, pub: INFO.publicIp, port, javaPort };
}

function copyBtn(text) {
  return el('button', {
    class: 'btn small ghost', type: 'button',
    onclick: () => navigator.clipboard.writeText(text).then(() => toast('Kopiert.', 'ok', 1800), () => toast('Kopieren nicht möglich.', 'error')),
  }, 'Kopieren');
}

function addrBox(kind) {
  const a = infoAddr(kind);
  const portTxt = kind === 'java' ? (a.port === 25565 ? '' : `:${a.port}`) : '';
  const rows = [];
  const row = (label, ip, withPort) => el('div', { class: 'info-addr' },
    el('span', { class: 'muted small' }, label),
    el('b', { class: 'mono' }, ip),
    withPort ? el('span', { class: 'tag' }, `Port ${a.port}`) : null,
    copyBtn(withPort ? ip : ip + portTxt));
  if (INFO.net?.hosted) {
    rows.push(row('Adresse deines Servers', kind === 'java' ? a.lan + portTxt : a.lan, kind !== 'java'));
    rows.push(el('div', { class: 'muted small' }, kind === 'java' ? `Java-Edition: Adresse und Port (${a.port}, TCP) gehören zu diesem Server. Jeder Server hat seinen eigenen Port.` : `Bedrock: Adresse und Port ${a.port} (UDP). Jeder Server hat seinen eigenen Port.`));
    return el('div', { class: 'info-box' }, el('h3', {}, 'Deine Adresse'), ...rows);
  }
  if (a.lan) rows.push(row('Im selben WLAN', kind === 'java' ? a.lan + portTxt : a.lan, kind !== 'java'));
  if (INFO.net?.domain) rows.push(row('Über deine Domain', kind === 'java' ? INFO.net.domain + portTxt : INFO.net.domain, kind !== 'java'));
  rows.push(a.pub ? row('Über das Internet', kind === 'java' ? a.pub + portTxt : a.pub, kind !== 'java')
    : el('div', { class: 'info-addr' }, el('span', { class: 'muted small' }, 'Über das Internet'),
      el('button', {
        class: 'btn small', type: 'button',
        onclick: (e) => guarded(e.currentTarget, async () => { INFO.publicIp = (await api('GET', '/api/network/public')).ip; renderInfo(); }),
      }, 'Öffentliche IP anzeigen')));
  if (kind !== 'java') {
    rows.push(el('div', { class: 'muted small' }, `Für Bedrock gilt: Port ${a.port} (UDP). Im Router muss UDP ${a.port} freigegeben sein, wenn Freunde von außerhalb kommen.`));
  } else {
    rows.push(el('div', { class: 'muted small' }, `Port ${a.port} (TCP). Für Freunde von außerhalb muss er im Router freigegeben sein (siehe „Freunde einladen“).`));
  }
  return el('div', { class: 'info-box' }, el('h3', {}, 'Deine Adresse'), ...rows);
}

function bedrockWarning() {
  const b = INFO.bedrock;
  const ok = b?.geyser?.enabled && b?.floodgate?.enabled;
  if (ok) {
    return el('div', { class: 'banner ok small' }, '✔ Bedrock-Support (Geyser + Floodgate) ist auf deinem Server installiert.',
      b.authType === 'floodgate' ? ' Spieler brauchen keinen Java-Account.' : b.authType === 'online' ? ' Achtung: Aktuell brauchen Bedrock-Spieler einen Java-Account (änderbar im Tab „Bedrock“).' : '');
  }
  return el('div', { class: 'banner warn small' }, '⚠ Dafür braucht dein Server Bedrock-Support (Geyser). Er ist noch nicht (vollständig) installiert. ',
    el('button', { class: 'btn small primary', type: 'button', onclick: () => { closeInfo(); showTab('bedrock'); } }, 'Zum Tab „Bedrock“'));
}

const ol = (...steps) => el('ol', { class: 'steps-list' }, ...steps.map((s) => el('li', {}, ...(Array.isArray(s) ? s : [s]))));

function consoleSteps(dnsSteps, name) {
  return [
    bedrockWarning(),
    el('div', { class: 'info-box' },
      el('h3', {}, `So verbindest du dich mit ${name}`),
      el('p', { class: 'muted small' }, `${name} kann keine eigenen Server-Adressen eingeben. Mit einem kleinen DNS-Trick („BedrockConnect“) bekommst du aber ein zusätzliches Menü dafür.`),
      ol(
        ...dnsSteps,
        ['Minecraft starten, auf ', el('b', {}, 'Spielen'), ' und dann zum Reiter ', el('b', {}, 'Server'), '.'],
        ['Einen beliebigen vorgeschlagenen Server anklicken. Statt dessen öffnet sich das Menü von BedrockConnect.'],
        ['Dort ', el('b', {}, 'Connect to a Server'), ' (Mit Server verbinden) wählen und die Adresse und den Port aus dem Kasten unten eingeben.'],
        ['Verbinden und spielen. Beim nächsten Mal steht dein Server in der Liste.'],
        ['Danach den DNS wieder auf ', el('b', {}, 'automatisch'), ' stellen, wenn du normale Server nutzen willst.'])),
    addrBox('bedrock'),
    el('div', { class: 'info-box' },
      el('h3', {}, 'Gut zu wissen'),
      el('ul', { class: 'info-list' },
        el('li', {}, 'Wenn die DNS-Adresse nicht klappt (sie ist manchmal überlastet oder blockiert), gibt es weitere auf der Projektseite: ',
          el('a', { href: 'https://github.com/Pugmatt/BedrockConnect', target: '_blank', rel: 'noopener' }, 'BedrockConnect auf GitHub'), '.'),
        el('li', {}, 'Für Online-Spiel braucht die Konsole meist ein Abo (Nintendo Switch Online, PlayStation Plus, Xbox Game Pass Core).'),
        el('li', {}, 'Alternative ohne DNS-Umstellung: Der Server erscheint in der Freundesliste, z. B. mit „MCXboxBroadcast“. Anleitung: ',
          el('a', { href: 'https://wiki.geysermc.org/geyser/using-geyser-with-consoles', target: '_blank', rel: 'noopener' }, 'GeyserMC Wiki'), '.'),
        el('li', {}, 'Die Menü-Namen können je nach Software-Version leicht anders heißen.'))),
  ];
}

const DNS_VALUES = ['Primärer DNS: ', el('b', { class: 'mono' }, BC_DNS), '  ·  Sekundärer DNS: ', el('b', { class: 'mono' }, '8.8.8.8')];

function infoBody(platform) {
  const mc = state.setup?.mcVersion || state.setup?.pack?.minecraft;
  if (platform === 'java') {
    return [
      el('div', { class: 'info-box' },
        el('h3', {}, 'So verbindest du dich mit Minecraft Java Edition (PC)'),
        ol(['Minecraft Java Edition starten', mc ? [' mit der Version ', el('b', {}, mc)] : '', state.setup?.type === 'modpack' || state.setup?.kind === 'mods' ? ', und dieselben Mods wie der Server installieren (Client-Seite).' : '.'].flat(),
          ['Auf ', el('b', {}, 'Mehrspieler'), ' klicken und dann auf ', el('b', {}, 'Server hinzufügen'), '.'],
          ['Einen Namen eintragen und bei ', el('b', {}, 'Serveradresse'), ' die Adresse aus dem Kasten unten einfügen.'],
          ['Auf ', el('b', {}, 'Fertig'), ' klicken, den Server auswählen und ', el('b', {}, 'Server beitreten'), '.'],
          state.setup?.type === 'modpack' || state.setup?.kind === 'mods' ? 'Tipp: Mit dem Modrinth-Launcher oder Prism Launcher lässt sich dasselbe Modpack mit einem Klick installieren.' : 'Der Server nimmt auch neuere oder ältere Spieler an, wenn du ViaVersion/ViaBackwards installierst (Tab „Plugins“).')),
      addrBox('java'),
    ];
  }
  if (platform === 'bedrock') {
    return [
      bedrockWarning(),
      el('div', { class: 'info-box' },
        el('h3', {}, 'So verbindest du dich mit Minecraft Bedrock (Windows 10/11, Android, iPhone/iPad)'),
        ol(['Minecraft Bedrock Edition starten und auf ', el('b', {}, 'Spielen'), ' tippen.'],
          ['Zum Reiter ', el('b', {}, 'Server'), ' wechseln, nach unten scrollen und ', el('b', {}, 'Server hinzufügen'), ' wählen.'],
          ['Einen Namen eintragen, bei ', el('b', {}, 'Server-Adresse'), ' die Adresse und bei ', el('b', {}, 'Port'), ' den Bedrock-Port aus dem Kasten unten eingeben.'],
          ['Speichern, den Server antippen und beitreten.'])),
      addrBox('bedrock'),
    ];
  }
  if (platform === 'switch') {
    return consoleSteps([
      ['Auf der Switch: ', el('b', {}, 'Systemeinstellungen → Internet → Interneteinstellungen'), ', dein WLAN wählen und ', el('b', {}, 'Einstellungen ändern'), '.'],
      ['Bei ', el('b', {}, 'DNS-Einstellungen'), ' auf ', el('b', {}, 'Manuell'), ' stellen und eintragen: ', ...DNS_VALUES],
      ['Speichern und die Switch ', el('b', {}, 'neu starten'), '.'],
    ], 'der Nintendo Switch');
  }
  if (platform === 'xbox') {
    return consoleSteps([
      ['Auf der Xbox: ', el('b', {}, 'Einstellungen → Allgemein → Netzwerkeinstellungen → Erweiterte Einstellungen → DNS-Einstellungen'), '.'],
      ['Auf ', el('b', {}, 'Manuell'), ' stellen und eintragen: ', ...DNS_VALUES],
      ['Speichern und zurück zur Startseite gehen.'],
    ], 'der Xbox');
  }
  return consoleSteps([
    ['Auf der PlayStation: ', el('b', {}, 'Einstellungen → Netzwerk → Einstellungen → Internetverbindung einrichten'), ', dein Netzwerk wählen und auf ', el('b', {}, 'Erweitert'), ' bzw. ', el('b', {}, 'Benutzerdefiniert'), ' gehen.'],
    ['Bei ', el('b', {}, 'DNS-Einstellungen'), ' auf ', el('b', {}, 'Manuell'), ' stellen und eintragen: ', ...DNS_VALUES],
    ['Speichern und die Verbindung testen lassen.'],
  ], 'der PlayStation');
}

function renderInfo() {
  const shown = PLATFORMS.filter(([id]) => GROUPS[INFO.group].includes(id));
  $('#infoTitle').textContent = INFO.group === 'java' ? '📘 So verbindet sich ein Freund mit dem PC' : '📘 So verbinden sich Freunde mit Bedrock';
  $('#infoPlatforms').hidden = shown.length < 2;
  $('#infoPlatforms').replaceChildren(...shown.map(([id, icon, label]) => el('button', {
    type: 'button', class: INFO.platform === id ? 'active' : null,
    onclick: () => { INFO.platform = id; renderInfo(); },
  }, `${icon} ${label}`)));
  $('#infoBody').replaceChildren(...infoBody(INFO.platform));
}

async function openInfo(group = 'java') {
  INFO.group = group;
  INFO.platform = GROUPS[group][0];
  $('#infoModal').hidden = false;
  renderInfo();
  const [net, bedrock, setup] = await Promise.all([
    api('GET', '/api/network').catch(() => null), api('GET', '/api/bedrock').catch(() => null),
    state.setup ? Promise.resolve(state.setup) : api('GET', '/api/setup').catch(() => null),
  ]);
  INFO.net = net;
  INFO.bedrock = bedrock;
  if (setup && !state.setup) state.setup = setup;
  renderInfo();
}

function closeInfo() { $('#infoModal').hidden = true; }

$('#btnInfoJava').addEventListener('click', () => openInfo('java'));
$('#btnInfoBedrock').addEventListener('click', () => openInfo('bedrock'));
$('#infoClose').addEventListener('click', closeInfo);
$('#infoModal').addEventListener('mousedown', (e) => { if (e.target === $('#infoModal')) closeInfo(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#infoModal').hidden) closeInfo(); });
