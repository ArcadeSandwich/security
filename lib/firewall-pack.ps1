# Shared engine for firewall fix packs (-DryRun, -Apply, -Undo). Dot-source after common.ps1.
# A pack defines $Pack = @{ Id; Port; Change = 'scope' | 'disable'; Scope = @(...) } and calls Invoke-FirewallPack.
# Kept by Security · Network.
#
# - DryRun (elevated): records the exact state of every matching rule to state\dryrun.json and shows the change.
#   DryRun (not elevated): shows the matching rules from netsh; records nothing (Apply will refuse).
# - Apply (elevated): needs a dryrun.json under 24 hours old whose rules still match the PC exactly; then changes them.
# - Undo (elevated): puts back Enabled, Profile and RemoteAddress exactly as dryrun.json recorded them.
# Every run appends to state\log.txt.

function Get-PackRuleState([int]$port) {
    $ids = @(Get-NetFirewallPortFilter -All | Where-Object { @($_.LocalPort) -contains "$port" } | ForEach-Object { $_.InstanceID })
    @(Get-NetFirewallRule -Direction Inbound -Action Allow | Where-Object { $ids -contains $_.Name } | Sort-Object Name | ForEach-Object {
        $a = $_ | Get-NetFirewallAddressFilter
        [ordered]@{ id = $_.Name; name = $_.DisplayName; enabled = "$($_.Enabled)"; profile = "$($_.Profile)"; remoteAddress = @($a.RemoteAddress) } })
}

function Write-PackLog($stateDir, [string]$line) {
    "$(Get-Date -Format s) $env:USERNAME $line" | Out-File -Append -Encoding utf8 (Join-Path $stateDir 'log.txt')
    Write-Host $line
}

function Invoke-FirewallPack($Pack, [bool]$DryRun, [bool]$Apply, [bool]$Undo, [string]$PackDir) {
    if ((@($DryRun, $Apply, $Undo) | Where-Object { $_ }).Count -ne 1) { Write-Host 'Use exactly one of -DryRun, -Apply or -Undo.'; exit 2 }
    $stateDir = Join-Path $PackDir 'state'; New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
    $statePath = Join-Path $stateDir 'dryrun.json'
    $elevated = Test-Elevated
    $describe = if ($Pack.Change -eq 'disable') { 'switch the rule off' } else { "limit Remote IP to $($Pack.Scope -join ', ')" }

    if ($DryRun -and -not $elevated) {
        $rules = @(Get-OpenRulesForPort $Pack.Port)
        Write-PackLog $stateDir "$($Pack.Id) dry run (not elevated, nothing recorded): $($rules.Count) enabled allow rule(s) on port $($Pack.Port):"
        foreach ($r in $rules) { Write-Host "  $($r.'Rule Name') | $($r.Protocol) | profiles $($r.Profiles) | remote $($r.RemoteIP) -> would $describe" }
        Write-Host 'Apply needs an elevated dry run first (the console does this).'
        return
    }
    if (-not $elevated) { Write-Host 'Apply and Undo need an elevated window. Nothing changed.'; exit 2 }

    if ($DryRun) {
        $state = @(Get-PackRuleState $Pack.Port)
        [ordered]@{ pack = $Pack.Id; time = (Get-Date).ToString('s'); rules = $state } | ConvertTo-Json -Depth 5 | Out-File -Encoding utf8 $statePath
        Write-PackLog $stateDir "$($Pack.Id) dry run (recorded $($state.Count) rule(s) to state\dryrun.json):"
        foreach ($r in $state) { Write-Host "  $($r.name) [$($r.id)] enabled=$($r.enabled) profile=$($r.profile) remote=$($r.remoteAddress -join ',') -> would $describe" }
        return
    }

    if (-not (Test-Path $statePath)) { Write-Host 'No recorded dry run. Run -DryRun elevated first. Nothing changed.'; exit 3 }
    $saved = Get-Content -Raw $statePath | ConvertFrom-Json

    if ($Apply) {
        if (((Get-Date) - [datetime]$saved.time).TotalHours -gt 24) { Write-Host 'The recorded dry run is older than 24 hours. Run -DryRun again. Nothing changed.'; exit 3 }
        $now = Get-PackRuleState $Pack.Port | ConvertTo-Json -Depth 5 -Compress
        $then = @($saved.rules) | ForEach-Object { [ordered]@{ id = $_.id; name = $_.name; enabled = $_.enabled; profile = $_.profile; remoteAddress = @($_.remoteAddress) } } | ConvertTo-Json -Depth 5 -Compress
        if ($now -ne $then) { Write-Host 'The rules changed since the dry run. Run -DryRun again. Nothing changed.'; exit 3 }
        foreach ($r in @($saved.rules)) {
            if ($Pack.Change -eq 'disable') { Set-NetFirewallRule -Name $r.id -Enabled False }
            else { Set-NetFirewallRule -Name $r.id -RemoteAddress $Pack.Scope }
            Write-PackLog $stateDir "$($Pack.Id) applied to $($r.name) [$($r.id)]: $describe"
        }
        return
    }

    if ($Undo) {
        foreach ($r in @($saved.rules)) {
            $remote = @($r.remoteAddress); if ($remote.Count -eq 0) { $remote = @('Any') }
            Set-NetFirewallRule -Name $r.id -Enabled $r.enabled -Profile $r.profile -RemoteAddress $remote
            Write-PackLog $stateDir "$($Pack.Id) undone on $($r.name) [$($r.id)]: enabled=$($r.enabled) profile=$($r.profile) remote=$($remote -join ',')"
        }
    }
}
