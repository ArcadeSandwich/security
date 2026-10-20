# Shared engine for firewall fix packs (-DryRun, -Apply, -Undo). Dot-source after common.ps1.
# A pack defines $Pack = @{ Folder (its folder name); Id; Port; Change = 'scope' | 'disable'; Scope = @(...) } and calls Invoke-FirewallPack.
# Kept by Security · Network.
#
# - DryRun (not elevated): shows the matching rules from netsh; records nothing.
# - DryRun (elevated): records the exact state of every matching rule to the protected state folder
#   (Get-PackStateDir: C:\ProgramData\SecurityConsole\state\<pack folder name>, Administrators and SYSTEM only) and shows the change.
# - Apply (elevated): needs a recorded dry run under 24 hours old whose rules still match the PC exactly.
# - Undo (elevated): puts back Enabled, Profile and RemoteAddress exactly as recorded, after checking that every
#   recorded id is an allow rule on the pack's port today and every value parses.
# Elevated runs log to log.txt in the state folder.

$script:TailscaleRanges = @('100.64.0.0/10', 'fd7a:115c:a1e0::/48')

function Get-PackRuleState([int]$port) {
    $ids = @(Get-NetFirewallPortFilter -All | Where-Object { @($_.LocalPort) -contains "$port" } | ForEach-Object { $_.InstanceID })
    @(Get-NetFirewallRule -Direction Inbound -Action Allow | Where-Object { $ids -contains $_.Name } | Sort-Object Name | ForEach-Object {
        $a = $_ | Get-NetFirewallAddressFilter
        # Enabled as a bool, Profile as its number, so Undo never has to parse display text.
        [ordered]@{ id = $_.Name; name = $_.DisplayName; enabled = ("$($_.Enabled)" -eq 'True'); profile = [int]$_.Profile; remoteAddress = @($a.RemoteAddress | ForEach-Object { "$_" }) } })
}

function Test-RemoteAddressValue([string]$v) {
    if ($v -in 'Any', 'LocalSubnet', 'LocalSubnet4', 'LocalSubnet6', 'Internet', 'Intranet', 'DNS', 'DHCP', 'WINS', 'DefaultGateway') { return $true }
    $ip = $null
    foreach ($part in ($v -split '-')) {
        $addr, $bits = $part -split '/', 2
        if (-not [System.Net.IPAddress]::TryParse($addr, [ref]$ip)) { return $false }
        if ($bits -and ($bits -notmatch '^\d{1,3}$' -and -not [System.Net.IPAddress]::TryParse($bits, [ref]$ip))) { return $false }
    }
    return $true
}

function Write-PackLog($stateDir, [string]$line) {
    if ($stateDir) { "$(Get-Date -Format s) $env:USERNAME $line" | Out-File -Append -Encoding utf8 (Join-Path $stateDir 'log.txt') }
    Write-Host $line
}

