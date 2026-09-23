<#
Sets octopod up from a clone on Windows: dependencies and the `octopod` command on your
PATH, then `octopod setup` — Docker checked, the shared edge started. Safe to run again
(after a pull, for instance). Needs no admin. Docker Desktop must be running.

  .\setup.ps1                        # puts the command in ~\.local\bin
  .\setup.ps1 -NoEdge                # ... without starting the edge
  .\setup.ps1 -NoTray                # ... without the tray icon and its Start menu shortcut
  $env:BIN_DIR="$HOME\bin"; .\setup.ps1   # ... or elsewhere

The command runs the sources: a change to the code needs no new setup. Run it again after a
dependency change. There is no user service on Windows: run `octopod serve` yourself for
the API.
#>
param(
  [switch]$NoEdge,
  [switch]$NoTray,
  [switch]$Help
)
$ErrorActionPreference = 'Stop'

if ($Help) { Get-Help $PSCommandPath -Full | Out-String | Write-Host; exit 0 }

$Root = $PSScriptRoot
$BinDir = if ($env:BIN_DIR) { $env:BIN_DIR } else { Join-Path $HOME '.local\bin' }

function Say($m) { Write-Host $m -ForegroundColor White }
function Warn($m) { Write-Host "! $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "x $m" -ForegroundColor Red; exit 1 }

Say 'Checking requirements'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'Node.js is not installed (22 or later is needed)' }
$major = [int](node -p 'process.versions.node.split(".")[0]')
if ($major -lt 22) { Fail "Node.js $(node -v) is too old: 22 or later is needed" }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Fail 'npm is not installed' }
Write-Host "  node $(node -v)"

Say 'Installing dependencies'
Push-Location $Root
try {
  npm install --no-fund --no-audit
  if ($LASTEXITCODE -ne 0) { Fail 'npm install failed' }
} finally { Pop-Location }

Say 'Installing the octopod command'
New-Item -ItemType Directory -Force $BinDir | Out-Null
$marker = 'octopod shim for'
$cmdShim = Join-Path $BinDir 'octopod.cmd'
$shShim = Join-Path $BinDir 'octopod'
foreach ($target in $cmdShim, $shShim) {
  if ((Test-Path $target) -and -not ((Get-Content $target -Raw) -match [regex]::Escape($marker))) {
    Fail "$target exists and is not an octopod of ours; move it away, or set BIN_DIR to another folder"
  }
}
# PowerShell and cmd. Tools that start octopod themselves read the entry point on the
# `rem entry` line: a .cmd cannot be run without a shell.
Set-Content -Path $cmdShim -Encoding ascii -Value @(
  '@echo off'
  "rem $marker $Root"
  "rem entry $Root\bin\octopod.js"
  "node `"$Root\bin\octopod.js`" %*"
)
# Git Bash.
$rootSlash = $Root -replace '\\', '/'
[IO.File]::WriteAllText($shShim, "#!/bin/sh`n# $marker $Root`nexec node '$rootSlash/bin/octopod.js' `"`$@`"`n")
Write-Host "  $cmdShim -> $Root\bin\octopod.js"
Write-Host "  $shShim (Git Bash)"
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$onPath = ($env:Path -split ';') + ($userPath -split ';') | Where-Object { $_ -and ($_.TrimEnd('\') -ieq $BinDir.TrimEnd('\')) }
if (-not $onPath) {
  Warn "$BinDir is not on your PATH: add it with"
  Write-Host "    [Environment]::SetEnvironmentVariable('Path', `"$BinDir;`" + [Environment]::GetEnvironmentVariable('Path','User'), 'User')"
  Write-Host '  then open a new terminal'
}

$setupArgs = @('setup', '--no-service')
if ($NoEdge) { $setupArgs += '--no-edge' }
node "$Root\bin\octopod.js" @setupArgs
if ($LASTEXITCODE -ne 0) { Fail 'octopod setup failed (is Docker Desktop running?)' }

if (-not $NoTray) {
  Say 'The tray icon'
  $vbs = Join-Path $Root 'bin\octopod-tray.vbs'
  $shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'octopod.lnk'
  $link = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut)
  $link.TargetPath = 'wscript.exe'
  $link.Arguments = "`"$vbs`""
  $link.IconLocation = Join-Path $Root 'assets\octopod.ico'
  $link.Description = 'octopod: the edge, the projects and their URLs'
  $link.Save()
  Write-Host "  Start menu: $shortcut"
  # A tray already running is the one of before this setup: started again, it runs this code.
  Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
    Where-Object { $_.CommandLine -match 'octopod-tray\.ps1' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Process -FilePath 'wscript.exe' -ArgumentList "`"$vbs`""
  Write-Host '  started: the tako in the notification area (right-click it; "Start with Windows" is there)'
}

Write-Host ''
Say 'Done. Next, in a project folder:'
Write-Host @"
  octopod.yaml   services: { app: { recipe: node-app } }   (or expose: for your own compose file)
  octopod register; octopod up
  octopod recipes   the recipes a project can name
  octopod edge status

  More: $Root\README.md
"@
