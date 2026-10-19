# Dauerbetrieb: Dashboard als Dienst, Autostart und sicheres Herunterfahren

So läuft das Dashboard dauerhaft im Hintergrund, startet mit dem Rechner und bringt auf Wunsch den zuletzt
gelaufenen Minecraft-Server gleich wieder hoch, damit du nach einem Neustart direkt spielen kannst.

> **Ehrlicher Stand:** Die Skripte `install-service.sh` (Linux) und `install-autostart.ps1` (Windows) wurden auf
> Windows entwickelt. Das Erzeugen der systemd-Datei wurde dort nur im Testlauf geprüft (`--dry-run`), die echte
> Einrichtung als Dienst auf Debian/Ubuntu und die Aufgabe in der Windows-Aufgabenplanung wurden noch nicht
> ausgeführt. Der Autostart der Minecraft-Server nach einem (simulierten) Neustart wurde getestet.

## Autostart des Minecraft-Servers (Haken im Dashboard)

Im Reiter **Netzwerk & Betrieb → Dauerbetrieb und Autostart** gibt es den Schalter
**„Minecraft-Server nach einem Neustart automatisch starten“**.

- Das Dashboard merkt sich, welcher Server läuft. Startet es neu (Rechner neu gestartet, Dienst neu gestartet,
  Dashboard abgestürzt), startet es diesen Server von selbst wieder, etwa drei Sekunden nach dem Hochfahren.
- Einen Server, den du im Dashboard **bewusst stoppst**, startet es **nicht** wieder. Das gilt auch, wenn du
  ihn mit „Neustart“ im Dashboard neu startest: er läuft danach ja wieder.
- Im lokalen Modus läuft immer nur ein Server (der zuletzt gelaufene). Im Mehrbenutzer-Modus starten alle
  Server wieder, die liefen, innerhalb der RAM- und Server-Grenzen.
- Klappt der Start nicht (z. B. Java fehlt), steht der Grund in der Konsole des Servers, und das Dashboard
  versucht es beim nächsten Mal nicht erneut.

## Sicherheitsabfrage beim Stoppen und Neustarten

Klickst du im Dashboard auf **Stopp** oder **Neustart** (oben, auf der Übersicht oder über Strg+K), fragt es zuerst
nach und zeigt, welche Spieler gerade online sind. Der Haken „Nicht mehr fragen, wenn niemand online ist“ schaltet
die Abfrage nur für leere Server ab. Sind Spieler online, fragt es immer. Auch „Dashboard neu starten“ (Reiter
Netzwerk & Betrieb) fragt nach und ist gesperrt, solange ein Server läuft.

---

## Linux (Debian und Ubuntu)

### 1. Voraussetzungen installieren

```bash
sudo apt update
sudo apt install -y curl unzip ca-certificates
```

**Node.js 20 oder neuer.** Die Version aus den Debian-/Ubuntu-Quellen ist oft zu alt (`node -v` prüfen). Die aktuelle
LTS-Version bekommst du so (NodeSource):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v      # mindestens v20
```

**Java.** Für die meisten Minecraft-Versionen reicht Java 21, sehr neue (26.x) brauchen Java 25:

```bash
sudo apt install -y openjdk-21-jre-headless
java -version
```

Gibt es Java 25 nicht in deinen Paketquellen, lade Temurin 25 von <https://adoptium.net> (Linux, `.tar.gz`) und entpacke es
nach `/opt/` (z. B. `/opt/jdk-25`). Das Dashboard findet Java unter `/usr/lib/jvm`, `/opt` und `~/.sdkman`.

### 2. Dashboard herunterladen

```bash
sudo mkdir -p /opt && cd /opt
sudo curl -fsSL https://github.com/bot3m-cyber/server-dashboard/archive/refs/heads/main.zip -o dashboard.zip
sudo unzip -q dashboard.zip && sudo rm dashboard.zip       # entsteht: /opt/server-dashboard-main
cd /opt/server-dashboard-main && sudo npm install --omit=dev
```

### 3. Als Dienst einrichten (empfohlen)

```bash
cd /opt/server-dashboard-main
sudo ./install-service.sh
```

Das Skript zeigt vorher an, was es tut, und fragt nach. Es

- legt (falls nötig) den Benutzer `mcdash` an, damit nichts als root läuft, und übergibt ihm den Ordner,
- schreibt `/etc/systemd/system/mcdash.service`,
- schaltet den Dienst ein (**startet beim Hochfahren**) und startet ihn jetzt.

Optionen: `--user NAME` (anderer Benutzer), `--name NAME` (anderer Dienstname), `--yes` (ohne Rückfrage),
`--dry-run` (nur anzeigen), `--uninstall` (Dienst entfernen, Daten bleiben).

**Der Dienst:** startet nach einem Absturz nach 5 Sekunden neu (`Restart=always`). Beim Herunterfahren oder Stoppen
schickt systemd dem Dashboard ein Beenden-Signal, und das Dashboard stoppt vorher alle Minecraft-Server sauber
(Welt wird gespeichert). Dafür darf der Dienst bis zu 120 Sekunden brauchen (`TimeoutStopSec`).

Nützliche Befehle:

```bash
systemctl status mcdash            # läuft er?
journalctl -u mcdash -f            # Protokoll live
sudo systemctl restart mcdash      # neu starten (stoppt laufende Minecraft-Server vorher)
sudo systemctl stop mcdash         # anhalten
sudo systemctl disable mcdash      # nicht mehr mit dem Rechner starten
```

### 4. Zugriff und Passwort

Standardmäßig hört das Dashboard auf Port 3000, auch über die IP des Servers. **Setze ein Zugangspasswort**, bevor du
es erreichbar lässt:

```bash
sudo -u mcdash node /opt/server-dashboard-main/set-password.js
```

Alles Weitere (Domain, HTTPS, Mehrbenutzer, Port) stellst du im Dashboard unter **Netzwerk & Betrieb** ein. Offene Ports
in der Firewall (`ufw`): Dashboard 3000/tcp, Minecraft 25565/tcp (und 19132/udp für Bedrock), für HTTPS 80 und 443:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 3000/tcp
sudo ufw allow 25565/tcp
sudo ufw allow 19132/udp
sudo ufw enable
```

