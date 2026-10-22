'use strict';
/* Reiter „Netzwerk & Betrieb“: Adresse und Port, Zugangspasswort, HTTPS (Let’s Encrypt), Betriebsart, Neustart. */

const SYS = { data: null, restartNeeded: false, poll: null };

function sysCard(title, ...children) {
  return el('section', { class: 'card' }, el('h2', {}, title), ...children.filter(Boolean));
}

function sysField(label, input, hint) {
  return el('label', {}, label, input, hint ? el('span', { class: 'muted small' }, hint) : null);
}

const sysInput = (v, attrs = {}) => el('input', { type: 'text', value: v ?? '', spellcheck: 'false', autocomplete: 'off', ...attrs });
const urlLink = (u) => el('a', { href: u, target: '_blank', rel: 'noopener', class: 'mono' }, u);

function copyText(text) {
  navigator.clipboard.writeText(text).then(() => toast('Kopiert.', 'ok', 1800), () => toast('Kopieren nicht möglich.', 'error'));
}

async function waitForRestart(newUrlHint) {
  toast('Das Dashboard startet neu … Die Seite lädt gleich von selbst.', 'info', 15000);
  let ok = false;
  for (let i = 0; i < 60 && !ok; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const r = await fetch(`${newUrlHint || ''}/api/system/ping`, { cache: 'no-store' });
      if (r.ok) ok = true;
    } catch { /* noch nicht da */ }
  }
  if (ok) location.href = newUrlHint || location.pathname + location.hash;
  else toast('Das Dashboard antwortet noch nicht. Falls es nicht von selbst zurückkommt, starte es mit start.bat bzw. start.sh neu.', 'error');
}

async function doRestart() {
  await api('POST', '/api/system/restart');
  await waitForRestart('');
}

// ---------------------------------------------------------------- Erreichbarkeit

function netCard(d) {
  const n = d.net;
  const locked = n.envLocked.length > 0;
  const modes = [
    ['local', 'Nur dieser PC', 'Nur über localhost erreichbar. Am sichersten.'],
    ['network', 'Auch über die IP-Adresse dieses Rechners', 'Andere Geräte im Netzwerk (und aus dem Internet, wenn der Router es freigibt) erreichen das Dashboard über die IP dieses Rechners.'],
    ['custom', 'Nur auf bestimmten Adressen', 'Das Dashboard hört nur auf die angegebenen IP-Adressen dieses Rechners (und auf localhost).'],
  ];
  const custom = sysInput(n.customBind.join(', '), { placeholder: 'z. B. 192.168.0.138' });
  const port = sysInput(n.port, { inputmode: 'numeric', class: 'num', disabled: n.envLocked.includes('port') });
  const domain = sysInput(n.publicDomain, { placeholder: 'z. B. server.meine-domain.de' });
  const radios = modes.map(([v, t, h]) => el('label', { class: 'checkline radio-line' },
    el('input', { type: 'radio', name: 'sysBind', value: v, checked: n.bind === v, disabled: n.envLocked.includes('bind'), onchange: () => { custom.disabled = v !== 'custom'; } }),
    el('span', {}, el('b', {}, t), el('br'), el('span', { class: 'muted small' }, h))));
  custom.disabled = n.bind !== 'custom';
  const urls = n.urls.map((u) => el('li', {}, el('span', { class: 'muted small' }, `${u.label}: `), urlLink(u.url), el('button', { class: 'btn small ghost', type: 'button', onclick: () => copyText(u.url) }, 'Kopieren')));
  return sysCard('Erreichbarkeit',
    el('p', { class: 'muted' }, 'Wo das Dashboard erreichbar ist. Änderungen gelten sofort, deine Minecraft-Server laufen dabei weiter.'),
    locked ? el('div', { class: 'banner info' }, 'Adresse oder Port sind über eine Umgebungsvariable (BIND / PORT) festgelegt und lassen sich hier nicht ändern.') : null,
    ...radios, el('div', { class: 'row' }, sysField('Adressen (mit Komma trennen)', custom), sysField('Port', port)),
    el('h3', { class: 'mt' }, 'Deine Domain (optional)'),
    el('p', { class: 'muted small' }, 'Die Domain, unter der dein Rechner aus dem Internet erreichbar ist (A-Record auf deine öffentliche IP). Sie erscheint bei „Freunde einladen“ und in den Einladungstexten, neben der IP-Adresse. Für den Zugriff von außen braucht das Dashboard ein Zugangspasswort.'),
    el('div', { class: 'row' }, sysField('Domain', domain)),
    n.bind === 'local' ? null : el('p', { class: 'small', style: n.passwordSet ? 'color:var(--accent)' : 'color:var(--warn)' }, n.passwordSet ? `✔ Zugriff von außen ist möglich: Dein Zugangspasswort schützt das Dashboard. Im Router muss der Port (${n.port}) zu diesem Rechner weitergeleitet sein.` : 'Zugriff aus dem Internet wird ohne Zugangspasswort blockiert. Setze unten eines.'),
    el('div', { class: 'row' }, el('button', {
      class: 'btn primary', type: 'button', disabled: locked && n.envLocked.length >= 2,
      onclick: (e) => guarded(e.currentTarget, async () => {
        const bind = document.querySelector('input[name=sysBind]:checked').value;
        const r = await api('POST', '/api/system/network', { bind, customBind: custom.value, port: Number(port.value), publicDomain: domain.value });
        toast('Gespeichert und angewendet.', 'ok');
        if (Number(port.value) !== location.port * 1 && location.port) {
          const u = r.net.urls[0].url;
          toast(`Neuer Port: ${u}`, 'info', 12000);
        }
        loadSystem();
      }),
    }, 'Anwenden')),
    el('h3', { class: 'mt' }, 'So erreichst du das Dashboard'), el('ul', { class: 'plain-list' }, ...urls));
}

