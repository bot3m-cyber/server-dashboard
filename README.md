# Minecraft Server-Dashboard

Eine lokale Web-App, mit der du einen Minecraft-Modpack-Server (Modrinth-`.mrpack`, NeoForge) auf deinem
eigenen PC (Windows; Linux und macOS über `start.sh`) einrichtest und betreibst. Das Dashboard ist nur auf diesem PC erreichbar
(`http://localhost:3000`, es hört nur auf 127.0.0.1).

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

- Das Dashboard hört nur auf `127.0.0.1:3000`. Andere Geräte im Netz kommen nicht heran.
- Anfragen von fremden Webseiten (anderer `Origin`/`Host`) werden abgelehnt.
- Alle Dateizugriffe sind auf den Server-Ordner beschränkt (Schutz gegen Path Traversal).
- Downloads aus dem Modpack sind nur von den Modrinth-erlaubten Adressen möglich
  (cdn.modrinth.com, github.com, raw.githubusercontent.com, gitlab.com) und werden per Prüfsumme geprüft.

## Probleme?

- **„Port 3000 ist schon belegt“:** Das Dashboard läuft schon. Einfach `http://localhost:3000` öffnen.
- **„Java 21 fehlt“:** Temurin 21 installieren und in Schritt 3 auf „Erneut prüfen“ klicken.
- **Server stürzt beim Start ab:** Unter „Server & Konsole“ zeigt die Crash-Hilfe die fehlerhafte Mod
  mit einem Knopf zum Deaktivieren.
