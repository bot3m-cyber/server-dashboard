@echo off
chcp 65001 >nul
title Minecraft Server-Dashboard (Mehrbenutzer)
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js wurde nicht gefunden. Bitte https://nodejs.org installieren.
  pause
  exit /b 1
)

if not exist "node_modules\express" (
  call npm install --omit=dev
  if errorlevel 1 ( echo npm install ist fehlgeschlagen. & pause & exit /b 1 )
)

rem Eigene Ordner, damit der lokale Einzelnutzer-Modus (data\ und server\) unberuehrt bleibt
set HOSTED=1
set PORT=3100
set BIND=127.0.0.1
set HOSTED_PUBLIC_URL=http://localhost:3100
rem Mit Tunnel: Adresse als Argument angeben, z. B.  start-mehrbenutzer.bat https://irgendwas.trycloudflare.com
if not "%~1"=="" set HOSTED_PUBLIC_URL=%~1
if not "%~1"=="" set TRUST_PROXY=1
set DASHBOARD_DATA_DIR=%~dp0data-mehrbenutzer
set DASHBOARD_SERVERS_DIR=%~dp0servers-mehrbenutzer

echo.
echo  Mehrbenutzer-Modus: http://localhost:3100
echo  Das erste Konto, das du anlegst, wird Administrator.
echo  Fuer Zugriff aus dem Internet siehe DEPLOY.md.
echo.
node server.js --open
pause