// ---------------------------------------------------------------- Zugangspasswort

function passwordCard(d) {
  if (d.hosted) return null;
  const set = d.net.passwordSet;
  const p1 = el('input', { type: 'password', autocomplete: 'new-password', maxlength: 200 });
  const p2 = el('input', { type: 'password', autocomplete: 'new-password', maxlength: 200 });
  return sysCard('Zugangspasswort',
    el('p', { class: 'muted' }, 'Schützt das Dashboard vor anderen Geräten. Auf diesem PC (localhost) brauchst du es nie.'),
    el('p', {}, set ? el('span', { style: 'color:var(--accent)' }, '✔ Ein Zugangspasswort ist gesetzt.') : el('span', { style: 'color:var(--warn)' }, 'Kein Passwort gesetzt. Wer im Netzwerk die Adresse kennt, kann alles steuern.')),
    el('div', { class: 'row' }, sysField(set ? 'Neues Passwort (mindestens 10 Zeichen)' : 'Passwort (mindestens 10 Zeichen)', p1), sysField('Wiederholen', p2)),
    el('div', { class: 'row' },
      el('button', {
        class: 'btn primary', type: 'button',
        onclick: (e) => guarded(e.currentTarget, async () => {
          if (p1.value !== p2.value) throw new Error('Die beiden Passwörter sind nicht gleich.');
          await api('POST', '/api/system/password', { password: p1.value });
          toast('Passwort gespeichert. Andere Geräte müssen sich neu anmelden.', 'ok');
          loadSystem();
        }),
      }, set ? 'Passwort ändern' : 'Passwort setzen'),
      set ? el('button', {
        class: 'btn', type: 'button',
        onclick: (e) => guarded(e.currentTarget, async () => {
          if (!confirm('Passwort entfernen? Dann kann jeder, der das Dashboard im Netzwerk erreicht, alles steuern.')) return;
          await api('POST', '/api/system/password', { password: null });
          toast('Passwort entfernt.', 'ok');
          loadSystem();
        }),
      }, 'Passwort entfernen') : null));
}

// ---------------------------------------------------------------- HTTPS

