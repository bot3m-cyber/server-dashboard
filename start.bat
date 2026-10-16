@echo off
chcp 65001 >nul
title Minecraft Server-Dashboard
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js wurde nicht gefunden.
  echo  Bitte die LTS-Version von https://nodejs.org installieren und start.bat erneut ausfuehren.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\express" (
  echo  Erster Start: Benoetigte Pakete werden installiert ...
  call npm install --omit=dev
  if errorlevel 1 (
    echo.
    echo  "npm install" ist fehlgeschlagen. Bitte Internetverbindung pruefen.
    pause
    exit /b 1
  )
)

echo.
echo  Das Dashboard laeuft unter http://localhost:3000
echo  Dieses Fenster offen lassen. Zum Beenden: erst den Minecraft-Server stoppen, dann Strg+C.
echo.
node server.js --open
pause
