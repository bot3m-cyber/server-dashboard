# Minecraft Server-Dashboard

## ⬇ Herunterladen und starten (3 Schritte)

1. **[Hier klicken: Server-Dashboard.zip herunterladen](https://github.com/bot3m-cyber/server-dashboard/archive/refs/heads/main.zip)** und die ZIP-Datei entpacken.
2. Einmalig [Node.js](https://nodejs.org) installieren (LTS-Version), falls noch nicht vorhanden.
3. **Windows:** im entpackten Ordner `start.bat` doppelklicken. **Linux/macOS:** `chmod +x start.sh` und `./start.sh`.
   Der Browser öffnet sich mit dem Dashboard (`http://localhost:3000`). Beim ersten Start führt dich der Assistent „Erste Schritte“.

> Das Dashboard läuft auf deinem eigenen PC. Eine Webseite zum direkten Öffnen im Browser gibt es nicht, weil es Minecraft-Server auf deinem Rechner starten muss.

Eine lokale Web-App, mit der du einen Minecraft-Modpack-Server (Modrinth-`.mrpack`, NeoForge) auf deinem
eigenen PC (Windows; Linux und macOS über `start.sh`) einrichtest und betreibst. Das Dashboard öffnest du auf diesem PC unter
`http://localhost:3000`. Standardmäßig hört es auch auf die IP-Adresse des Rechners (siehe „Netzwerk, Domain und HTTPS“), du kannst es dort auf „nur dieser PC“ stellen.

## Voraussetzungen

- **Node.js** (aktuelle LTS-Version) von <https://nodejs.org>
- **Java 21**. Das Dashboard findet Java 21 auch im offiziellen Minecraft-Launcher. Fehlt es, zeigt
  Schritt 3 den Link zu [Eclipse Temurin 21](https://adoptium.net/de/temurin/releases/?version=21).
- Internetverbindung für die Einrichtung (Mods und NeoForge werden heruntergeladen)

## Starten

1. Den Ordner `minecraft-server-dashboard` an einen festen Ort legen.
2. **Windows: Doppelklick auf `start.bat`.** Linux/macOS: im Ordner `chmod +x start.sh` und dann `./start.sh`.
   Beim ersten Mal läuft automatisch `npm install`. Du kannst es auch selbst im Ordner ausführen.
3. Der Browser öffnet `http://localhost:3000`. Falls nicht, die Adresse selbst eingeben.
4. Das schwarze Fenster offen lassen, solange das Dashboard laufen soll.
   **Zum Beenden erst den Minecraft-Server mit „Stopp“ anhalten, dann im Fenster Strg+C drücken.**

Beim ersten Öffnen erscheint der Assistent **„Erste Schritte“**: Du wählst dein System (Windows, Linux, macOS) und siehst, wie Java
installiert wird, wie du das Dashboard startest und was bei der Firewall zu tun ist. Später findest du ihn über den Knopf „?“ oben rechts;
der Reiter **Anleitung** erklärt alle Bereiche.

## Als Website für mehrere Benutzer

Mit der Umgebungsvariable `HOSTED=1` läuft das Dashboard als Mehrbenutzer-Seite mit Anmeldung (E-Mail oder Google), getrennten Servern,
einem eigenen Port pro Server und Kontingenten. Aufbau auf einem Linux-Server mit Domain, HTTPS, Firewall und Google-Anmeldung:
siehe **[DEPLOY.md](DEPLOY.md)**. Ohne `HOSTED=1` ändert sich nichts am lokalen Betrieb.

## Netzwerk, Domain und HTTPS

Im Reiter **„Netzwerk & Betrieb“** stellst du alles ein, ohne Dateien zu bearbeiten:

- **Erreichbarkeit:** nur dieser PC, oder auch über die IP-Adresse des Rechners (Standard), oder nur bestimmte Adressen. Port einstellbar. Änderungen gelten sofort, laufende Minecraft-Server stören sie nicht.
- **Zugangspasswort (optional):** schützt das Dashboard vor anderen Geräten. Auf diesem PC (localhost) brauchst du es nie.
- **HTTPS:** ein kostenloses Let’s-Encrypt-Zertifikat per Knopfdruck, automatische Erneuerung.
- **Betriebsart:** lokal oder Mehrbenutzer (mit Anmeldung, auch hinter einer Domain). Beim Umstellen werden vorhandene Server dem ersten Administrator zugeordnet.

- **Domain (optional):** Trage die Domain ein, unter der dein Rechner aus dem Internet erreichbar ist. Sie erscheint bei „Freunde einladen“ neben der IP-Adresse, z. B. für Einladungen per E-Mail.

**Zugriff aus dem Internet:** Er ist nur mit gesetztem Zugangspasswort möglich (im Mehrbenutzer-Modus mit Anmeldung). Ohne Passwort sperrt das Dashboard Anfragen aus dem Internet und zeigt eine Seite, die erklärt, was zu tun ist. Zusätzlich muss der Port im Router zu diesem Rechner weitergeleitet sein.

**Wichtig:** Ist das Dashboard im Netzwerk erreichbar, aber ohne Passwort, kann jeder im Netzwerk deine Server steuern. Das Dashboard weist oben darauf hin. Setze ein Passwort oder wähle „Nur dieser PC“.

## Dauerbetrieb und Autostart

Das Dashboard läuft als Dienst dauerhaft im Hintergrund und startet mit dem Rechner: unter Debian/Ubuntu mit `sudo ./install-service.sh`, unter Windows mit `install-autostart.bat`. Im Reiter „Netzwerk & Betrieb“ gibt es den Haken **„Minecraft-Server nach einem Neustart automatisch starten“**, damit du nach einem Neustart direkt spielen kannst. Vor dem Stoppen oder Neustarten eines Servers fragt das Dashboard nach. Alle Schritte: **[DAUERBETRIEB.md](DAUERBETRIEB.md)**.

## Updates, ohne Einstellungen zu verlieren

Alle Einstellungen liegen im Ordner `data/` und stehen in `.gitignore`. `update.bat` (Windows) bzw. `./update.sh` (Linux/macOS) holt die neueste Version von GitHub und lässt `data/` unberührt. Bei einem ZIP-Download: den Ordner `data` in den neuen Programmordner kopieren.

**Update im Dashboard:** Unter „Netzwerk & Betrieb“ → „Dashboard aktualisieren“ prüft das Dashboard bei GitHub, ob es eine neue Version gibt (einmal täglich, abschaltbar), zeigt die Änderungsliste und installiert sie per Knopfdruck. Der alte Programmstand wird vorher nach `data/update-backup` gesichert, bei einem Fehler wird zurückgesetzt, danach startet das Dashboard neu. Dazu müssen alle Minecraft-Server gestoppt sein. Einstellungen, Server und Welten bleiben unberührt.

## Sprachen

Das Dashboard gibt es auf Deutsch und Englisch (Einstellungen → Sprache). Eine Sprache ist nur eine Datei: `public/lang/<code>.json` (kommt mit Updates) oder `data/lang/<code>.json` (eigene Sprachen und Anpassungen, bleiben bei Updates erhalten). Schlüssel ist der deutsche Originaltext, der Wert die Übersetzung; fehlende Sätze bleiben deutsch. Neue Sprache: `en.json` nach `data/lang/fr.json` kopieren, `_meta` anpassen, Werte übersetzen, Seite neu laden. „Fehlende Sätze exportieren“ in den Einstellungen liefert eine Vorlage. Impressum und Datenschutz haben eigene Dateien in `lib/legaltext/` (`data/legal/` geht vor).

## Impressum und Datenschutz

Beide Seiten sind ohne Anmeldung erreichbar (`/impressum`, `/datenschutz`) und unten auf jeder Seite verlinkt. Es erscheint nur der GitHub-Benutzername als Betreiber (änderbar unter Netzwerk & Betrieb). Das sind Vorlagen für ein privates, nicht kommerzielles Projekt, keine Rechtsberatung. Für den öffentlichen oder geschäftlichen Einsatz kann in Deutschland ein vollständiges Impressum Pflicht sein.

## Einrichtung (einmalig)

1. **Modpack wählen:** `.mrpack`-Datei hochladen oder den Pfad eingeben.
2. **Server-Ordner & Mods:** Ordner festlegen (Standard: `server` im Dashboard-Ordner) und auf
   „Mods herunterladen“ klicken. Jede Datei wird per sha1/sha512 geprüft.
   - Dateien mit `env.server = "unsupported"` werden nicht geladen.
   - Mods auf der Ausschlussliste (Standard: mapdistancefix, Geyser, Floodgate) werden nicht geladen.
   - Mods, die Modrinth als **reine Client-Mods** führt (z. B. Sodium, Iris, Minimaps), werden als
     `.jar.disabled` abgelegt. Viele Modpacks markieren alle Mods als `server: required`, auch diese.
     Ohne den Abgleich würde der Server oft gar nicht starten. Unter „Mods“ kannst du jede davon
     wieder einschalten.
   - `overrides/` (Konfigurationen, zusätzliche Mods) wird in den Server-Ordner kopiert.
3. **Java & NeoForge:** Java 21 wird geprüft, dann lädt das Dashboard den passenden NeoForge-Installer
   und führt `--installServer` aus.
4. **EULA:** Häkchen setzen und zustimmen.

Danach oben auf **Start** klicken. Der erste Start eines großen Modpacks dauert einige Minuten.

## Funktionen

| Bereich | Was es kann |
|---|---|
| Meine Server | Mehrere Server verwalten (Vanilla, Paper, Purpur, Fabric, NeoForge, Modpack), beliebige Minecraft-Version wählen, Version später wechseln, vorhandene Server-Ordner übernehmen |
| Plugins & Mods | Je nach Typ Plugins (Paper, Purpur) oder Mods: Modrinth-Suche, Empfehlungen, Drag & Drop, Updates mit einem Klick |
| Dateien | Dateimanager im Server-Ordner: ansehen, bearbeiten, hochladen, herunterladen, löschen |
| Automatik | Zeitplan (Neustart, Backup, Nachrichten, Befehle), Neustart nach Absturz, Auto-Stopp bei leerem Server, Discord-Benachrichtigungen |
| Cloud | Einstellungen, Konfigurationen und auf Wunsch das Welt-Backup in einen synchronisierten Ordner (OneDrive, Google Drive, Dropbox) sichern und auf anderen PCs wieder holen |
| Übersicht | Großer Startknopf, Laufzeit, Server-Tempo (TPS), RAM- und Spieler-Verlauf, Serverliste-Vorschau mit MOTD und Server-Icon, Spieler mit Köpfen, Aktivitäts-Feed, Mini-Terminal, Schnellaktionen (Tag/Nacht/Wetter …), Welt- und Speicher-Infos |
| Spieler | Köpfe, Kicken, Bannen, OP geben/entziehen, Whitelist |
| Konsole | Filter (Chat, Warnungen, Fehler) und Suche |
| Befehlspalette | `Strg+K` öffnet eine Suche für alle Aktionen und Befehle |
| Mods hinzufügen | JAR-Dateien per Drag & Drop oder Modrinth-Suche mit Ein-Klick-Installation (inkl. benötigter Zusatz-Mods) |
| Mods verbessern | Ein Knopf prüft alle Mods bei Modrinth und schaltet reine Client-Mods und Ausschlussliste ab (mit Vorschau). Mod-Logos stammen auch von Modrinth |
| Bedrock | Geyser + Floodgate installieren, Bedrock-Spieler ohne Java-Account zulassen |
| Backups | Auch automatisch alle X Stunden, die letzten N automatischen Backups bleiben erhalten |
| Server & Konsole | Start, sauberer Stopp (`stop`), Neustart, Live-Konsole mit Befehlseingabe, Crash-Hilfe mit „Diese Mod deaktivieren“ |
| Mods | Ausschlussliste bearbeiten, Mods per Häkchen ein-/ausschalten (`.jar` ↔ `.jar.disabled`) |
| Einstellungen | RAM (Xms/Xmx), wichtigste Felder der `server.properties`, komplette Datei als Text |
| Spieler | Online-Liste, Whitelist und OPs bearbeiten |
| Freunde einladen | Lokale IP, Anleitung zur Portfreigabe (25565), Alternativen playit.gg und Tailscale |
| Backups | „Welt sichern“ als ZIP mit Zeitstempel in `<Server-Ordner>/backups`, Wiederherstellen, Löschen |

## Ordner

- `data/`: Einstellungen des Dashboards (`config.json`) und das entpackte Modpack
- `server/`: der Minecraft-Server (wenn kein anderer Ordner gewählt wurde)

## Sicherheit

- Standardmäßig hört das Dashboard auf diesem PC **und** über die IP-Adresse des Rechners. Ohne Zugangspasswort kann dann jeder im Netzwerk deine Server steuern. Setze unter „Netzwerk & Betrieb“ ein Passwort oder stelle auf „Nur dieser PC“ (dann hört es nur auf `127.0.0.1`).
- Einstellungen zu Netzwerk und HTTPS lassen sich von anderen Geräten nur ändern, wenn ein Zugangspasswort gesetzt ist und man damit angemeldet ist. Auf einem Server ohne Oberfläche setzt du das Passwort in der Konsole mit `node set-password.js`.
- Anfragen von fremden Webseiten (anderer `Origin`/`Host`) werden abgelehnt.
- Alle Dateizugriffe sind auf den Server-Ordner beschränkt (Schutz gegen Path Traversal).
- Downloads aus dem Modpack sind nur von den Modrinth-erlaubten Adressen möglich
  (cdn.modrinth.com, github.com, raw.githubusercontent.com, gitlab.com) und werden per Prüfsumme geprüft.

## Probleme?

- **„Port 3000 ist schon belegt“:** Das Dashboard läuft schon. Einfach `http://localhost:3000` öffnen.
- **„Java 21 fehlt“:** Temurin 21 installieren und in Schritt 3 auf „Erneut prüfen“ klicken.
- **Server stürzt beim Start ab:** Unter „Server & Konsole“ zeigt die Crash-Hilfe die fehlerhafte Mod
  mit einem Knopf zum Deaktivieren.
