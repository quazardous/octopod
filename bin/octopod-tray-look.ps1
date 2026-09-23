# octopod-tray-look.ps1 -- what the tray shows for what octopod says, as pure
# functions the tray dot-sources and a test runs under pwsh (no WinForms).
#
# Keep this file ASCII-only, like octopod-tray.ps1: Windows PowerShell 5.1 reads
# a BOM-less file in the system code page.

# $edge: what `octopod edge status --json` printed, or $null when it failed (with
# $why, its error: Docker not answering, most of the time). $projects: what
# `octopod list --json` printed. $version: `octopod version --json`.
function Get-TrayLook($edge, [string]$why, $projects, $version) {
    $v = if ($version -and $version.version) { " $($version.version)" } else { '' }
    $list = @($projects | Where-Object { $_ })
    $count = $list.Count
    $some = if ($count -eq 1) { '1 project' } else { "$count projects" }
    if (-not $edge) {
        $docker = $why -match 'docker|daemon|pipe|engine'
        $line = if ($docker) { 'Docker does not answer: is Docker Desktop running?' }
                elseif ($why) { "octopod does not answer: $($why.Split("`n")[0])" }
                else { 'octopod does not answer' }
        return @{ up = $false; dockerDown = $docker; line = $line; tooltip = (Get-TrayTooltip "octopod$v" $(if ($docker) { 'Docker is not running' } else { 'not answering' })) }
    }
    if (-not $edge.running) {
        return @{ up = $false; dockerDown = $false; line = "The edge is stopped - $some"; tooltip = (Get-TrayTooltip "octopod$v" "edge stopped, $some") }
    }
    $port = if ($edge.port -and $edge.port -ne 80) { " on port $($edge.port)" } else { '' }
    return @{ up = $true; dockerDown = $false; line = "The edge runs$port - $some"; tooltip = (Get-TrayTooltip "octopod$v" "edge running, $some") }
}

# NotifyIcon.Text is capped at 63 characters.
function Get-TrayTooltip([string]$who, [string]$state) {
    $t = "$who - $state"
    if ($t.Length -le 63) { return $t }
    return $t.Substring(0, 60) + '...'
}

# What a project's menu entry says: its name, and its problem when it has one.
function Get-ProjectLabel($project) {
    if ($project.problem) { return "$($project.name) (!)" }
    return [string]$project.name
}

# The balloon after an action the tray ran (`octopod up demo`...): the command, then
# its first error line, or that it is done.
function Get-ActionBalloon([string]$what, [int]$exitCode, [string]$stderr) {
    if ($exitCode -eq 0) { return @{ ok = $true; text = "${what}: done." } }
    $first = @($stderr -split "`r?`n" | Where-Object { $_.Trim() }) | Select-Object -First 1
    $first = if ($first) { ($first -replace '^octopod: ', '').Trim() } else { "exit code $exitCode" }
    return @{ ok = $false; text = "${what} failed: $first" }
}