function httpsCard(d) {
  const h = d.https;
  const st = h.status;
  const domain = sysInput(h.domain, { placeholder: 'dashboard.meine-domain.de' });
  const email = sysInput(h.email, { type: 'email', placeholder: 'du@example.com' });
  const chk = (label, checked, hint) => {
    const i = el('input', { type: 'checkbox', checked });
    return [i, el('label', { class: 'checkline' }, i, el('span', {}, label, hint ? el('span', { class: 'muted small' }, ` ${hint}`) : null))];
  };
  const [enabled, enabledRow] = chk('HTTPS verwenden', h.enabled);
  const [staging, stagingRow] = chk('Test-System von Let’s Encrypt verwenden', h.staging, '(Browser vertrauen dem Zertifikat nicht, aber es gibt keine Begrenzung. Zum Ausprobieren.)');
  const [redirect, redirectRow] = chk('Aufrufe über HTTP automatisch auf HTTPS umleiten', h.redirect);
  const httpPort = sysInput(h.httpPort, { class: 'num', inputmode: 'numeric' });
  const httpsPort = sysInput(h.httpsPort, { class: 'num', inputmode: 'numeric' });
  const save = async () => {
    await api('POST', '/api/system/https', {
      domain: domain.value, email: email.value, enabled: enabled.checked, staging: staging.checked, redirect: redirect.checked,
      httpPort: Number(httpPort.value), httpsPort: Number(httpsPort.value),
    });
  };
  let statusBlock;
  if (st.exists) {
    const warn = st.daysLeft < 30;
    statusBlock = el('div', { class: `banner ${st.domainMatches && !st.staging ? 'ok' : 'warn'}` },
      el('b', {}, st.domainMatches ? (st.staging ? 'Test-Zertifikat vorhanden' : '✔ Zertifikat vorhanden') : 'Zertifikat gehört zu einer anderen Domain'),
      el('div', { class: 'small' }, `Für: ${st.names.join(', ') || st.subject}`),
      el('div', { class: 'small' }, `Gültig bis: ${new Date(st.validTo).toLocaleDateString('de-DE')} (noch ${st.daysLeft} Tage)${warn ? ' – wird bald erneuert' : ''}`),
      el('div', { class: 'small muted' }, `Aussteller: ${st.issuer}`),
      el('div', { class: 'small muted' }, h.enabled ? 'Wird 30 Tage vor Ablauf automatisch erneuert (solange das Dashboard läuft).' : 'Automatische Erneuerung läuft, sobald „HTTPS verwenden“ aktiv ist.'));
  } else {
    statusBlock = el('div', { class: 'banner info' }, 'Noch kein Zertifikat vorhanden.');
  }
  const err = st.lastError ? el('div', { class: 'banner error' }, st.lastError) : null;
  const listenerErrors = (h.listeners?.errors || []).map((e) => el('div', { class: 'banner warn' }, e));
  const issueBtn = el('button', {
    class: 'btn primary', type: 'button', disabled: st.working,
    onclick: (e) => guarded(e.currentTarget, async () => {
      await save();
      await api('POST', '/api/system/https/issue');
      toast('Zertifikat wird angefordert … das dauert etwa eine halbe Minute.', 'info', 8000);
      pollCert();
    }),
  }, st.working ? 'Läuft …' : (st.exists ? '🔒 Zertifikat jetzt erneuern' : '🔒 Zertifikat erstellen'));
  return sysCard('HTTPS mit Let’s Encrypt',
    el('p', { class: 'muted' }, 'Ein kostenloses Zertifikat macht die Verbindung verschlüsselt (Schloss im Browser). Es wird per Knopfdruck erstellt und danach automatisch erneuert.'),
    el('details', { class: 'info-details' }, el('summary', {}, 'Was muss vorher stimmen?'),
      el('ul', { class: 'tut-list' },
        el('li', {}, 'Du besitzt eine Domain, und ihr A-Record zeigt auf die öffentliche IP dieses Rechners.'),
        el('li', {}, `Port ${h.httpPort} (für die Bestätigung durch Let’s Encrypt) und Port ${h.httpsPort} (HTTPS) sind in Router und Firewall zu diesem Rechner freigegeben und frei.`),
        el('li', {}, 'Unter Linux brauchen Ports unter 1024 eine Berechtigung (siehe DEPLOY.md).'),
        el('li', {}, 'Stelle die Erreichbarkeit oben auf „Auch über die IP-Adresse dieses Rechners“.'))),
    el('div', { class: 'row' }, sysField('Domain', domain), sysField('E-Mail für Hinweise', email)),
    enabledRow, redirectRow, stagingRow,
    el('details', {}, el('summary', {}, 'Ports ändern (nur für Fortgeschrittene)'), el('div', { class: 'row' }, sysField('HTTP-Port (Bestätigung)', httpPort), sysField('HTTPS-Port', httpsPort))),
    statusBlock, err, ...listenerErrors,
    el('div', { class: 'row' }, issueBtn,
      el('button', {
        class: 'btn', type: 'button',
        onclick: (e) => guarded(e.currentTarget, async () => { await save(); toast('HTTPS-Einstellungen gespeichert.', 'ok'); loadSystem(); }),
      }, 'Nur speichern'),
      st.exists ? el('button', {
        class: 'btn danger', type: 'button',
        onclick: (e) => guarded(e.currentTarget, async () => {
          if (!confirm('Zertifikat löschen und HTTPS ausschalten?')) return;
          await api('POST', '/api/system/https/remove');
          toast('HTTPS ausgeschaltet.', 'ok');
          loadSystem();
        }),
      }, 'Zertifikat entfernen') : null));
}

function pollCert() {
  clearInterval(SYS.poll);
  let n = 0;
  SYS.poll = setInterval(async () => {
    n++;
    try {
      const d = await api('GET', '/api/system');
      if (!d.https.status.working || n > 60) {
        clearInterval(SYS.poll);
        if (d.https.status.lastError && !d.https.status.exists) toast('Das Zertifikat konnte nicht erstellt werden. Details stehen unten.', 'error', 10000);
        else if (d.https.status.exists) toast('Zertifikat bereit.', 'ok');
        if (state.tab === 'system') loadSystem();
      }
    } catch { clearInterval(SYS.poll); }
  }, 2500);
}

