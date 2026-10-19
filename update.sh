#!/usr/bin/env bash
# Holt die neueste Version von GitHub. Der Ordner data/ (alle Einstellungen) wird dabei nicht angefasst.
cd "$(dirname "$0")" || exit 1

if ! command -v git >/dev/null 2>&1 || [ ! -d .git ]; then
  echo "Dieser Ordner ist kein Git-Ordner (oder Git fehlt)."
  echo "Bei einer ZIP-Datei: neue Version herunterladen und den Ordner data/ aus dem alten Programmordner in den neuen kopieren."
  exit 1
fi

echo "Hole die neueste Version von GitHub ... (Einstellungen in data/ bleiben unberührt)"
git pull --ff-only || { echo "Update nicht möglich (lokale Änderungen am Programmcode?). Deine Einstellungen sind unverändert."; exit 1; }
npm install --omit=dev
echo
echo "Fertig. Starte das Dashboard neu (./start.sh oder: sudo systemctl restart mcdash), damit die neue Version läuft."
