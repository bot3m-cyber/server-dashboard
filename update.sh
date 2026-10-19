#!/usr/bin/env bash
# Aktualisiert das Dashboard auf die neueste Version von GitHub.
#  - Git-Ordner:  git pull
#  - ZIP-Ordner:  lädt die neueste ZIP-Datei und ersetzt nur Programmdateien
# Deine Einstellungen (data/), Server (server/, servers/) und node_modules bleiben unberührt.
# Eigene Quelle: UPDATE_URL=https://github.com/<name>/<repo>/archive/refs/heads/main.zip ./update.sh

main() {
  cd "$(dirname "$0")" || exit 1
  local URL="${UPDATE_URL:-https://github.com/bot3m-cyber/server-dashboard/archive/refs/heads/main.zip}"

  if [ -d .git ] && command -v git >/dev/null 2>&1; then
    echo "Git-Ordner erkannt: hole die neueste Version ..."
    git pull --ff-only || { echo "Update nicht möglich (lokale Änderungen am Programmcode?). Deine Einstellungen sind unverändert."; return 1; }
  else
    echo "Kein Git-Ordner (ZIP-Installation): lade die neueste Version von GitHub ..."
    local tmp
    tmp="$(mktemp -d)" || return 1
    trap 'rm -rf "$tmp"' EXIT
    if command -v curl >/dev/null 2>&1; then
      curl -fsSL "$URL" -o "$tmp/new.zip" || { echo "Download fehlgeschlagen. Internetverbindung prüfen."; return 1; }
    elif command -v wget >/dev/null 2>&1; then
      wget -q "$URL" -O "$tmp/new.zip" || { echo "Download fehlgeschlagen. Internetverbindung prüfen."; return 1; }
    else
      echo "Weder curl noch wget gefunden. Installiere eines davon (z. B. sudo apt install curl)."; return 1
    fi
    if command -v unzip >/dev/null 2>&1; then
      unzip -q "$tmp/new.zip" -d "$tmp/x"; [ $? -le 1 ] || { echo "Entpacken fehlgeschlagen."; return 1; }
    elif command -v python3 >/dev/null 2>&1; then
      python3 -m zipfile -e "$tmp/new.zip" "$tmp/x" || { echo "Entpacken fehlgeschlagen."; return 1; }
    else
      echo "Zum Entpacken fehlt unzip (sudo apt install unzip)."; return 1
    fi
    local src
    src="$(find "$tmp/x" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
    if [ -z "$src" ] || [ ! -f "$src/server.js" ]; then echo "Die heruntergeladene Datei enthält kein Dashboard."; return 1; fi

    # Kleine Sicherung der Einstellungen (nur die .json-Dateien, keine Welten)
    if [ -d data ]; then
      local bk="data/config-backup/vor-update-$(date +%Y%m%d-%H%M%S)"
      mkdir -p "$bk" && cp -p data/*.json "$bk"/ 2>/dev/null
      echo "Einstellungen gesichert in $bk"
    fi

    # Programmordner ersetzen (enthalten nur Code), übrige Dateien im Hauptordner überschreiben
    rm -rf lib public
    cp -a "$src/lib" "$src/public" .
    for f in "$src"/* "$src"/.gitignore "$src"/.gitattributes; do
      [ -f "$f" ] || continue
      case "$(basename "$f")" in update.sh) continue ;; esac
      cp -f "$f" .
    done
    # update.sh zuletzt und über eine neue Datei, damit das laufende Skript nicht mitten im Lesen verändert wird
    cp -f "$src/update.sh" ./update.sh.neu && chmod +x ./update.sh.neu && mv -f ./update.sh.neu ./update.sh
    chmod +x ./*.sh 2>/dev/null
  fi

  if command -v npm >/dev/null 2>&1; then
    npm install --omit=dev || { echo "npm install ist fehlgeschlagen."; return 1; }
  else
    echo "npm wurde nicht gefunden. Bitte Node.js installieren und dann im Ordner 'npm install --omit=dev' ausführen."
  fi
  echo
  echo "Fertig. Deine Einstellungen (data/) und Server sind unverändert."
  echo "Starte das Dashboard neu, damit die neue Version läuft (./start.sh oder: sudo systemctl restart mcdash)."
}

main "$@"
exit $?
