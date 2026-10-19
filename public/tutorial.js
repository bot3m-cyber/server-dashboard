'use strict';
/* Erste Schritte (Willkommens-Assistent mit Systemauswahl) und Anleitung zu allen Bereichen. */

const APP = { hosted: false, platform: null, userId: null };
try { if (localStorage.getItem('srvdash-hosted') === '1') document.body.classList.add('hosted'); } catch { /* ohne Speicher */ }
APP.ready = api('GET', '/api/app-info').then((i) => {
  Object.assign(APP, i);
  document.body.classList.toggle('hosted', !!i.hosted);
  try { localStorage.setItem('srvdash-hosted', i.hosted ? '1' : '0'); } catch { /* egal */ }
}).catch(() => {});

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* egal */ } },
};

/** Einfacher Dialog im Stil der Info-Fenster. body = Node, actions = [{label, primary, onclick}] */
function openDialog(title, body, actions = [], opts = {}) {
  const box = el('div', { class: 'modal-box dialog-box', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  const modal = el('div', { class: 'modal' }, box);
  const close = () => { modal.remove(); document.removeEventListener('keydown', onKey); opts.onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  modal.addEventListener('mousedown', (e) => { if (e.target === modal) close(); });
  box.append(...[
    el('div', { class: 'dialog-head' }, el('h2', {}, title), el('button', { class: 'btn small ghost', type: 'button', 'aria-label': 'Schließen', onclick: close }, '✕')),
    body,
    actions.length ? el('div', { class: 'dialog-actions' }, ...actions.map((a) => el('button', {
      class: `btn${a.primary ? ' primary' : ''}`, type: 'button',
      onclick: (e) => Promise.resolve(a.onclick?.(e, close)).then((keep) => { if (!keep && !a.stay) close(); }),
    }, a.label))) : null,
  ].filter(Boolean));
  document.body.append(modal);
  (box.querySelector('input, select, button.primary') || box).focus?.();
  return close;
}

/** Fragt nach, bevor etwas Unerwünschtes passiert. Gibt true zurück, wenn bestätigt wurde. */
function confirmDialog(title, body, okLabel, opts = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    openDialog(title, body, [
      { label: 'Abbrechen', onclick: () => finish(false) },
      { label: okLabel, primary: true, onclick: () => { opts.onOk?.(); finish(true); } },
    ], { onClose: () => finish(false) });
    // Fokus auf „Abbrechen“, damit ein versehentliches Enter nichts auslöst
    setTimeout(() => document.querySelector('.modal:last-of-type .dialog-actions .btn')?.focus(), 0);
  });
}

const SKIP_EMPTY_KEY = 'srvdash-skip-confirm-empty';

/** Sicherheitsabfrage vor „Stoppen“ und „Neustart“ eines Minecraft-Servers. */
async function confirmServerAction(kind) {
  const players = state.server?.players || [];
  if (!players.length && store.get(SKIP_EMPTY_KEY) === '1') return true;
  const stop = kind === 'stop';
  const name = 'Der Server';
  const skip = el('input', { type: 'checkbox' });
  const body = el('div', {},
    players.length
      ? el('div', { class: 'banner warn' }, el('b', {}, `Gerade ${players.length === 1 ? 'ist 1 Spieler' : `sind ${players.length} Spieler`} online:`), ` ${players.slice(0, 12).join(', ')}${players.length > 12 ? ' …' : ''}`, el('br'), 'Sie werden getrennt.')
      : el('p', { class: 'muted' }, 'Gerade ist niemand online.'),
    el('p', {}, stop
      ? `${name} wird sauber gestoppt (die Welt wird gespeichert). Danach ist er für alle nicht mehr erreichbar, bis du ihn wieder startest.`
      : `${name} wird gestoppt und gleich wieder gestartet. Das dauert meist ein bis zwei Minuten, in denen niemand spielen kann.`),
    players.length ? null : el('label', { class: 'checkline small' }, skip, el('span', {}, 'Nicht mehr fragen, wenn niemand online ist')));
  return confirmDialog(stop ? 'Server wirklich stoppen?' : 'Server wirklich neu starten?', body, stop ? 'Ja, stoppen' : 'Ja, neu starten', {
    onOk: () => { if (skip.checked) store.set(SKIP_EMPTY_KEY, '1'); },
  });
}

// ====================================================================== Systeme

const OS = {
  windows: {
    label: 'Windows', icon: '🪟',
    java: [['Lade „Eclipse Temurin 21“ (JDK, Windows x64, .msi) bei Adoptium herunter und installiere es.', 'https://adoptium.net/de/temurin/releases/?version=21&os=windows&arch=x64&package=jdk'],
      ['Hake beim Installieren „Set JAVA_HOME“ und „Add to PATH“ an.']],
    start: ['Doppelklick auf start.bat im Dashboard-Ordner. Danach öffnet sich dein Browser.'],
    firewall: ['Beim ersten Serverstart fragt Windows, ob Java ins Netzwerk darf: „Zulassen“ klicken.'],
  },
  linux: {
    label: 'Linux', icon: '🐧',
    java: [['Debian / Ubuntu: sudo apt install openjdk-21-jre-headless'], ['Fedora: sudo dnf install java-21-openjdk-headless'],
      ['Alternativ: Temurin 21 von adoptium.net (Linux-Archiv entpacken).', 'https://adoptium.net/de/temurin/releases/?version=21&os=linux&arch=x64&package=jdk']],
    start: ['Im Dashboard-Ordner einmal: chmod +x start.sh', 'Dann: ./start.sh – und im Browser http://localhost:3000 öffnen.'],
    firewall: ['Falls eine Firewall läuft: sudo ufw allow 25565/tcp (und für Bedrock: sudo ufw allow 19132/udp).'],
  },
  mac: {
    label: 'macOS', icon: '🍎',
    java: [['Mit Homebrew: brew install --cask temurin@21'], ['Oder: Temurin 21 (.pkg) von adoptium.net.', 'https://adoptium.net/de/temurin/releases/?version=21&os=mac&arch=aarch64&package=jdk']],
    start: ['Im Dashboard-Ordner im Terminal: ./start.sh', 'Dann im Browser http://localhost:3000 öffnen.'],
    firewall: ['macOS fragt beim ersten Start, ob Java eingehende Verbindungen annehmen darf: „Erlauben“.'],
  },
};
const osFromPlatform = (p) => (p === 'win32' ? 'windows' : p === 'darwin' ? 'mac' : 'linux');

const lines = (arr) => el('ul', { class: 'tut-list' }, ...arr.map(([t, href]) => el('li', {}, href
  ? el('a', { href, target: '_blank', rel: 'noopener' }, t)
  : (/^(sudo |brew |chmod |\.\/|Debian|Fedora|Dann: \.)/.test(t) ? el('code', {}, t) : t))));

// ====================================================================== Assistent

function steps() {
  const hosted = APP.hosted;
  const sel = store.get('srvdash-os') || osFromPlatform(APP.platform);
  const dev = store.get('srvdash-device') || 'java';
  const list = [];

  if (!hosted) {
    list.push({
      title: 'Willkommen – welches System nutzt du?',
      render(rerender) {
        const o = OS[sel];
        return el('div', {},
          el('p', {}, 'Mit diesem Dashboard betreibst du Minecraft-Server auf deinem eigenen Rechner, ohne Befehle tippen zu müssen. Wähle dein System, dann siehst du genau, was zu tun ist.'),
          el('div', { class: 'os-choice', role: 'radiogroup', 'aria-label': 'Betriebssystem' }, ...Object.entries(OS).map(([k, v]) => el('button', {
            type: 'button', role: 'radio', 'aria-checked': String(k === sel), class: k === sel ? 'active' : '',
            onclick: () => { store.set('srvdash-os', k); rerender(); },
          }, el('span', { class: 'os-ico', 'aria-hidden': 'true' }, v.icon), v.label))),
          el('h3', {}, `1. Java installieren (${o.label})`), lines(o.java),
          el('h3', {}, '2. Dashboard starten'), lines(o.start.map((x) => [x])),
          el('h3', {}, '3. Firewall'), lines(o.firewall.map((x) => [x])),
          el('p', { class: 'muted small' }, 'Sehr neue Minecraft-Versionen brauchen Java 25 – das Dashboard sagt dir Bescheid und hilft dabei. Wenn Java schon da ist, kannst du das überspringen.'));
      },
    });
  } else {
    list.push({
      title: 'Willkommen – so funktioniert es hier',
      render(rerender) {
        return el('div', {},
          el('p', {}, 'Dein Minecraft-Server läuft bei uns in der Cloud. Du brauchst dafür weder Java noch Portfreigaben im Router – nur Minecraft zum Mitspielen.'),
          el('ul', { class: 'tut-list' },
            el('li', {}, 'Jeder Server hat eine eigene Adresse mit eigenem Port, z. B. ', el('code', {}, 'adresse:25566'), '.'),
            el('li', {}, 'Deine Server gehören nur dir. Andere Benutzer sehen sie nicht.'),
            el('li', {}, 'Wie viele Server und wie viel Speicher du nutzen darfst, siehst du bei „Meine Server“.')),
          el('h3', {}, 'Womit spielst du?'),
          el('div', { class: 'os-choice', role: 'radiogroup', 'aria-label': 'Spielgerät' }, ...[
            ['java', '💻', 'PC (Java-Edition)'], ['bedrock', '📱', 'Handy / Windows-App / Konsole (Bedrock)'],
          ].map(([k, ico, label]) => el('button', {
            type: 'button', role: 'radio', 'aria-checked': String(k === dev), class: k === dev ? 'active' : '',
            onclick: () => { store.set('srvdash-device', k); rerender(); },
          }, el('span', { class: 'os-ico', 'aria-hidden': 'true' }, ico), label))),
          el('p', { class: 'muted' }, dev === 'java'
            ? 'Java-Edition: In Minecraft auf „Multiplayer → Server hinzufügen“ gehen und die Adresse deines Servers einfügen.'
            : 'Bedrock: Der Server braucht „Bedrock-Support“ (Geyser + Floodgate). Das kannst du beim Anlegen anhaken – dort bekommst du auch den Bedrock-Port. Konsolen brauchen einen kleinen Zusatz-Trick, den die Anleitung zeigt.'));
      },
    });
  }

  list.push({
    title: 'Server anlegen', tab: 'servers', tabLabel: 'Meine Server öffnen',
    render() {
      return el('div', {},
        el('p', {}, 'Unter „Meine Server“ legst du einen Server mit wenigen Klicks an. Du hast die Wahl:'),
        el('ul', { class: 'tut-list' },
          el('li', {}, el('b', {}, 'Vanilla'), ' – das originale Minecraft, ohne Extras.'),
          el('li', {}, el('b', {}, 'Paper / Purpur'), ' – schnell, mit Plugins. Ideal für Survival mit Freunden.'),
          el('li', {}, el('b', {}, 'Fabric / NeoForge'), ' – für Mods.'),
          el('li', {}, el('b', {}, 'Modpack'), ' – ein fertiges Paket von Modrinth, das du suchst und mit einem Klick installierst.'),
          el('li', {}, el('b', {}, 'Presets'), ' – fertige Mischungen, z. B. „Crossplay“ (Java und Bedrock zusammen).')),
        el('p', { class: 'muted' }, 'Tipp: Nimm am Anfang ein Preset. Du kannst später alles ändern.'));
    },
  });
  list.push({
    title: 'Server starten', tab: 'home', tabLabel: 'Zur Übersicht',
    render() {
      return el('div', {},
        el('p', {}, 'Auf der Übersicht ist der große Startknopf. Beim allerersten Start dauert es 1–3 Minuten, weil die Welt erzeugt wird.'),
        el('ul', { class: 'tut-list' },
          el('li', {}, 'Du musst vorher die Minecraft-EULA akzeptieren (Link steht dabei).'),
          el('li', {}, 'Im Bereich „Server & Konsole“ siehst du live, was der Server macht, und kannst Befehle eingeben.'),
          el('li', {}, 'Wenn etwas schiefgeht, erklärt dir das Dashboard den Fehler in einfachen Worten.')));
    },
  });
  list.push({
    title: 'Freunde einladen', tab: 'invite', tabLabel: 'Freunde einladen öffnen',
    render() {
      return hosted
        ? el('div', {}, el('p', {}, 'Gib deinen Freunden die Adresse deines Servers – mit Port, wenn er nicht 25565 ist. Du findest sie hier und auf der Übersicht.'),
          el('ul', { class: 'tut-list' }, el('li', {}, 'Java: Multiplayer → Server hinzufügen → Adresse einfügen.'),
            el('li', {}, 'Bedrock: Adresse und Bedrock-Port (UDP) im Reiter „Bedrock“.'),
            el('li', {}, 'Mit der Whitelist (Reiter „Spieler“) dürfen nur eingetragene Leute rein.')))
        : el('div', {}, el('p', {}, 'Im selben WLAN reicht die lokale Adresse. Für Freunde über das Internet brauchst du eine Portfreigabe im Router – oder du nimmst playit.gg bzw. Tailscale.'),
          el('p', { class: 'muted' }, 'Das Dashboard zeigt dir die Adressen und erklärt Schritt für Schritt die Portfreigabe.'));
    },
  });
  list.push({
    title: 'Mods, Plugins & Spieler', tab: 'mods', tabLabel: 'Mods / Plugins öffnen',
    render() {
      return el('ul', { class: 'tut-list' },
        el('li', {}, 'Im Reiter „Mods“ (bei Paper „Plugins“) suchst du bei Modrinth und installierst mit einem Klick.'),
        el('li', {}, 'Gelöschte Mods landen zur Sicherheit im Ordner „mods_old/geloescht“.'),
        el('li', {}, '„Spieler“: Operator-Rechte vergeben, Whitelist, Bann – mit Spielerköpfen.'),
        el('li', {}, 'Mit Strg+K öffnest du die Schnellsuche für alles im Dashboard.'));
    },
  });
  list.push({
    title: 'Backups & Sicherheit', tab: 'backups', tabLabel: 'Backups öffnen',
    render() {
      return el('ul', { class: 'tut-list' },
        el('li', {}, 'Ein Klick sichert deine Welt als ZIP – auch während der Server läuft.'),
        el('li', {}, 'Unter „Automatisch sichern“ stellst du Zeitabstand und Anzahl ein.'),
        el('li', {}, 'Vor Updates oder großen Änderungen: erst ein Backup machen.'),
        hosted ? el('li', {}, 'Dein Konto schützt du mit einem langen Passwort oder der Anmeldung mit Google. Gib dein Passwort nie weiter.') : null);
    },
  });
  list.push({
    title: 'Fertig!',
    render() {
      return el('div', {},
        el('p', {}, 'Das war’s. Wenn du später etwas nachlesen willst: Im Menü gibt es den Punkt „Anleitung“ mit Erklärungen zu allen Bereichen, und oben rechts den Knopf „?“, der diesen Assistenten wieder öffnet.'));
    },
  });
  return list;
}

let tutorialOpen = false;
function openTutorial() {
  if (tutorialOpen) return;
  tutorialOpen = true;
  let idx = 0;
  const host = el('div', { class: 'tut' });
  const dots = el('div', { class: 'tut-dots', 'aria-hidden': 'true' });
  const body = el('div', { class: 'tut-body' });
  const wrap = el('div', {}, dots, body, host);
  let closeFn = () => {};
  const draw = () => {
    const all = steps();
    idx = Math.min(idx, all.length - 1);
    const st = all[idx];
    dots.replaceChildren(...all.map((_, i) => el('span', { class: i === idx ? 'on' : i < idx ? 'done' : '' })));
    body.replaceChildren(el('h3', { class: 'tut-title' }, `${idx + 1}/${all.length} · ${st.title}`), st.render(draw));
    host.replaceChildren(el('div', { class: 'dialog-actions' },
      idx > 0 ? el('button', { class: 'btn', type: 'button', onclick: () => { idx--; draw(); } }, 'Zurück') : null,
      st.tab ? el('button', { class: 'btn', type: 'button', onclick: () => { closeFn(); showTab(st.tab); } }, st.tabLabel || 'Öffnen') : null,
      idx < all.length - 1
        ? el('button', { class: 'btn primary', type: 'button', onclick: () => { idx++; draw(); } }, 'Weiter')
        : el('button', { class: 'btn primary', type: 'button', onclick: () => closeFn() }, 'Los geht’s')));
  };
  closeFn = openDialog('Erste Schritte', wrap, [], { onClose: () => { tutorialOpen = false; store.set(tutorialKey(), '1'); } });
  draw();
}

const tutorialKey = () => `srvdash-tutorial-v1-${APP.userId || 'lokal'}`;

function maybeShowTutorial() {
  if (store.get(tutorialKey())) return;
  if (!APP.hosted && state.setup && state.setup.complete) { store.set(tutorialKey(), '1'); return; } // schon eingerichtet: nicht stören
  openTutorial();
}

// ====================================================================== Anleitung (Reiter)

const HELP = [
  ['Erste Schritte', null, [
    'Der Assistent „Erste Schritte“ führt dich in sieben kurzen Schritten vom leeren Dashboard zum laufenden Server.',
    ['button', 'Assistenten öffnen']]],
  ['Server-Typen im Überblick', null, [
    'Vanilla: das originale Minecraft. Wenig Extras, wenig Aufwand.',
    'Paper und Purpur: laufen sehr flüssig und nutzen Plugins (z. B. für Schutz, Teleport, Chat). Gut für Survival mit Freunden.',
    'Fabric und NeoForge: für Mods, die das Spiel verändern (neue Blöcke, Maschinen, Monster). Alle Mitspieler brauchen dieselben Mods.',
    'Modpack: ein fertiges Mod-Paket von Modrinth. Das Dashboard lädt alles herunter und entfernt Mods, die nur auf dem eigenen PC laufen (Client-Mods).',
    'Presets: fertige Einstellungen, z. B. „Crossplay“, damit Java- und Bedrock-Spieler zusammen spielen.']],
  ['Server starten, stoppen, Konsole', null, [
    'Startknopf auf der Übersicht oder oben rechts. Der Status wechselt von „Aus“ über „Startet“ zu „Läuft“.',
    'In „Server & Konsole“ siehst du die Meldungen live. Befehle schreibst du ohne Schrägstrich, z. B. „say Hallo“ oder „op Name“.',
    'Stoppen speichert die Welt sauber. Bitte nicht das Fenster oder den Browser als „Ausschalter“ benutzen.',
    'Stürzt der Server ab, zeigt das Dashboard eine Hilfe mit der wahrscheinlichen Ursache.']],
  ['Spieler, Whitelist, Rechte', null, [
    'Unter „Spieler“ gibst du Operator-Rechte (OP), setzt Leute auf die Whitelist oder sperrst sie.',
    'Whitelist an = nur eingetragene Spieler dürfen rein. Das ist die einfachste Sicherheit für private Server.',
    'Spielernamen sind bei Java wichtig geschrieben (Groß/Klein).']],
  ['Mods und Plugins', null, [
    'Suchen und installieren: Reiter „Mods“ bzw. „Plugins“. Die Treffer kommen von Modrinth.',
    '„Updates prüfen“ zeigt neuere Versionen. „Mods verbessern“ lädt Symbole und deaktiviert reine Client-Mods.',
    'Eigene .jar-Dateien kannst du hochladen. Gelöschte Mods werden in „mods_old/geloescht“ verschoben.',
    'Wichtig: Mods müssen zur Minecraft-Version und zum Loader (Fabric/NeoForge/Paper) passen.']],
  ['Bedrock und Crossplay', null, [
    'Mit Geyser + Floodgate können Spieler mit Handy, Windows-App, Switch, Xbox und PlayStation auf einem Java-Server mitspielen – ohne Java-Account.',
    'Bedrock benutzt einen eigenen Port (UDP). Bei Konsolen hilft der Info-Knopf im Reiter „Bedrock“ (BedrockConnect).',
    'Bei Plugin-Servern (Paper/Purpur) ist Floodgate dabei, bei Mod-Servern die passenden Mods.']],
  ['Backups', null, [
    'Ein Klick sichert die Welt als ZIP. Automatische Backups stellst du im selben Reiter ein.',
    'Zum Zurückspielen: Server stoppen, Backup wählen, „Wiederherstellen“.',
    'Mach vor jedem Update ein Backup.']],
  ['Automatik', null, [
    'Zeitpläne: Neustart, Backup oder Befehle zu festen Uhrzeiten.',
    'Bei einem Absturz kann der Server automatisch neu starten.',
    'Mit einem Discord-Webhook meldet das Dashboard Start, Stopp und Abstürze in einen Chat.']],
  ['Dateien', null, [
    'Der Datei-Manager zeigt nur den Ordner deines Servers. Du kannst Dateien ansehen, bearbeiten, hochladen und löschen.',
    'Bei Änderungen an Einstellungsdateien: Server vorher stoppen und vorher ein Backup machen.']],
  ['Verbinden: Adresse und Port', 'hosted', [
    'Jeder deiner Server hat eine eigene Adresse mit eigenem Port. Du findest sie auf der Übersicht und unter „Freunde einladen“.',
    'Java: Adresse in „Multiplayer → Server hinzufügen“ einfügen. Bedrock: Adresse und Bedrock-Port (UDP).',
    'Der Port steht fest und ändert sich nicht, solange du den Server behältst.']],
  ['Verbinden: Heimnetz und Internet', 'local', [
    'Im gleichen WLAN reicht die lokale Adresse. Du selbst nutzt „localhost“.',
    'Für Freunde im Internet brauchst du eine Portfreigabe (TCP 25565) im Router. Geht das bei dir nicht, helfen playit.gg oder Tailscale.',
    'Die öffentliche IP kann sich ändern. Gib sie nur Leuten, denen du vertraust.']],
  ['Konto und Sicherheit', 'hosted', [
    'Melde dich mit Google oder E-Mail und Passwort an. Dein Passwort muss mindestens 10 Zeichen haben.',
    'Dein Konto kann nur du sehen: Andere Benutzer haben keinen Zugriff auf deine Server, Dateien oder Backups.',
    'Zu viele falsche Passwörter sperren die Anmeldung kurz. Das schützt vor Raten.',
    'Passwort ändern und Abmelden findest du oben rechts im Benutzermenü.']],
  ['Wenn etwas nicht klappt', null, [
    'Server startet nicht: Im Reiter „Server & Konsole“ die letzten roten Zeilen lesen. Häufig fehlt die EULA-Zustimmung, oder der RAM ist zu hoch eingestellt.',
    'Nur du kannst dich verbinden: Prüfe Adresse, Port und ob der Server wirklich „Läuft“ anzeigt.',
    '„Falsche Version“ in Minecraft: Spieler müssen dieselbe Minecraft-Version nutzen wie der Server (oder Geyser/ViaVersion verwenden).',
    'Mods stürzen ab: einzeln deaktivieren und neu starten. Das Dashboard markiert verdächtige Mods.']],
  ['Kleines Wörterbuch', null, [
    'RAM: Arbeitsspeicher für den Server. Mehr ist nicht immer besser; für kleine Server reichen 2–4 GB.',
    'Port: Eine Art Türnummer. Java benutzt TCP, Bedrock benutzt UDP.',
    'EULA: Die Nutzungsbedingungen von Minecraft. Ohne Zustimmung startet der Server nicht.',
    'OP: Spieler mit Verwalter-Rechten im Spiel. Whitelist: Liste erlaubter Spieler.',
    'Loader: Die Mod-Basis (Fabric, NeoForge) oder Plugin-Basis (Paper).']],
];

function renderHelp() {
  const items = HELP.filter(([, only]) => !only || (only === 'hosted') === APP.hosted);
  $('#helpBody').replaceChildren(...items.map(([title, , content], i) => el('details', { class: 'card help-item', open: i === 0 },
    el('summary', {}, title),
    ...content.map((c) => (Array.isArray(c)
      ? el('button', { class: 'btn', type: 'button', onclick: openTutorial }, c[1])
      : el('p', {}, c))))));
}

document.querySelector('main').append(el('section', { id: 'tab-help', class: 'tab', hidden: true },
  el('h1', {}, 'Anleitung'),
  el('p', { class: 'lead' }, 'Erklärungen zu allen Bereichen des Dashboards in einfachen Worten.'),
  el('div', { id: 'helpBody' })));
loaders.help = () => APP.ready.then(renderHelp);

const helpBtn = el('button', { id: 'btnTutorial', class: 'btn icon-btn round-help', type: 'button', title: 'Erste Schritte / Hilfe', 'aria-label': 'Erste Schritte öffnen', onclick: openTutorial }, '?');
$('#btnAppearance').before(helpBtn);

if (!APP.hosted) {
  APP.ready.then(() => { if (!APP.hosted) setTimeout(maybeShowTutorial, 1500); });
}
