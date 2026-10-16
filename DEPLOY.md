# Als Website betreiben (Mehrbenutzer-Modus)

Mit `HOSTED=1` wird aus dem lokalen Dashboard eine Seite für mehrere Benutzer: Anmeldung (E-Mail oder Google),
getrennte Server pro Benutzer, ein eigener Port pro Server, Kontingente und ein Admin-Bereich.
Ohne `HOSTED=1` bleibt alles wie bisher (nur lokal, ohne Anmeldung).

> **Ehrlicher Stand:** Der Mehrbenutzer-Modus wurde auf Windows mit einer Testinstanz geprüft (Anmeldung, Trennung der
> Benutzer, Ports, Kontingente, RAM-Budget, zwei gleichzeitig laufende Server). **Auf Linux und mit echtem Google-Login
> wurde er noch nicht getestet** (die Google-Anmeldung lief nur gegen einen Nachbau). Plane einen Probelauf mit ein paar
> Freunden, bevor du Fremde einlädst.

## Was du brauchst

- Einen **Linux-Server (VPS)**, z. B. Ubuntu 24.04 mit mindestens 8 GB RAM, 4 vCPU und 100 GB SSD. Wichtig: feste IPv4-Adresse
  und freie eingehende Ports (nicht jeder Anbieter erlaubt das).
- Eine **Domain** (z. B. `local-server-hosting.de`) mit einem A-Record auf die IP des Servers.
- Optional einen **Google-OAuth-Client** für „Mit Google anmelden“.

Grober Preis: VPS mit 8 GB etwa 15–25 € im Monat, Domain 3–10 € im Jahr.

## 1. Server vorbereiten (Ubuntu)

```bash
sudo apt update && sudo apt install -y nodejs npm openjdk-21-jre-headless caddy ufw
node -v    # mindestens 20
```

Sehr neue Minecraft-Versionen (26.x) brauchen Java 25. Installiere es zusätzlich (z. B. Temurin 25 von adoptium.net nach
`/opt/`); das Dashboard findet Java unter `/usr/lib/jvm`, `/opt` und `~/.sdkman`. Alternativ setzt du `JAVA_HOME` auf das passende JDK.

Eigenen Benutzer anlegen (nie als root laufen lassen):

```bash
sudo adduser --disabled-password --gecos "" mcdash
sudo -u mcdash -i
# Dashboard-Ordner nach ~/dashboard kopieren, dann:
cd ~/dashboard && npm install --omit=dev
```

## 2. Konfiguration

Datei `/etc/mcdash.env` (nur für root lesbar: `sudo chmod 600 /etc/mcdash.env`):

```ini
HOSTED=1
PORT=3000
BIND=127.0.0.1
TRUST_PROXY=1
HOSTED_PUBLIC_URL=https://local-server-hosting.de
# Adresse, die Spieler eintippen (Standard: Host aus HOSTED_PUBLIC_URL)
# HOSTED_PUBLIC_HOST=play.local-server-hosting.de
# Gesamt-RAM für alle Minecraft-Server (Standard: RAM der Maschine minus Reserve)
# HOSTED_TOTAL_RAM_GB=24
# Wer sich mit einer dieser (von Google bestätigten) Adressen anmeldet, wird Administrator
HOSTED_ADMIN_EMAILS=du@example.com
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
# Optional: Orte für Daten und Server
# DASHBOARD_DATA_DIR=/var/lib/mcdash/data
# DASHBOARD_SERVERS_DIR=/var/lib/mcdash/servers
```

Der **erste registrierte Benutzer** wird automatisch Administrator. Registriere dich deshalb direkt nach dem Start selbst.

### Google-Anmeldung einrichten

1. <https://console.cloud.google.com> → Projekt anlegen → „APIs & Dienste“ → „OAuth-Zustimmungsbildschirm“ (extern, App-Name, Support-E-Mail).
2. „Anmeldedaten“ → „OAuth-Client-ID erstellen“ → Typ **Webanwendung**.
3. Bei „Autorisierte Weiterleitungs-URIs“ eintragen: `https://local-server-hosting.de/auth/google/callback`
   (genau `HOSTED_PUBLIC_URL` + `/auth/google/callback`).
4. Client-ID und -Secret in `/etc/mcdash.env` eintragen. Ohne beide Werte ist der Google-Knopf ausgeblendet.

Angefragt werden nur Name und E-Mail-Adresse. Die Adresse muss von Google als bestätigt gemeldet werden.

## 3. Dienst (systemd)

`/etc/systemd/system/mcdash.service`:

```ini
[Unit]
Description=Minecraft Server-Dashboard
After=network.target

[Service]
User=mcdash
WorkingDirectory=/home/mcdash/dashboard
EnvironmentFile=/etc/mcdash.env
ExecStart=/usr/bin/node server.js
Restart=on-failure
# Beim Stoppen bekommen die Minecraft-Server Zeit zum Speichern
TimeoutStopSec=90
KillMode=mixed
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now mcdash
journalctl -u mcdash -f
```

## 4. HTTPS mit Caddy

`/etc/caddy/Caddyfile`:

```
local-server-hosting.de {
    reverse_proxy 127.0.0.1:3000
}
```

Dann `sudo systemctl reload caddy`. Caddy holt und erneuert das Zertifikat selbst. Das Dashboard hört nur auf `127.0.0.1`;
von außen ist es ausschließlich über HTTPS erreichbar.

## 5. Firewall

Java (TCP) 25565–25664 und Bedrock (UDP) 19132–19231. Jeder Server bekommt automatisch einen Port aus diesen Bereichen.

```bash
sudo ufw default deny incoming && sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80,443/tcp
sudo ufw allow 25565:25664/tcp
sudo ufw allow 19132:19231/udp
sudo ufw enable
```

Die Portbereiche stehen in `data/hosted.json` (`portRange`, `bedrockPortRange`), falls du sie ändern willst.

## 6. Sicherheit – was das System kann und was nicht

Eingebaut:

- Passwörter mit scrypt, Sitzungen als gehashte Token (HttpOnly, SameSite=Lax, bei HTTPS Secure), 14 Tage gleitend.
- Begrenzung falscher Anmeldeversuche (pro Konto und pro Adresse), begrenzte Registrierungen.
- Google-Anmeldung mit State und PKCE. Ein per Passwort „vorbereitetes“ Konto wird beim ersten Google-Login entwertet.
- Schutz gegen fremde Webseiten (Origin-Prüfung), Sicherheits-Header, Content-Security-Policy.
- Jeder Benutzer sieht und ändert nur seine eigenen Server. Dateizugriffe sind auf den Server-Ordner begrenzt.
- Kontingente (Anzahl Server, RAM pro Server, Speicherplatz), gemeinsames RAM-Budget, Admin-Funktionen nur für Admins.

**Nicht eingebaut – bitte bedenken:**

- **Alle Minecraft-Server laufen unter demselben Linux-Benutzer.** Wer über ein Plugin oder eine Mod Code ausführen kann,
  kann theoretisch auf Dateien anderer Benutzer zugreifen. Plugins und Mods sind Fremdcode. Für Fremde auf deiner Seite
  ist das ein echtes Risiko. Sicherer wäre ein Container oder ein eigener Linux-Benutzer pro Server (nicht enthalten).
  Nutze die Seite zunächst nur mit Leuten, denen du vertraust, oder schließe die Registrierung im Admin-Bereich.
- Keine E-Mail-Bestätigung bei der Registrierung mit Passwort (es gibt keinen E-Mail-Versand).
- Kein Schutz gegen DDoS-Angriffe auf die Minecraft-Ports. Das kann nur der Hosting-Anbieter.
- Keine Abrechnung und keine Bezahlfunktion.

## 7. Rechtliches (kurz, keine Rechtsberatung)

- Eine öffentliche Seite in Deutschland braucht ein **Impressum** und eine **Datenschutzerklärung** (du speicherst E-Mail-Adressen,
  Namen und IP-Adressen in Logs). Verlinke beides, bevor du die Seite öffentlich machst. Das ist noch nicht eingebaut.
- Minecraft-Server anzubieten ist erlaubt. **Geld dafür zu nehmen oder Vorteile zu verkaufen** unterliegt den Regeln von
  Mojang (Richtlinien für kommerzielle Server, EULA). Lies sie vorher: <https://www.minecraft.net/de-de/usage-guidelines>.
- Jeder Benutzer stimmt beim Anlegen eines Servers der Minecraft-EULA zu. Das Dashboard fragt danach.

## 8. Betrieb

- **Updates:** Dashboard-Ordner aktualisieren, `npm install --omit=dev`, `sudo systemctl restart mcdash`.
- **Sicherung durch dich als Betreiber:** `data/` (Benutzer, Sitzungen, Einstellungen) und `servers/` regelmäßig sichern.
- **Logs:** `journalctl -u mcdash`.
- **Benutzer verwalten:** Reiter „Benutzer“ (nur Admins): sperren, Kontingente ändern, löschen, Registrierung schließen.