// ---------------------------------------------------------------- Betriebsart

function modeCard(d) {
  const hs = d.hostedSettings;
  const locked = d.modeLockedByEnv;
  const modeBtn = el('button', {
    class: 'btn', type: 'button', disabled: locked,
    onclick: (e) => guarded(e.currentTarget, async () => {
      const want = !d.hosted;
      const msg = want
        ? 'Auf Mehrbenutzer umstellen?\n\nBenutzer melden sich mit Konto an (E-Mail oder Google), und jeder sieht nur seine eigenen Server. Das erste Konto, das du danach anlegst, wird Administrator und bekommt alle schon vorhandenen Server. Das Dashboard startet dafür neu.'
        : 'Zurück auf den lokalen Modus?\n\nDann gibt es keine Anmeldung mehr, alle Server sind für jeden sichtbar, der das Dashboard erreicht. Konten bleiben gespeichert. Das Dashboard startet dafür neu.';
      if (!confirm(msg)) return;
      await api('POST', '/api/system/mode', { hosted: want });
      SYS.restartNeeded = true;
      await doRestart();
    }),
  }, d.hosted ? 'Zurück auf lokalen Modus' : 'Auf Mehrbenutzer umstellen');
  const url = sysInput(hs.publicUrl, { placeholder: 'https://dashboard.meine-domain.de', disabled: hs.envLocked.includes('publicUrl') });
  const host = sysInput(hs.publicHost || '', { placeholder: 'Adresse, die Spieler eintippen (leer = wie oben)', disabled: hs.envLocked.includes('publicHost') });
  const proxy = el('input', { type: 'checkbox', checked: hs.trustProxy, disabled: hs.envLocked.includes('trustProxy') });
  const gid = sysInput(hs.googleClientId, { placeholder: 'Client-ID von Google' });
  const gsecret = el('input', { type: 'password', autocomplete: 'off', placeholder: hs.google ? '•••• gespeichert (leer lassen = behalten)' : 'Client-Secret von Google' });
  const hostedBlock = d.hosted ? el('div', {},
    el('h3', { class: 'mt' }, 'Einstellungen für den Mehrbenutzer-Betrieb'),
    el('div', { class: 'row' }, sysField('Öffentliche Adresse der Seite', url, 'Mit HTTPS wird sie automatisch die Domain.'), sysField('Adresse für Minecraft-Spieler', host)),
    el('label', { class: 'checkline' }, proxy, el('span', {}, 'Ein Reverse-Proxy (z. B. Caddy, nginx) steht davor und darf die Client-IP weitergeben')),
    el('h3', { class: 'mt' }, 'Anmeldung mit Google (optional)'),
    el('p', { class: 'muted small' }, 'Weiterleitungs-URI bei Google: ', el('code', {}, `${hs.publicUrl.replace(/\/$/, '')}/auth/google/callback`)),
    el('div', { class: 'row' }, sysField('Client-ID', gid), sysField('Client-Secret', gsecret)),
    el('div', { class: 'row' }, el('button', {
      class: 'btn primary', type: 'button',
      onclick: (e) => guarded(e.currentTarget, async () => {
        const r = await api('POST', '/api/system/hosted', {
          publicUrl: url.value, publicHost: host.value, trustProxy: proxy.checked, google: { clientId: gid.value, clientSecret: gsecret.value },
        });
        SYS.restartNeeded = r.restartNeeded;
        toast('Gespeichert. Zum Anwenden das Dashboard neu starten.', 'ok');
        loadSystem();
      }),
    }, 'Speichern'), el('span', { class: 'muted small' }, 'Registrierung, Kontingente und RAM-Budget stellst du im Reiter „Benutzer“ ein.'))) : null;
  return sysCard('Betriebsart',
    el('p', {}, el('b', {}, d.hosted ? 'Mehrbenutzer-Betrieb (mit Anmeldung)' : 'Lokaler Betrieb (ein Benutzer)')),
    el('p', { class: 'muted' }, d.hosted
      ? 'Jeder Benutzer hat ein eigenes Konto und eigene Server, jeder Server bekommt einen eigenen Port.'
      : 'Du betreibst deine Server allein. Für die Nutzung hinter einer Domain mit mehreren Benutzern stelle auf Mehrbenutzer um.'),
    locked ? el('div', { class: 'banner info' }, 'Die Betriebsart ist über die Umgebungsvariable HOSTED festgelegt.') : null,
    el('div', { class: 'row' }, modeBtn), hostedBlock);
}

