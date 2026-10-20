# Windows dev launcher (PowerShell):  scripts\dev.ps1 start | stop | status | logs
param([ValidateSet("start","stop","status","logs","restart")][string]$Cmd = "start")
$Root = Split-Path -Parent $PSScriptRoot
$Run = "$Root\.run"; New-Item -ItemType Directory -Force -Path $Run | Out-Null
$BackendPort = 8000; $FrontendPort = 5173
if (Test-Path "$Root\.env") {
  Get-Content "$Root\.env" | Where-Object { $_ -match '^\s*[^#].*=' } | ForEach-Object {
    $k, $v = $_ -split '=', 2; $k = $k.Trim(); $v = $v.Trim()
    if ($k -eq "BACKEND_PORT") { $BackendPort = [int]$v }
    if ($k -eq "FRONTEND_PORT") { $FrontendPort = [int]$v }
  }
}
function Get-Proc($name) { if (Test-Path "$Run\$name.pid") { $p = Get-Process -Id (Get-Content "$Run\$name.pid") -ErrorAction SilentlyContinue; if ($p) { return $p } } return $null }
function Start-All {
  if (-not (Get-Proc backend)) {
    $p = Start-Process -FilePath "$Root\backend\.venv\Scripts\python.exe" -ArgumentList "-m uvicorn app.main:app --host 127.0.0.1 --port $BackendPort" -WorkingDirectory "$Root\backend" -RedirectStandardOutput "$Run\backend.log" -RedirectStandardError "$Run\backend.err.log" -PassThru -WindowStyle Hidden
    $p.Id | Set-Content "$Run\backend.pid"; Write-Host "backend  -> http://127.0.0.1:$BackendPort  (log: .run\backend.log)"
  } else { Write-Host "backend already running" }
  if (-not (Get-Proc frontend)) {
    $env:VITE_BACKEND_URL = "http://127.0.0.1:$BackendPort"
    $p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm run dev -- --port $FrontendPort" -WorkingDirectory "$Root\frontend" -RedirectStandardOutput "$Run\frontend.log" -RedirectStandardError "$Run\frontend.err.log" -PassThru -WindowStyle Hidden
    $p.Id | Set-Content "$Run\frontend.pid"; Write-Host "frontend -> http://localhost:$FrontendPort  (log: .run\frontend.log)"
  } else { Write-Host "frontend already running" }
  Write-Host "`nOpen http://localhost:$FrontendPort   -   stop with: scripts\dev.ps1 stop"
}
function Stop-One($name) {
  $p = Get-Proc $name
  if ($p) { taskkill /PID $p.Id /T /F | Out-Null; Write-Host "stopped $name (pid $($p.Id))" }
  Remove-Item "$Run\$name.pid" -ErrorAction SilentlyContinue
}
switch ($Cmd) {
  "start"   { Start-All }
  "stop"    { Stop-One frontend; Stop-One backend }
  "restart" { Stop-One frontend; Stop-One backend; Start-All }
  "status"  { foreach ($n in "backend","frontend") { if (Get-Proc $n) { Write-Host "$n: running" } else { Write-Host "$n: stopped" } } }
  "logs"    { Get-Content "$Run\backend.log","$Run\frontend.log" -Tail 40 -Wait }
}
