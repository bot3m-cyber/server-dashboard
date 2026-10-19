# Richtet den Autostart des Dashboards unter Windows ein (Aufgabenplanung).
# Das Dashboard startet unsichtbar im Hintergrund, sobald du dich anmeldest, und wird bei einem Absturz neu gestartet.
# Protokoll: data\dashboard.log
#
#   install-autostart.bat              einrichten
#   install-autostart.bat -Uninstall   wieder entfernen
#   install-autostart.bat -Status      anzeigen, ob die Aufgabe eingerichtet ist und läuft
param(
  [switch]$Uninstall,
  [switch]$Status,
  [string]$TaskName = 'Server-Dashboard'
)
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path

if ($Status) {
  $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $t) { Write-Host "Die Aufgabe '$TaskName' ist nicht eingerichtet."; exit 0 }
  $i = Get-ScheduledTaskInfo -TaskName $TaskName
  Write-Host "Aufgabe '$TaskName': Status $($t.State), letzter Lauf $($i.LastRunTime), Ergebnis $($i.LastTaskResult)"
  try { $r = Invoke-WebRequest -UseBasicParsing http://localhost:3000/api/system/ping -TimeoutSec 4; Write-Host "Das Dashboard antwortet auf http://localhost:3000" } catch { Write-Host "Das Dashboard antwortet (noch) nicht auf Port 3000." }
  exit 0
}

if ($Uninstall) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Der Autostart wurde entfernt. Ein gerade laufendes Dashboard bleibt an, deine Daten sind unverändert."
  } else { Write-Host "Es gibt keinen Autostart '$TaskName'." }
  exit 0
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Write-Host 'Node.js wurde nicht gefunden. Bitte von https://nodejs.org installieren (LTS) und dann erneut ausführen.'; exit 1 }
if (-not (Test-Path (Join-Path $dir 'node_modules\express'))) {
  Write-Host 'Erster Start: Pakete werden installiert ...'
  Push-Location $dir; npm install --omit=dev; Pop-Location
}
New-Item -ItemType Directory -Force -Path (Join-Path $dir 'data') | Out-Null
$log = Join-Path $dir 'data\dashboard.log'

# Das Dashboard unsichtbar starten und die Ausgabe in eine Protokolldatei schreiben
$cmd = "Set-Location -LiteralPath '$dir'; & '$node' server.js *>> '$log'"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command `"$cmd`"" -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "Der Autostart '$TaskName' ist eingerichtet: Das Dashboard startet ab jetzt bei jeder Anmeldung unsichtbar im Hintergrund."
Write-Host "Protokoll: $log"
Write-Host ''
Write-Host 'Wichtig: Stoppe deine Minecraft-Server im Dashboard, bevor du den PC herunterfährst, damit die Welt sauber gespeichert wird.'
Write-Host 'Mit dem Haken „Minecraft-Server nach einem Neustart automatisch starten“ (Reiter Netzwerk & Betrieb) läuft der Server nach dem Anmelden wieder an.'
$answer = Read-Host 'Das Dashboard jetzt auch gleich starten? [j/N]'
if ($answer -match '^[jJyY]') { Start-ScheduledTask -TaskName $TaskName; Write-Host 'Gestartet. In ein paar Sekunden erreichbar unter http://localhost:3000' }