// ---------------------------------------------------------------- Dauerbetrieb & Autostart

function autostartCard(d) {
  const a = d.autostart;
  const sv = d.service;
  const cb = el('input', { type: 'checkbox', checked: a.enabled, role: 'switch' });
  cb.addEventListener('change', () => guarded(null, async () => {
    try {
      await api('POST', '/api/system/autostart', { enabled: cb.checked });
      toast(cb.checked ? 'Autostart eingeschaltet.' : 'Autostart ausgeschaltet.', 'ok');
    } catch (e) { cb.checked = !cb.checked; throw e; }
    loadSystem();
  }));
  const how = sv.systemd ? 'als Dienst (systemd). Er startet mit dem Rechner und nach einem Absturz von selbst neu.'
    : sv.pm2 ? 'unter pm2.' : 'im Vordergrund. Nach einem Neustart des Rechners startet er nicht von selbst.';
  return sysCard('Dauerbetrieb und Autostart',
    el('p', {}, el('b', {}, 'Das Dashboard läuft '), how),
    sv.systemd ? null : el('p', { class: 'muted small' }, 'Damit es dauerhaft läuft und mit dem Rechner startet, richte es als Dienst bzw. Autostart ein. Die Anleitung steht in DAUERBETRIEB.md (Linux: sudo ./install-service.sh, Windows: install-autostart.bat).'),
    el('label', { class: 'checkline switch-line' }, cb, el('span', {}, el('b', {}, 'Minecraft-Server nach einem Neustart automatisch starten'), el('br'),
      el('span', { class: 'muted small' }, 'Startet das Dashboard, startet es den Server wieder, der zuletzt lief. Hast du ihn vorher im Dashboard bewusst gestoppt, bleibt er aus. So kannst du nach einem Neustart des Rechners direkt spielen.'))),
    a.enabled ? el('p', { class: 'small' }, a.servers.length ? ['Wird beim nächsten Start gestartet: ', el('b', {}, a.servers.map((s) => s.name).join(', '))] : 'Zurzeit läuft kein Server, der beim nächsten Start gestartet würde.') : null);
}

// ---------------------------------------------------------------- Updates des Dashboards

const fmtDay = (ms) => (ms ? new Date(ms).toLocaleDateString('de-DE') : '–');

function updateCard(d, up) {
  if (!up) return null;
  const inst = up.installed;
  const ver = inst.sha ? `Version ${inst.sha.slice(0, 7)}${inst.dateMs ? ` vom ${fmtDay(inst.dateMs)}` : ''}` : `Stand vom ${fmtDay(inst.dateMs)} (genaue Version unbekannt)`;
  const running = d.runningServers > 0;
  const auto = el('input', { type: 'checkbox', checked: up.autoCheck });
  auto.addEventListener('change', () => guarded(null, async () => { await api('POST', '/api/update/settings', { autoCheck: auto.checked }); toast(auto.checked ? 'Tägliche Prüfung eingeschaltet.' : 'Tägliche Prüfung ausgeschaltet.', 'ok'); }));
  const list = up.available
    ? el('details', { open: up.pending.length <= 6 }, el('summary', {}, `${up.pending.length} Änderung${up.pending.length === 1 ? '' : 'en'} ansehen`),
      el('ul', { class: 'plain-list small' }, ...up.pending.slice(0, 40).map((c) => el('li', {}, el('span', { class: 'muted' }, `${fmtDay(Date.parse(c.date))} · `), c.title))))
    : null;
  const status = up.error
    ? el('div', { class: 'banner warn' }, `Die letzte Prüfung hat nicht geklappt: ${up.error}`)
    : up.available
      ? el('div', { class: 'banner ok' }, el('b', {}, 'Eine neue Version ist verfügbar.'), list)
      : el('div', { class: 'banner info' }, up.checkedAt ? `Du hast die neueste Version (geprüft am ${new Date(up.checkedAt).toLocaleString('de-DE')}).` : 'Noch nicht nach Updates gesucht.');
  return sysCard('Updates',
    el('p', {}, el('b', {}, 'Installiert: '), ver, el('span', { class: 'muted small' }, inst.kind === 'git' ? ' · Git-Ordner' : ' · aus ZIP installiert')),
    status,
    el('div', { class: 'row' },
      el('button', {
        class: 'btn', type: 'button',
        onclick: (e) => guarded(e.currentTarget, async () => { await api('POST', '/api/update/check'); loadSystem(); }),
      }, 'Jetzt nach Updates suchen'),
      up.available ? el('button', {
        class: 'btn primary', type: 'button', disabled: running, title: running ? 'Zuerst alle Minecraft-Server stoppen' : '',
        onclick: (e) => guarded(e.currentTarget, installUpdate),
      }, '⬇ Jetzt aktualisieren') : null,
      running && up.available ? el('span', { class: 'muted small' }, 'Zum Aktualisieren erst alle Minecraft-Server stoppen.') : null),
    el('label', { class: 'checkline' }, auto, el('span', {}, 'Einmal am Tag automatisch nach Updates suchen ', el('span', { class: 'muted small' }, '(fragt GitHub an, siehe Datenschutz)'))),
    el('p', { class: 'muted small' }, 'Beim Aktualisieren wird nur der Programmcode ersetzt. Einstellungen, Server und Welten (Ordner data, server, servers) bleiben unberührt, der alte Programmstand wird in data/update-backup gesichert. Danach startet das Dashboard von selbst neu.'));
}

