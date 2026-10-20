# Windows first-time setup (PowerShell). Run from the repo root:  powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "== Environment =="
$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) { Write-Error "python not found. Install Python 3.11/3.12 from https://www.python.org/downloads/ (tick 'Add to PATH')"; exit 1 }
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Write-Error "node not found. Install Node.js LTS from https://nodejs.org/"; exit 1 }
Write-Host ("python: " + (python --version) + "   node: " + (node --version))
if (Get-Command ffmpeg -ErrorAction SilentlyContinue) { Write-Host "ffmpeg: yes" } else { Write-Warning "ffmpeg missing (winget install Gyan.FFmpeg) - needed to decode microphone audio for STT" }

Write-Host "`n== Backend =="
Set-Location "$Root\backend"
if (-not (Test-Path ".venv")) { python -m venv .venv }
& ".venv\Scripts\python.exe" -m pip install -q --upgrade pip
& ".venv\Scripts\python.exe" -m pip install -q -e ".[dev]"
if ($env:WITH_STT -ne "0") { & ".venv\Scripts\python.exe" -m pip install -q -e ".[stt]" }
Write-Host "backend deps installed"

Write-Host "`n== Frontend =="
Set-Location "$Root\frontend"
npm install --no-audit --no-fund
Write-Host "frontend deps installed"

Write-Host "`n== Live2D assets =="
Set-Location $Root
$coreDir = "$Root\frontend\public\live2d\core"
New-Item -ItemType Directory -Force -Path $coreDir | Out-Null
$core = "$coreDir\live2dcubismcore.min.js"
if (-not (Test-Path $core)) {
  Write-Host "Downloading Live2D Cubism Core (proprietary runtime, not committed)..."
  try { Invoke-WebRequest -Uri "https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js" -OutFile $core }
  catch { Write-Warning "Could not download Cubism Core. Download the Cubism SDK for Web from https://www.live2d.com/sdk/download/web/ and copy Core\live2dcubismcore.min.js into $coreDir" }
}
python "$Root\scripts\download_live2d_sample.py" ($(if ($env:LIVE2D_SAMPLE) { $env:LIVE2D_SAMPLE } else { "Haru" }))

if (-not (Test-Path "$Root\.env")) { Copy-Item "$Root\.env.example" "$Root\.env"; Write-Host "Created .env - edit it and set LLM_API_KEY (Claude)." }
Write-Host "`nSetup complete. Start with:  powershell -ExecutionPolicy Bypass -File scripts\dev.ps1 start"
