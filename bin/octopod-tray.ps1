# octopod-tray.ps1 -- octopod in the Windows notification area: whether Docker and the
# edge run, the projects and their URLs, and the few actions a click is enough for.
#
# The edge is Docker's (restart: unless-stopped): it comes back with Docker Desktop
# whether the tray runs or not, and quitting the tray leaves it running. The API is the
# tray's: Windows has no user service, so the tray starts `octopod serve` (loopback and a
# token, see api.json) for the console, starts it again if it ends, and stops it on quit.
# Everything else goes through the octopod CLI, `--json`.
#
# Started hidden by octopod-tray.vbs (the Start menu shortcut, and "Start with
# Windows"), or by octopod-tray.cmd from a terminal.
#
# Keep this file ASCII-only: Windows PowerShell 5.1 (powershell.exe) reads a BOM-less
# file in the system code page, and a stray accent can break the parse before the icon
# shows.

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

. (Join-Path $PSScriptRoot 'octopod-tray-look.ps1')

# One tray per session: a second start (the shortcut, clicked twice) leaves quietly.
$createdNew = $false
$singleton = New-Object System.Threading.Mutex($true, 'Local\octopod-tray-singleton', [ref]$createdNew)
if (-not $createdNew) { $singleton.Dispose(); exit 0 }
# setup.ps1 sets this to have the tray quit cleanly before it starts the new one.
$quitSignal = New-Object System.Threading.EventWaitHandle($false, [System.Threading.EventResetMode]::ManualReset, 'Local\octopod-tray-quit')
$quitSignal.Reset() | Out-Null

$octopodJs = Join-Path $PSScriptRoot 'octopod.js'
$assets = Join-Path $PSScriptRoot '..\assets'

# --- commands, run without blocking the message loop -------------------------------
# Each is a process whose output the timer collects once it has exited: octopod is a
# node process, and docker may take seconds to say it is not there.
function Start-Command([string]$file, [string[]]$arguments) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $file
    # Quoted one by one: a project's folder may hold spaces.
    $psi.Arguments = ($arguments | ForEach-Object { if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }) -join ' '
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    # node and docker write UTF-8; PowerShell would read the console's code page.
    $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
    $psi.CreateNoWindow = $true
    try {
        $p = [System.Diagnostics.Process]::Start($psi)
        return @{ process = $p; out = $p.StandardOutput.ReadToEndAsync(); err = $p.StandardError.ReadToEndAsync() }
    } catch {
        return @{ process = $null; failed = $_.Exception.Message }
    }
}
function Start-Octopod([string[]]$arguments) { return Start-Command 'node' (@($octopodJs) + $arguments) }

# $null while it runs; then @{ code; out; err }.
function Receive-Command($c) {
    if (-not $c) { return $null }
    if (-not $c.process) { return @{ code = -1; out = ''; err = $c.failed } }
    if (-not $c.process.HasExited -or -not $c.out.IsCompleted -or -not $c.err.IsCompleted) { return $null }
    $r = @{ code = $c.process.ExitCode; out = $c.out.Result; err = $c.err.Result }
    $c.process.Dispose()
    return $r
}
function Read-Json([string]$text) {
    try { return ($text | ConvertFrom-Json) } catch { return $null }
}

function Open-Url([string]$u) {
    # Through the shell: the link opens in the default browser, in its running profile.
    if ($u) { Start-Process -FilePath 'explorer.exe' -ArgumentList $u }
}