async function installUpdate() {
  const ok = await confirmDialog('Dashboard jetzt aktualisieren?',
    el('div', {}, el('p', {}, 'Die neue Version wird heruntergeladen und installiert, danach startet das Dashboard neu. Das dauert etwa eine Minute. Währenddessen ist die Seite kurz nicht erreichbar.'),
      el('p', { class: 'muted small' }, 'Deine Einstellungen, Server und Welten bleiben unverändert.')), 'Ja, aktualisieren');
  if (!ok) return;
  jobDismissed = null;
  const { job } = await api('POST', '/api/update/install');
  toast('Das Update läuft …', 'info', 6000);
  for (let i = 0; i < 400; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const j = state.job;
    if (j && j.id === job.id && !j.running) {
      if (j.error) { toast(j.error, 'error', 15000); return; }
      await waitForRestart('');
      return;
    }
  }
}

// ---------------------------------------------------------------- Impressum und Datenschutz

function legalCard(d) {
  const l = d.legal;
  const name = sysInput(l.custom ? l.operator : '', { placeholder: l.defaultOperator || 'GitHub-Benutzername' });
  return sysCard('Impressum und Datenschutz',
    el('p', { class: 'muted' }, 'Die beiden Seiten sind ohne Anmeldung erreichbar und stehen unten auf jeder Seite verlinkt. Als Betreiber erscheint nur ein GitHub-Benutzername, kein Klarname.'),
    el('div', { class: 'row' }, sysField('Betreiber (GitHub-Benutzername)', name, `Leer lassen für den Standard: ${l.defaultOperator || '–'}`)),
    el('div', { class: 'row' },
      el('button', {
        class: 'btn primary', type: 'button',
        onclick: (e) => guarded(e.currentTarget, async () => { await api('POST', '/api/system/legal', { operator: name.value }); toast('Gespeichert.', 'ok'); loadSystem(); }),
      }, 'Speichern'),
      el('a', { class: 'btn', href: '#impressum', 'data-goto': 'impressum' }, 'Impressum ansehen'),
      el('a', { class: 'btn', href: '#datenschutz', 'data-goto': 'datenschutz' }, 'Datenschutz ansehen')),
    el('p', { class: 'muted small' }, 'Eigene Texte: Lege Dateien gleichen Namens in data/legal/ ab (impressum.de.html, impressum.en.html, datenschutz.de.html, datenschutz.en.html). Sie gehen vor und bleiben bei Updates erhalten. Hinweis: Das sind Vorlagen für ein privates Projekt, keine Rechtsberatung.'));
}

// ---------------------------------------------------------------- Neustart & Speicherort

function infoCard(d) {
  return sysCard('Neustart und Speicherort',
    el('p', { class: 'muted' }, 'Manche Änderungen (Betriebsart, öffentliche Adresse, Google-Anmeldung) gelten erst nach einem Neustart des Dashboards. Läuft ein Minecraft-Server, muss er vorher gestoppt werden.'),
    SYS.restartNeeded ? el('div', { class: 'banner warn' }, 'Es gibt gespeicherte Änderungen, die einen Neustart brauchen.') : null,
    el('div', { class: 'row' }, el('button', {
      class: 'btn', type: 'button', disabled: d.runningServers > 0,
      title: d.runningServers ? 'Zuerst alle Minecraft-Server stoppen' : '',
      onclick: (e) => guarded(e.currentTarget, async () => { if (confirm('Dashboard jetzt neu starten?')) await doRestart(); }),
    }, '↻ Dashboard neu starten'), d.runningServers ? el('span', { class: 'muted small' }, `Es läuft noch ${d.runningServers} Minecraft-Server.`) : null),
    el('h3', { class: 'mt' }, 'Wo liegen deine Einstellungen?'),
    el('p', {}, el('code', {}, d.dataDir)),
    el('p', { class: 'muted small' }, 'Alle Einstellungen (Netzwerk, Benutzer, Zertifikate, Server-Liste) liegen in diesem Ordner, getrennt vom Programmcode. Ein Update von GitHub (git pull oder update.bat / update.sh) verändert ihn nicht. Wenn du das Programm als ZIP neu herunterlädst, kopiere den Ordner „data“ in den neuen Programmordner.'));
}

