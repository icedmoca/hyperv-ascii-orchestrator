# Hyper-V Dashboard — starts Node; optional Administrator elevation (recommended).
$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -LiteralPath $MyInvocation.MyCommand.Path
Set-Location $scriptDir

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js is required: https://nodejs.org"
    exit 1
}

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
$noElevate = $args -contains '-NoElevate' -or $args -contains '/NoElevate'

if (-not $isAdmin -and -not $noElevate) {
    Write-Host "Requesting Administrator (UAC)... Or: .\start.ps1 -NoElevate  |  Or use Credentials in the UI." -ForegroundColor Yellow
    $psExe = Join-Path $PSHOME 'powershell.exe'
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $MyInvocation.MyCommand.Path, '-Elevated')
    Start-Process -FilePath $psExe -Verb RunAs -ArgumentList $argList -Wait
    exit 0
}

if ($args -contains '-Elevated') {
    Write-Host "Running elevated." -ForegroundColor Green
}

$port = if ($env:PORT) { $env:PORT } else { 3780 }
Write-Host "Hyper-V Dashboard: http://127.0.0.1:$port" -ForegroundColor Green
Write-Host "If you still see permission errors, use Credentials in the UI (account in Hyper-V Administrators)." -ForegroundColor Gray
Write-Host "Ctrl+C to stop." -ForegroundColor DarkGray
& node server/index.js
