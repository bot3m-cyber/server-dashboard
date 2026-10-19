@echo off
chcp 65001 >nul
title Server-Dashboard aktualisieren
cd /d "%~dp0"
if "%UPDATE_URL%"=="" set "UPDATE_URL=https://github.com/bot3m-cyber/server-dashboard/archive/refs/heads/main.zip"

if exist ".git" (
  where git >nul 2>nul
  if not errorlevel 1 (
    echo  Git-Ordner erkannt: hole die neueste Version ...
    git pull --ff-only
    if errorlevel 1 (
      echo.
      echo  Das Update war nicht moeglich ^(lokale Aenderungen am Programmcode?^). Deine Einstellungen sind unveraendert.
      pause
      exit /b 1
    )
    goto :npm
  )
)

echo  Kein Git-Ordner ^(ZIP-Installation^): lade die neueste Version von GitHub ...
set "TMPD=%TEMP%\dashboard-update-%RANDOM%"
mkdir "%TMPD%" >nul 2>nul
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -Uri $env:UPDATE_URL -OutFile '%TMPD%\new.zip'; Expand-Archive -Path '%TMPD%\new.zip' -DestinationPath '%TMPD%\x' -Force } catch { Write-Host $_.Exception.Message; exit 1 }"
if errorlevel 1 (
  echo.
  echo  Download oder Entpacken fehlgeschlagen. Bitte die Internetverbindung pruefen.
  rmdir /s /q "%TMPD%" >nul 2>nul
  pause
  exit /b 1
)
set "SRC="
for /d %%D in ("%TMPD%\x\*") do set "SRC=%%D"
if not exist "%SRC%\server.js" (
  echo  Die heruntergeladene Datei enthaelt kein Dashboard.
  rmdir /s /q "%TMPD%" >nul 2>nul
  pause
  exit /b 1
)

rem Kleine Sicherung der Einstellungen (nur .json-Dateien)
if not exist "data" goto :nobackup
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "STAMP=%%i"
set "BK=data\config-backup\vor-update-%STAMP%"
mkdir "%BK%" >nul 2>nul
copy /y "data\*.json" "%BK%\" >nul 2>nul
echo  Einstellungen gesichert in %BK%
:nobackup

rem Programmdateien ersetzen. data, server, servers und node_modules bleiben unberuehrt.
rmdir /s /q lib >nul 2>nul
rmdir /s /q public >nul 2>nul
robocopy "%SRC%" "%CD%" /E /XD data data-mehrbenutzer server servers servers-mehrbenutzer node_modules /XF update.bat /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (
  echo  Beim Kopieren ist ein Fehler aufgetreten. Deine Einstellungen sind unveraendert.
  rmdir /s /q "%TMPD%" >nul 2>nul
  pause
  exit /b 1
)
rmdir /s /q "%TMPD%" >nul 2>nul

:npm
call npm install --omit=dev
echo.
echo  Fertig. Deine Einstellungen ^(data^) und Server sind unveraendert.
echo  Starte das Dashboard neu ^(start.bat^), damit die neue Version laeuft.
pause