function renderSystem(d, up) {
  SYS.data = d;
  document.getElementById('netWarn')?.remove(); // die Hinweise stehen auf dieser Seite selbst
  document.getElementById('updNotice')?.remove();
  const box = $('#systemBody');
  const warn = d.warnings.map((w) => el('div', { class: `banner ${w.level === 'warn' ? 'warn' : 'info'}` }, w.text));
  box.replaceChildren(...warn, netCard(d), passwordCard(d), httpsCard(d), modeCard(d), autostartCard(d), updateCard(d, up), legalCard(d), infoCard(d));
}

async function loadSystem() {
  const [d, up] = await Promise.all([api('GET', '/api/system'), api('GET', '/api/update').catch(() => null)]);
  renderSystem(d, up);
  if (up) setNavVersion(up);
}

(function installSystemTab() {
  const nav = $('#tabs');
  const btn = el('button', { 'data-tab': 'system' });
  btn.innerHTML = '<svg class="ni" aria-hidden="true"><use href="assets/icons.svg#network"/></svg> Netzwerk &amp; Betrieb';
  const settingsBtn = nav.querySelector('[data-tab=settings]');
  if (settingsBtn) settingsBtn.after(btn); else nav.append(btn);
  btn.addEventListener('click', () => showTab('system'));
  $('main').append(el('section', { id: 'tab-system', class: 'tab', hidden: true },
    el('h1', {}, 'Netzwerk & Betrieb'),
    el('p', { class: 'lead' }, 'Wie und wo das Dashboard selbst erreichbar ist: Adresse, Passwort, HTTPS und Betriebsart.'),
    el('div', { id: 'systemBody' })));
  loaders.system = loadSystem;
})();

// Hinweis oben auf jeder Seite, solange das Dashboard im Netzwerk erreichbar ist, aber kein Passwort hat (nur auf dem eigenen PC sichtbar)
(async function networkWarning() {
  try {
    await APP.ready;
    if (APP.hosted) return;
    const d = await api('GET', '/api/system');
    const w = d.warnings.find((x) => x.level === 'warn');
    if (!w || sessionStorage.getItem('netWarnHidden')) return;
    const bar = el('div', { id: 'netWarn', class: 'banner warn net-warn', role: 'alert' },
      el('span', {}, '⚠ ', w.text),
      el('span', { class: 'net-warn-actions' },
        el('button', { class: 'btn small primary', type: 'button', onclick: () => { showTab('system'); } }, 'Passwort setzen'),
        el('button', {
          class: 'btn small', type: 'button',
          onclick: (e) => guarded(e.currentTarget, async () => { await api('POST', '/api/system/network', { bind: 'local' }); bar.remove(); toast('Das Dashboard ist jetzt nur noch auf diesem PC erreichbar.', 'ok'); }),
        }, 'Nur dieser PC'),
        el('button', { class: 'btn small ghost', type: 'button', onclick: () => { try { sessionStorage.setItem('netWarnHidden', '1'); } catch { /* egal */ } bar.remove(); } }, 'Später')));
    $('main').before(bar);
  } catch { /* Zugriff verweigert oder nicht verfügbar: dann gibt es nichts anzuzeigen */ }
})();

// Versionsanzeige unten im Menü: Nummer, bei verfügbarem Update ein ✦ (Klick öffnet die Update-Karte)
function setNavVersion(up) {
  const box = document.getElementById('navVersion');
  if (!box || !APP.semver) return;
  const v = APP.version || {};
  const parts = [el('span', {}, `v${APP.semver}`)];
  if (APP.restartNeeded) parts.push(el('span', { class: 'nv-new' }, 'Neustart nötig'));
  else if (up && up.available) parts.push(el('span', { class: 'nv-new' }, 'Update'));
  box.replaceChildren(...parts);
  const sha = v.sha ? ' Stand ' + v.sha : '';
  box.title = APP.restartNeeded ? 'Das Dashboard wurde aktualisiert, läuft aber noch mit dem alten Stand. Klicken, dann unter „Neustart und Speicherort“ neu starten.' + sha : (up && up.available ? `Neue Version verfügbar (${up.pending.length} Änderung(en)). Klicken zum Aktualisieren.` : 'Version des Dashboards.') + sha;
  box.hidden = false;
}
(function navVersionInit() {
  const box = document.getElementById('navVersion');
  if (!box) return;
  const open = () => { showTab('system'); document.getElementById('tabs')?.classList.remove('open'); };
  box.addEventListener('click', open);
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
})();

