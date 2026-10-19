#!/usr/bin/env bash
# Richtet das Dashboard als systemd-Dienst ein (Debian, Ubuntu und andere Systeme mit systemd).
# Der Dienst startet mit dem Rechner, startet nach einem Absturz von selbst neu und stoppt beim Herunterfahren
# die Minecraft-Server sauber (die Welt wird gespeichert).
#
#   sudo ./install-service.sh                  einrichten und starten
#   sudo ./install-service.sh --user NAME      unter diesem Benutzer laufen lassen
#   sudo ./install-service.sh --name NAME      anderer Dienstname (Standard: mcdash)
#   sudo ./install-service.sh --yes            keine Rückfragen
#   ./install-service.sh --dry-run             nur anzeigen, was passieren würde
#   sudo ./install-service.sh --uninstall      Dienst wieder entfernen (Daten bleiben)

main() {
  set -u
  local NAME="mcdash" RUN_USER="" YES=0 DRY=0 UNINSTALL=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --user) RUN_USER="${2:-}"; shift 2 ;;
      --name) NAME="${2:-}"; shift 2 ;;
      --yes|-y) YES=1; shift ;;
      --dry-run) DRY=1; shift ;;
      --uninstall) UNINSTALL=1; shift ;;
      -h|--help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; return 0 ;;
      *) echo "Unbekannte Option: $1 (siehe --help)"; return 1 ;;
    esac
  done
  case "$NAME" in *[!A-Za-z0-9_.@-]*|"") echo "Ungültiger Dienstname."; return 1 ;; esac

  local DIR UNIT
  DIR="$(cd "$(dirname "$0")" && pwd)"
  UNIT="/etc/systemd/system/${NAME}.service"

  if [ "$DRY" -eq 0 ]; then
    if [ "$(id -u)" -ne 0 ]; then echo "Bitte mit sudo ausführen:  sudo ./install-service.sh"; return 1; fi
    command -v systemctl >/dev/null 2>&1 || { echo "systemd (systemctl) wurde nicht gefunden. Dieses Skript ist für Debian/Ubuntu mit systemd gedacht."; return 1; }
  fi

  if [ "$UNINSTALL" -eq 1 ]; then
    echo "Entferne den Dienst ${NAME} ..."
    if [ "$DRY" -eq 1 ]; then echo "(Testlauf) systemctl disable --now ${NAME}; rm ${UNIT}"; return 0; fi
    systemctl disable --now "$NAME" 2>/dev/null
    rm -f "$UNIT"
    systemctl daemon-reload
    echo "Fertig. Deine Daten (data/, servers/) sind unverändert."
    return 0
  fi

  # Node.js
  local NODE
  NODE="$(command -v node || true)"
  if [ -z "$NODE" ]; then
    echo "Node.js wurde nicht gefunden. Installiere Version 20 oder neuer (Anleitung: DAUERBETRIEB.md, Abschnitt Linux)."; [ "$DRY" -eq 1 ] && NODE="/usr/bin/node" || return 1
  fi
  local MAJOR
  MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "${MAJOR:-0}" -lt 20 ] && [ "$DRY" -eq 0 ]; then
    echo "Node.js $("$NODE" -v) ist zu alt. Das Dashboard braucht Version 20 oder neuer (Anleitung: DAUERBETRIEB.md)."; return 1
  fi
  [ -d "$DIR/node_modules/express" ] || echo "Hinweis: Im Ordner fehlen noch die Pakete. Führe vorher aus:  cd $DIR && npm install --omit=dev"

  # Benutzer: nicht als root laufen lassen
  local OWNER
  OWNER="$(stat -c %U "$DIR" 2>/dev/null || echo root)"
  if [ -z "$RUN_USER" ]; then
    if [ "$OWNER" != "root" ]; then RUN_USER="$OWNER"; else RUN_USER="$NAME"; fi
  fi
  local CREATE_USER=0
  if ! id "$RUN_USER" >/dev/null 2>&1; then CREATE_USER=1; fi

  echo "Dienst:        ${NAME}"
  echo "Programmordner: ${DIR}"
  echo "Läuft als:      ${RUN_USER}$([ "$CREATE_USER" -eq 1 ] && echo ' (wird neu angelegt)')"
  echo "Node.js:        ${NODE} ($("$NODE" -v 2>/dev/null))"
  if [ "$RUN_USER" = "root" ]; then echo "Warnung: Als root zu laufen ist unsicher. Besser ein eigener Benutzer (Standard)."; fi
  if [ "$(stat -c %U "$DIR" 2>/dev/null)" != "$RUN_USER" ]; then echo "Der Ordner ${DIR} wird dafür an ${RUN_USER} übergeben (chown)."; fi

  local TXT
  TXT="[Unit]
Description=Minecraft Server-Dashboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${DIR}
ExecStart=\"${NODE}\" server.js
Restart=always
RestartSec=5
# Beim Stoppen bekommen die Minecraft-Server Zeit zum Speichern
KillSignal=SIGTERM
TimeoutStopSec=120
KillMode=mixed
# Erlaubt Port 80 und 443 für HTTPS (Let's Encrypt im Dashboard)
AmbientCapabilities=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
Environment=NODE_ENV=production
EnvironmentFile=-/etc/${NAME}.env

[Install]
WantedBy=multi-user.target"

  if [ "$DRY" -eq 1 ]; then
    echo; echo "--- ${UNIT} (Testlauf, es wird nichts geschrieben) ---"; echo "$TXT"; return 0
  fi
  if [ "$YES" -eq 0 ]; then
    printf "Fortfahren? [j/N] "; read -r a; case "$a" in j|J|y|Y) ;; *) echo "Abgebrochen."; return 1 ;; esac
  fi

  if [ "$CREATE_USER" -eq 1 ]; then
    adduser --system --group --home "/var/lib/${RUN_USER}" --shell /usr/sbin/nologin "$RUN_USER" || { echo "Benutzer konnte nicht angelegt werden."; return 1; }
  fi
  chown -R "${RUN_USER}:" "$DIR" || { echo "chown fehlgeschlagen."; return 1; }
  printf '%s\n' "$TXT" > "$UNIT"
  systemctl daemon-reload
  systemctl enable --now "$NAME" || { echo "Der Dienst konnte nicht gestartet werden. Siehe:  journalctl -u ${NAME} -n 50"; return 1; }

  sleep 3
  if systemctl is-active --quiet "$NAME"; then
    echo; echo "Der Dienst läuft und startet ab jetzt mit dem Rechner."
  else
    echo; echo "Der Dienst läuft (noch) nicht. Siehe:  journalctl -u ${NAME} -n 50"; return 1
  fi
  echo "  Status:       systemctl status ${NAME}"
  echo "  Protokoll:    journalctl -u ${NAME} -f"
  echo "  Neu starten:  sudo systemctl restart ${NAME}"
  echo "  Dashboard:    http://localhost:3000   (Port und Zugriff stellst du im Dashboard unter „Netzwerk & Betrieb“ ein)"
  echo "  Passwort:     sudo -u ${RUN_USER} node ${DIR}/set-password.js"
}

main "$@"
exit $?
