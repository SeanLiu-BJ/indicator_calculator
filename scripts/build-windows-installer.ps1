param(
  [string]$PythonExecutable = "python"
)

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $PSScriptRoot
$DesktopDir = Join-Path $RootDir "desktop"
$FrontendDir = Join-Path $RootDir "frontend"

Write-Host "[win-installer] building backend executable"
if ($PythonExecutable) {
  powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "build-backend-exe.ps1") -PythonExecutable $PythonExecutable
} else {
  powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "build-backend-exe.ps1")
}

Write-Host "[win-installer] building frontend dist"
pnpm --dir $FrontendDir run build

Write-Host "[win-installer] packaging Windows installer"
npm --prefix $DesktopDir run build:win