### 5. Updates

```bash
cd /opt/server-dashboard-main
sudo -u mcdash ./update.sh           # holt die neueste Version, data/ bleibt unberührt
sudo systemctl restart mcdash
```

### Ohne Dienst, von Hand

```bash
cd /opt/server-dashboard-main && ./start.sh        # im Vordergrund, endet mit Strg+C
```

Für „im Hintergrund, aber ohne systemd“ taugt `tmux`/`screen`. Für den Dauerbetrieb ist der Dienst die bessere Wahl.

---

## Windows

### Variante A: Autostart bei der Anmeldung (einfach)

Im Dashboard-Ordner doppelklicken: **`install-autostart.bat`**. Es legt in der Aufgabenplanung die Aufgabe
`Server-Dashboard` an. Das Dashboard startet danach bei jeder Anmeldung unsichtbar im Hintergrund, wird bei einem
Absturz neu gestartet, und die Ausgabe landet in `data\dashboard.log`.

```text
install-autostart.bat               einrichten
install-autostart.bat -Status       Status anzeigen
install-autostart.bat -Uninstall    entfernen
```

Ein Fenster brauchst du nicht offen zu halten. Zum Öffnen: <http://localhost:3000>.

> **Wichtig:** Windows beendet beim Herunterfahren alle Programme nach wenigen Sekunden. **Stoppe deine Minecraft-Server
> vorher im Dashboard**, damit die Welt gespeichert wird. Setzt du den Haken „nach einem Neustart automatisch starten“,
> läuft der Server nach der nächsten Anmeldung wieder an. Ohne Anmeldung (PC läuft nur hochgefahren am Anmeldebildschirm)
> startet diese Variante nichts.

### Variante B: echter Windows-Dienst (läuft ohne Anmeldung)

Mit dem Hilfsprogramm [NSSM](https://nssm.cc) läuft das Dashboard schon beim Hochfahren, auch ohne Anmeldung. In einer
Eingabeaufforderung **als Administrator**:

```text
nssm install ServerDashboard "C:\Program Files\nodejs\node.exe" server.js
nssm set ServerDashboard AppDirectory "C:\Pfad\zum\server-dashboard"
nssm set ServerDashboard AppStdout "C:\Pfad\zum\server-dashboard\data\dashboard.log"
nssm set ServerDashboard AppStderr "C:\Pfad\zum\server-dashboard\data\dashboard.log"
nssm set ServerDashboard AppStopMethodConsole 60000
nssm set ServerDashboard Start SERVICE_AUTO_START
nssm start ServerDashboard
```

Der Dienst läuft dann unter dem Konto „Lokales System“. Java muss für dieses Konto auffindbar sein (z. B. in
`C:\Program Files\Eclipse Adoptium\`). Die Auswahl des Kontos und weitere Einstellungen (Ordner `data\` bleibt wie er
ist) kannst du in `nssm edit ServerDashboard` ändern. Dieses Vorgehen ist hier nicht getestet.

### Variante C: Verknüpfung im Autostart-Ordner

`Win+R` → `shell:startup` → eine Verknüpfung auf `start.bat` hineinlegen. Das öffnet beim Anmelden ein Fenster, das
geöffnet bleiben muss.

### Updates

`update.bat` doppelklicken (holt die neueste Version, `data\` bleibt unberührt), danach das Dashboard neu starten
(Reiter Netzwerk & Betrieb → „Dashboard neu starten“, oder die Aufgabe neu starten).

---

## Wenn etwas nicht klappt

| Problem | Ursache und Lösung |
|---|---|
| Dienst startet nicht | `journalctl -u mcdash -n 50`. Häufig: Node.js zu alt (`node -v`), Pakete fehlen (`npm install --omit=dev`) oder Port 3000 belegt. |
| „Port 3000 ist schon belegt“ | Es läuft schon ein Dashboard (anderes Fenster, Dienst, Aufgabe). Nur eines starten. |
| Minecraft-Server startet nach dem Neustart nicht | Haken „automatisch starten“ gesetzt? Wurde der Server vor dem Herunterfahren bewusst gestoppt, bleibt er aus. Gründe stehen in der Konsole des Servers („Autostart nicht möglich: …“). |
| Zugriff verweigert von außen | Zugangspasswort setzen (`node set-password.js`), siehe README. |
| Ports unter 1024 (HTTPS) | Der Dienst bekommt `CAP_NET_BIND_SERVICE` automatisch. Von Hand: `sudo setcap 'cap_net_bind_service=+ep' $(readlink -f $(which node))`. |
