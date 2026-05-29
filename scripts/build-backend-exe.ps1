param(
  [string]$PythonExecutable = ""
)

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $PSScriptRoot
$OutputDir = Join-Path $RootDir "desktop/dist/win-build/backend-runtime"
$WorkDir = Join-Path $RootDir "desktop/dist/win-build/pyinstaller-work"
$SpecDir = Join-Path $RootDir "desktop/dist/win-build/spec"
$EntryFile = Join-Path $RootDir "backend/app/windows_entry.py"
$SampleDir = Join-Path $RootDir "backend/sample"

if (-not $PythonExecutable) {
  $Candidates = @(
    (Join-Path $RootDir ".venv/Scripts/python.exe"),
    (Join-Path $RootDir "backend/.venv/Scripts/python.exe"),
    "python"
  )
  foreach ($candidate in $Candidates) {
    if ($candidate -eq "python") {
      $PythonExecutable = $candidate
      break
    }
    if (Test-Path $candidate) {
      $PythonExecutable = $candidate
      break
    }
  }
}

if (-not $PythonExecutable) {
  throw "No Python executable found for backend packaging."
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
New-Item -ItemType Directory -Force -Path $SpecDir | Out-Null

& $PythonExecutable -m pip install --upgrade pip
& $PythonExecutable -m pip install -r (Join-Path $RootDir "backend/requirements.txt")
& $PythonExecutable -m pip install pyinstaller

& $PythonExecutable -m PyInstaller `
  --noconfirm `
  --clean `
  --onefile `
  --name indicator_backend `
  --distpath $OutputDir `
  --workpath $WorkDir `
  --specpath $SpecDir `
  --paths $RootDir `
  --add-data "${SampleDir};backend/sample" `
  --hidden-import uvicorn.logging `
  --hidden-import uvicorn.loops.auto `
  --hidden-import uvicorn.protocols.http.auto `
  --hidden-import uvicorn.protocols.websockets.auto `
  --hidden-import uvicorn.lifespan.on `
  --hidden-import multipart `
  --hidden-import aiofiles `
  $EntryFile

Write-Host "[backend-exe] output ready at $OutputDir"