function Invoke-FirewallPack($Pack, [bool]$DryRun, [bool]$Apply, [bool]$Undo) {
    if ((@($DryRun, $Apply, $Undo) | Where-Object { $_ }).Count -ne 1) { Write-Host 'Use exactly one of -DryRun, -Apply or -Undo.'; exit 2 }
    $describe = if ($Pack.Change -eq 'disable') { 'switch the rule off' } else { "limit Remote IP to $($Pack.Scope -join ', ')" }

    if (-not (Test-Elevated)) {
        if (-not $DryRun) { Write-Host 'Apply and Undo need an elevated window. Nothing changed.'; exit 2 }
        $rules = @(Get-OpenRulesForPort $Pack.Port)
        Write-Host "$($Pack.Id) dry run (not elevated, nothing recorded): $($rules.Count) enabled allow rule(s) on port $($Pack.Port):"
        foreach ($r in $rules) { Write-Host "  RULE $($r.'Rule Name') | $($r.Protocol) | profiles $($r.Profiles) | remote $($r.RemoteIP) -> would $describe" }
        return
    }

    $stateDir = Get-PackStateDir $Pack.Folder
    $statePath = Join-Path $stateDir 'dryrun.json'

    if ($DryRun) {
        $state = @(Get-PackRuleState $Pack.Port)
        [ordered]@{ pack = $Pack.Id; port = $Pack.Port; time = (Get-Date).ToString('s'); rules = $state } | ConvertTo-Json -Depth 5 | Out-File -Encoding utf8 $statePath
        Write-PackLog $stateDir "$($Pack.Id) dry run (recorded $($state.Count) rule(s)):"
        foreach ($r in $state) { Write-Host "  RULE $($r.name) [$($r.id)] enabled=$($r.enabled) profile=$([Microsoft.PowerShell.Cmdletization.GeneratedTypes.NetSecurity.Profile]$r.profile) remote=$($r.remoteAddress -join ',') -> would $describe" }
        return
    }

    if (-not (Test-Path $statePath)) { Write-Host 'No recorded dry run. Run -DryRun elevated first. Nothing changed.'; exit 3 }
    $saved = Get-Content -Raw $statePath | ConvertFrom-Json
    if ($saved.pack -ne $Pack.Id -or [int]$saved.port -ne $Pack.Port) { Write-Host 'The recorded dry run is for another pack. Nothing changed.'; exit 3 }
    $recorded = @($saved.rules | ForEach-Object { [ordered]@{ id = "$($_.id)"; name = "$($_.name)"; enabled = [bool]$_.enabled; profile = [int]$_.profile; remoteAddress = @($_.remoteAddress | ForEach-Object { "$_" }) } })

    if ($Apply) {
        if (((Get-Date) - [datetime]$saved.time).TotalHours -gt 24) { Write-Host 'The recorded dry run is older than 24 hours. Run -DryRun again. Nothing changed.'; exit 3 }
        if ((@(Get-PackRuleState $Pack.Port) | ConvertTo-Json -Depth 5 -Compress) -ne ($recorded | ConvertTo-Json -Depth 5 -Compress)) { Write-Host 'The rules changed since the dry run. Run -DryRun again. Nothing changed.'; exit 3 }
        foreach ($r in $recorded) {
            if ($Pack.Change -eq 'disable') { Set-NetFirewallRule -Name $r.id -Enabled False }
            else { Set-NetFirewallRule -Name $r.id -RemoteAddress $Pack.Scope }
            Write-PackLog $stateDir "$($Pack.Id) applied to $($r.name) [$($r.id)]: $describe"
        }
        return
    }

    if ($Undo) {
        # Validate everything first, so Undo never stops halfway.
        $today = @(Get-PackRuleState $Pack.Port | ForEach-Object { $_.id })
        $maxProfile = 7   # Domain 1 + Private 2 + Public 4; 0 = Any
        foreach ($r in $recorded) {
            if ($today -notcontains $r.id) { Write-Host "Refused: recorded rule $($r.id) is not an allow rule on port $($Pack.Port) today. Nothing changed."; exit 3 }
            if ($r.profile -lt 0 -or $r.profile -gt $maxProfile) { Write-Host "Refused: profile value $($r.profile) for $($r.id) does not parse. Nothing changed."; exit 3 }
            if ($r.remoteAddress.Count -eq 0 -or @($r.remoteAddress | Where-Object { -not (Test-RemoteAddressValue $_) }).Count) { Write-Host "Refused: a remote address for $($r.id) does not parse. Nothing changed."; exit 3 }
        }
        foreach ($r in $recorded) {
            $enabled = if ($r.enabled) { 'True' } else { 'False' }
            Set-NetFirewallRule -Name $r.id -Enabled $enabled -Profile ([Microsoft.PowerShell.Cmdletization.GeneratedTypes.NetSecurity.Profile]$r.profile) -RemoteAddress $r.remoteAddress
            Write-PackLog $stateDir "$($Pack.Id) undone on $($r.name) [$($r.id)]: enabled=$enabled profile=$($r.profile) remote=$($r.remoteAddress -join ',')"
        }
    }
}