# --- autostart: a Run value, the one Settings > Apps > Startup shows and can turn off --
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$runName = 'octopod-tray'
function Test-Autostart {
    try { return [bool](Get-ItemProperty -Path $runKey -Name $runName -ErrorAction Stop).$runName } catch { return $false }
}
function Set-Autostart([bool]$on) {
    if ($on) {
        $vbs = Join-Path $PSScriptRoot 'octopod-tray.vbs'
        Set-ItemProperty -Path $runKey -Name $runName -Value "wscript.exe `"$vbs`"" -Type String
    } else {
        Remove-ItemProperty -Path $runKey -Name $runName -ErrorAction SilentlyContinue
    }
}

# --- the icon -------------------------------------------------------------------------
function Get-Icon([string]$name) {
    $path = Join-Path $assets "$name.ico"
    if (Test-Path $path) { try { return New-Object System.Drawing.Icon $path } catch { } }
    return [System.Drawing.SystemIcons]::Application
}
$upIcon = Get-Icon 'octopod'
$downIcon = Get-Icon 'octopod-down'

# The pictures of the menu's links: the tako for the console, the logos of Traefik and
# GitHub. 32 pixels, drawn down to the menu's size (larger on a scaled screen).
function Get-Picture([string]$file) {
    $path = Join-Path $assets $file
    try {
        if ($file -like '*.ico') { return (New-Object System.Drawing.Icon $path, 32, 32).ToBitmap() }
        return [System.Drawing.Image]::FromFile($path)
    } catch { return $null }
}
$consolePicture = Get-Picture 'octopod.ico'
$traefikPicture = Get-Picture 'traefik-32.png'
$githubPicture = Get-Picture 'github-32.png'

$ni = New-Object System.Windows.Forms.NotifyIcon
$ni.Icon = $downIcon
$ni.Text = 'octopod - looking...'
$ni.Visible = $true

# What the last look found: the menu is built from it when it opens.
$script:look = $null
$script:edge = $null
$script:projects = @()
$script:version = $null

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$ni.ContextMenuStrip = $menu

# $tag: what the handler acts on, read back as $this.Tag -- a closure would not see this
# script's functions.
function Add-Item($items, [string]$text, [scriptblock]$onClick, $tag = $null) {
    $item = New-Object System.Windows.Forms.ToolStripMenuItem
    $item.Text = $text
    $item.Tag = $tag
    if ($onClick) { $item.Add_Click($onClick) } else { $item.Enabled = $false }
    $items.Add($item) | Out-Null
    return $item
}

# Actions the tray started, each with what it is called in its balloon.
$script:actions = New-Object System.Collections.ArrayList
function Start-Action([string]$what, [string[]]$arguments) {
    $script:actions.Add(@{ what = $what; command = (Start-Octopod $arguments) }) | Out-Null
    $ni.ShowBalloonTip(3000, 'octopod', "${what}...", [System.Windows.Forms.ToolTipIcon]::None)
}

function Build-Menu {
    $menu.Items.Clear()
    $line = if ($script:look) { $script:look.line } else { 'Looking...' }
    Add-Item $menu.Items $line $null | Out-Null
    $menu.Items.Add('-') | Out-Null

    foreach ($p in @($script:projects | Where-Object { $_ })) {
        $item = Add-Item $menu.Items (Get-ProjectLabel $p) { }
        $name = [string]$p.name
        if ($p.problem) { Add-Item $item.DropDownItems ([string]$p.problem) $null | Out-Null }
        foreach ($r in @($p.routes)) {
            $u = [string]$r.url
            Add-Item $item.DropDownItems "Open $u" { Open-Url $this.Tag } $u | Out-Null
        }
        $item.DropDownItems.Add('-') | Out-Null
        Add-Item $item.DropDownItems 'Start (octopod up)' { Start-Action "octopod up $($this.Tag)" @('up', $this.Tag) } $name | Out-Null
        Add-Item $item.DropDownItems 'Stop (octopod down)' { Start-Action "octopod down $($this.Tag)" @('down', $this.Tag) } $name | Out-Null
        Add-Item $item.DropDownItems 'Open the folder' { Start-Process -FilePath 'explorer.exe' -ArgumentList "`"$($this.Tag)`"" } ([string]$p.root) | Out-Null
    }
    if (@($script:projects | Where-Object { $_ }).Count -eq 0) {
        Add-Item $menu.Items 'No project yet: octopod register, in its folder' $null | Out-Null
    }
    $menu.Items.Add('-') | Out-Null

    if ($script:look -and $script:look.dockerDown) {
        $desktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
        if (Test-Path $desktop) { Add-Item $menu.Items 'Start Docker Desktop' { Start-Process -FilePath $this.Tag } $desktop | Out-Null }
    } elseif ($script:look -and $script:look.up) {
        (Add-Item $menu.Items 'octopod console' { Open-Url $this.Tag } ([string]$script:edge.console)).Image = $consolePicture
        (Add-Item $menu.Items 'Traefik dashboard' { Open-Url $this.Tag } ([string]$script:edge.dashboard)).Image = $traefikPicture
        Add-Item $menu.Items 'Stop the edge' { Start-Action 'octopod edge down' @('edge', 'down') } | Out-Null
    } elseif ($script:look) {
        Add-Item $menu.Items 'Start the edge' { Start-Action 'octopod edge up' @('edge', 'up') } | Out-Null
    }
    $auto = Add-Item $menu.Items 'Start with Windows' { Set-Autostart (-not (Test-Autostart)) }
    $auto.Checked = Test-Autostart
    (Add-Item $menu.Items 'octopod on GitHub' { Open-Url $this.Tag } 'https://github.com/quazardous/octopod').Image = $githubPicture
    $menu.Items.Add('-') | Out-Null
    Add-Item $menu.Items 'Quit (the edge keeps running)' { Exit-Tray } | Out-Null
}

