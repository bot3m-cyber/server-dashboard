#!/usr/bin/env bash
# Startet das Server-Dashboard (Linux / macOS). Einmalig ausführbar machen: chmod +x start.sh
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo
  echo " Node.js wurde nicht gefunden."
  echo " Bitte die LTS-Version von https://nodejs.org installieren (oder: sudo apt install nodejs npm) und start.sh erneut ausführen."
  echo
  exit 1
fi

if [ ! -d node_modules/express ]; then
  echo " Erster Start: Benötigte Pakete werden installiert ..."
  npm install --omit=dev || { echo " npm install ist fehlgeschlagen. Bitte Internetverbindung prüfen."; exit 1; }
fi

echo
echo " Das Dashboard läuft unter http://localhost:${PORT:-3000}"
echo " Dieses Terminal offen lassen. Zum Beenden: erst den Minecraft-Server stoppen, dann Strg+C."
echo
exec node server.js --open