// Hinweis auf neue Versionen (nur für Administratoren sichtbar, die Abfrage selbst läuft ohne Netzwerkzugriff) auf neue Versionen (nur für Administratoren sichtbar, die Abfrage selbst läuft ohne Netzwerkzugriff)
(async function updateNotice() {
  try {
    await APP.ready;
    setNavVersion(null);
    const up = await api('GET', '/api/update');
    setNavVersion(up);
    setInterval(() => api('GET', '/api/update').then(setNavVersion).catch(() => {}), 30 * 60 * 1000);
    if (!up.available) return;
    const key = `updHidden:${up.latest?.sha}`;
    if (sessionStorage.getItem(key)) return;
    const bar = el('div', { id: 'updNotice', class: 'banner ok net-warn', role: 'status' },
      el('span', {}, `⬇ Eine neue Version des Dashboards ist verfügbar (${up.pending.length} Änderung${up.pending.length === 1 ? '' : 'en'}).`),
      el('span', { class: 'net-warn-actions' },
        el('button', { class: 'btn small primary', type: 'button', onclick: () => { showTab('system'); } }, 'Ansehen'),
        el('button', { class: 'btn small ghost', type: 'button', onclick: () => { try { sessionStorage.setItem(key, '1'); } catch { /* egal */ } bar.remove(); } }, 'Später')));
    $('main').before(bar);
  } catch { /* kein Zugriff oder nicht verfügbar */ }
})();

// ---------------------------------------------------------------- Sprache
(function installLanguageUi() {
  const sel = document.getElementById('langSelect');
  if (!sel || !window.I18N) return;
  I18N.languages().then((list) => {
    sel.replaceChildren(...list.map((l) => el('option', { value: l.code }, l.name)));
    sel.value = list.some((l) => l.code === I18N.lang) ? I18N.lang : 'de';
  });
  sel.addEventListener('change', () => I18N.setLang(sel.value));
  document.getElementById('btnLangMissing')?.addEventListener('click', () => {
    const txt = I18N.exportMissing();
    const a = el('a', { href: URL.createObjectURL(new Blob([txt], { type: 'application/json' })), download: `missing-${I18N.lang}.json` });
    document.body.append(a); a.click(); a.remove();
  });
})();

// ---------------------------------------------------------------- Impressum und Datenschutz als Seiten im Dashboard
(function installLegalTabs() {
  let lang = (window.I18N && I18N.lang === 'en') ? 'en' : 'de';
  const pages = ['impressum', 'datenschutz'];
  const load = async (page) => {
    const box = document.getElementById(`legalBody-${page}`);
    box.textContent = '…';
    let c;
    try {
      c = await api('GET', `/api/legal/${page}?lang=${lang}`);
    } catch {
      // Ältere Serverversion (noch nicht neu gestartet): die Einzelseite laden und den Text daraus übernehmen
      const res = await fetch(`/${page}?lang=${lang}`, { cache: 'no-store' });
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const art = doc.querySelector('article');
      if (!art) { box.textContent = 'Die Seite konnte nicht geladen werden. Bitte das Dashboard neu starten.'; return; }
      c = { html: art.innerHTML, lang };
    }
    box.innerHTML = c.html;
    box.lang = c.lang;
    box.querySelectorAll('a[href^="http"]').forEach((a) => { a.target = '_blank'; a.rel = 'noopener'; });
    box.querySelectorAll('a[href^="/impressum"], a[href^="/datenschutz"]').forEach((a) => { a.dataset.goto = a.getAttribute('href').slice(1).split('?')[0]; });
  };
  for (const page of pages) {
    const other = pages.find((p) => p !== page);
    const nav = el('div', { class: 'legal-nav' },
      el('a', { href: '#settings', 'data-goto': 'settings' }, '← Einstellungen'),
      el('span', {},
        el('a', { href: `#${other}`, 'data-goto': other }, other === 'impressum' ? 'Impressum' : 'Datenschutz'),
        ' · ',
        el('a', { href: '#', onclick: (e) => { e.preventDefault(); lang = lang === 'de' ? 'en' : 'de'; load(page).catch((er) => toast(er.message, 'error')); } }, 'Deutsch / English')));
    $('main').append(el('section', { id: `tab-${page}`, class: 'tab', hidden: true },
      el('div', { class: 'card legal-inline' }, nav, el('article', { id: `legalBody-${page}`, 'data-no-i18n': '' }))));
    loaders[page] = () => load(page);
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('[data-goto]');
    if (!a) return;
    e.preventDefault();
    showTab(a.dataset.goto);
  });
})();
