# Renders assets/cover.html to assets/cover.png (1280 x 640) with Microsoft Edge in headless mode.
# Usage: powershell -ExecutionPolicy Bypass -File tools\make-cover.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$html = Join-Path $root 'assets\cover.html'
$png = Join-Path $root 'assets\cover.png'
$edge = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { throw 'Microsoft Edge was not found.' }
$url = 'file:///' + ($html -replace '\\', '/')
& $edge --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 `
  --window-size=1280,640 --allow-file-access-from-files --screenshot="$png" $url | Out-Null
Start-Sleep -Milliseconds 500
if (-not (Test-Path $png)) { throw 'Edge did not write the picture.' }
Write-Output "Wrote $png"