# Quitting takes the icon away: a tray killed instead leaves a dead one in the notification
# area until the mouse passes over it.
function Exit-Tray {
    $script:quitting = $true
    Stop-Api
    $ni.Visible = $false
    [System.Windows.Forms.Application]::Exit()
}
$menu.Add_Opening({ Build-Menu })

# A left click opens the same menu: the projects are what one clicks the tako for.
$ni.Add_MouseUp({
    param($sender, $e)
    if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
        $show = [System.Windows.Forms.NotifyIcon].GetMethod('ShowContextMenu', [System.Reflection.BindingFlags]'Instance,NonPublic')
        $show.Invoke($ni, $null) | Out-Null
    }
})

# --- the API, for the console -----------------------------------------------------------
# Where octopod keeps its state, found as octopod finds it: api.json holds the API's port.
$stateDir = if ($env:OCTOPOD_STATE_DIR) { $env:OCTOPOD_STATE_DIR }
            elseif ($env:XDG_STATE_HOME) { Join-Path $env:XDG_STATE_HOME 'octopod' }
            else { Join-Path $env:USERPROFILE '.local\state\octopod' }
$apiFile = Join-Path $stateDir 'api.json'
$script:serve = $null
$script:serveStartedAt = $null
function Test-Api {
    try {
        $port = [int]((Get-Content -Raw $apiFile | ConvertFrom-Json).port)
        $client = New-Object System.Net.Sockets.TcpClient
        try { return $client.ConnectAsync('127.0.0.1', $port).Wait(300) -and $client.Connected } finally { $client.Dispose() }
    } catch { return $false }
}
function Start-Api {
    # One started by hand (octopod serve in a terminal) is as good as ours.
    if (Test-Api) { return }
    if ($script:serve -and -not $script:serve.HasExited) { return }
    # At most one start every 10 seconds: an API that ends at once is not hammered.
    $now = [Environment]::TickCount
    if ($null -ne $script:serveStartedAt -and ($now - $script:serveStartedAt) -lt 10000) { return }
    $script:serveStartedAt = $now
    try {
        New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
        $script:serve = Start-Process -FilePath 'node' -ArgumentList "`"$octopodJs`"", 'serve' -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $stateDir 'serve.log') -RedirectStandardError (Join-Path $stateDir 'serve.err.log')
    } catch { $script:serve = $null }
}
function Stop-Api {
    if ($script:serve -and -not $script:serve.HasExited) {
        try { Stop-Process -Id $script:serve.Id -Force -ErrorAction SilentlyContinue } catch { }
    }
}

# --- looking: Docker, the edge, the projects -------------------------------------------
$script:probe = $null
$script:quitting = $false
function Start-Look {
    if ($script:probe) { return }
    $script:probe = @{
        docker = (Start-Command 'docker' @('version', '--format', '{{.Server.Version}}'))
        edge = (Start-Octopod @('edge', 'status', '--json'))
        list = (Start-Octopod @('list', '--json'))
    }
}
function Receive-Look {
    if (-not $script:probe) { return }
    $docker = Receive-Command $script:probe.docker
    $edge = Receive-Command $script:probe.edge
    $list = Receive-Command $script:probe.list
    # Each is received once: keep what came, wait for the rest.
    if ($docker) { $script:probe.dockerDone = $docker; $script:probe.docker = $null }
    if ($edge) { $script:probe.edgeDone = $edge; $script:probe.edge = $null }
    if ($list) { $script:probe.listDone = $list; $script:probe.list = $null }
    if (-not ($script:probe.dockerDone -and $script:probe.edgeDone -and $script:probe.listDone)) { return }
    $d = $script:probe.dockerDone; $e = $script:probe.edgeDone; $l = $script:probe.listDone
    $script:probe = $null

    $why = ''
    $edgeNow = $null
    if ($d.code -ne 0) { $why = "docker: $($d.err)" }
    elseif ($e.code -ne 0) { $why = $e.err }
    else { $edgeNow = Read-Json $e.out }
    $script:edge = $edgeNow
    if ($l.code -eq 0) { $script:projects = @(Read-Json $l.out) }
    $before = $script:look
    $script:look = Get-TrayLook $edgeNow $why $script:projects $script:version
    $ni.Icon = if ($script:look.up) { $upIcon } else { $downIcon }
    $ni.Text = $script:look.tooltip
    # Say it when it changes, not at every look, nor at the first one.
    if ($before -and $before.line -ne $script:look.line -and $before.up -ne $script:look.up) {
        $ni.ShowBalloonTip(5000, 'octopod', $script:look.line, [System.Windows.Forms.ToolTipIcon]::Info)
    }
}
function Receive-Actions {
    foreach ($a in @($script:actions)) {
        $r = Receive-Command $a.command
        if (-not $r) { continue }
        $script:actions.Remove($a)
        $b = Get-ActionBalloon $a.what $r.code $r.err
        $icon = if ($b.ok) { [System.Windows.Forms.ToolTipIcon]::Info } else { [System.Windows.Forms.ToolTipIcon]::Warning }
        $ni.ShowBalloonTip(8000, 'octopod', $b.text, $icon)
        Start-Look
    }
}

$script:versionRead = Start-Octopod @('version', '--json')
$script:ticks = 0
function Update-Tray {
    if ($script:quitting) { return }
    if ($quitSignal.WaitOne(0)) { Exit-Tray; return }
    if ($script:versionRead) {
        $v = Receive-Command $script:versionRead
        if ($v) { $script:version = Read-Json $v.out; $script:versionRead = $null }
    }
    Receive-Actions
    Receive-Look
    # A look every 10 seconds; the timer ticks every second to collect answers quickly.
    if ($script:ticks % 10 -eq 0) { Start-Api; Start-Look }
    $script:ticks++
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1000
$timer.Add_Tick({ Update-Tray })
$timer.Start()
Update-Tray

try {
    [System.Windows.Forms.Application]::Run()
} finally {
    $timer.Stop()
    Stop-Api
    $ni.Visible = $false
    $ni.Dispose()
    try { $singleton.ReleaseMutex() } catch { }
    $singleton.Dispose()
}
