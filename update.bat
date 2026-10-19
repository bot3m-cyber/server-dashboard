@echo off
chcp 65001 >nul
title Server-Dashboard aktualisieren
cd /d "%~dp0"

where git >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Git wurde nicht gefunden. Installiere Git von https://git-scm.com oder lade die neue Version als ZIP herunter.
  echo  Wichtig bei ZIP: Kopiere den Ordner "data" aus dem alten Programmordner in den neuen. Dort liegen alle deine Einstellungen.
  echo.
  pause
  exit /b 1
)
if not exist ".git" (
  echo.
  echo  Dieser Ordner ist kein Git-Ordner ^(er wurde als ZIP heruntergeladen^).
  echo  Lade die neue Version als ZIP herunter und kopiere den Ordner "data" aus dem alten Programmordner in den neuen.
  echo.
  pause
  exit /b 1
)

echo  Hole die neueste Version von GitHub ... Deine Einstellungen im Ordner "data" bleiben unberuehrt.
git pull --ff-only
if errorlevel 1 (
  echo.
  echo  Das Update war nicht moeglich ^(lokale Aenderungen am Programmcode?^). Deine Einstellungen sind unveraendert.
  pause
  exit /b 1
)
call npm install --omit=dev
echo.
echo  Fertig. Starte das Dashboard neu ^(start.bat^), damit die neue Version laeuft.
pause
