$env:PSModulePath = "$env:windir\System32\WindowsPowerShell\v1.0\Modules"   # R1: before any cmdlet that autoloads a module
# Shared engine for firewall fix packs (-DryRun, -Apply, -Undo). Dot-source after common.ps1.
# Kept by Security · Network.
#
# A pack defines $Pack = @{ Folder (its folder name); Id; Targets = @( ... ) } and calls Invoke-FirewallPack.
# Each target picks existing inbound ALLOW rules and changes them, or adds BLOCK rules:
#   @{ Port = 3389;                       Change = 'scope'; Scope = @(...) }   rules whose LocalPort lists the port
#   @{ Port = 2179;                       Change = 'disable' }
#   @{ NamePrefix = 'HNS Container ...';  Change = 'scope'; Scope = @(...) }   rules whose display name starts so
#   @{ Programs = @('obs64.exe', ...);    Change = 'scope'; Scope = @(...) }   rules for these programs (file name)
#   @{ Block = @(@{ Name; Protocol; LocalPort }); LocalAddress = @(...) }      new block rules (group "SecurityConsole <Id>")
# Any target may add RemoteAnyOnly = $true: only rules whose Remote IP is Any today.
#
# - DryRun (not elevated): shows the matching rules from netsh where it can; records nothing.
# - DryRun (elevated): records the exact state of every matching rule to the protected state folder
#   (Get-PackStateDir: C:\ProgramData\SecurityConsole\state\<pack folder name>, Administrators and SYSTEM only).
# - Apply (elevated): needs a recorded dry run under 24 hours old whose rules still match the PC exactly.
# - Undo (elevated): puts back Enabled, Profile, RemoteAddress and edge traversal exactly as first recorded (baseline.json,
#   SEC-INFRA-9), and removes the pack's own block rules, after checking that every recorded rule still exists as an inbound
#   allow rule with a valid target and every value parses. It does NOT check that the pack would pick the rule today (an
#   applied RemoteAnyOnly rule no longer would); the ids come from the admin-only state folder. Afterwards it clears
#   baseline.json and dryrun.json (SEC-INFRA-10).
# Elevated runs log to log.txt in the state folder.

$script:TailscaleRanges = @('100.64.0.0/10', 'fd7a:115c:a1e0::/48')
function ConvertTo-FwProfile([int]$n) { [Enum]::ToObject(("Microsoft.PowerShell.Cmdletization.GeneratedTypes.NetSecurity.Profile" -as [type]), $n) }

function Get-TargetRuleIds($t) {
    $rules = @(Get-NetFirewallRule -Direction Inbound -Action Allow)
    if ($t.Port) {
        $ids = @(Get-NetFirewallPortFilter -All | Where-Object { @($_.LocalPort) -contains "$($t.Port)" } | ForEach-Object { $_.InstanceID })
        $rules = @($rules | Where-Object { $ids -contains $_.Name })
    } elseif ($t.NamePrefix) {
        $rules = @($rules | Where-Object { $_.DisplayName.StartsWith($t.NamePrefix) })
    } elseif ($t.Programs) {
        $ids = @(Get-NetFirewallApplicationFilter -All | Where-Object { $_.Program -and ($t.Programs -contains [IO.Path]::GetFileName($_.Program).ToLower()) } | ForEach-Object { $_.InstanceID })
        $rules = @($rules | Where-Object { $ids -contains $_.Name })
    } else { return @() }
    if ($t.RemoteAnyOnly) { $rules = @($rules | Where-Object { @(($_ | Get-NetFirewallAddressFilter).RemoteAddress) -contains 'Any' }) }
    @($rules | ForEach-Object { $_.Name })
}

function Get-PackRuleState($Pack) {
    $out = @()
    for ($i = 0; $i -lt $Pack.Targets.Count; $i++) {
        $t = $Pack.Targets[$i]
        if ($t.Block) { continue }
        foreach ($id in (Get-TargetRuleIds $t | Sort-Object -Unique)) {
            $r = Get-NetFirewallRule -Name $id; $a = $r | Get-NetFirewallAddressFilter
            # Enabled as a bool, Profile as its number, so Undo never has to parse display text.
            # SEC-INFRA-12: edge traversal too, because "Defer to user" (rules from Windows' "Allow access" prompt) can't take a scope.
            $out += [ordered]@{ target = $i; id = $r.Name; name = $r.DisplayName; enabled = ("$($r.Enabled)" -eq 'True'); profile = [int]$r.Profile; remoteAddress = @($a.RemoteAddress | ForEach-Object { "$_" }); edgeTraversal = "$($r.EdgeTraversalPolicy)" }
        }
    }
    , @($out)
}

function Get-PackBlockNames($Pack) {
    @($Pack.Targets | Where-Object { $_.Block } | ForEach-Object { $_.Block } | ForEach-Object { "$($Pack.Id)-$($_.Name)" })
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

# SEC-INFRA-12: the extra Set-NetFirewallRule arguments for a scope change. Windows refuses a remote address on a rule
# whose edge traversal is DeferToUser or DeferToApp, so those become Block (the default) in the same call; Undo puts it back.
$script:EdgeValues = @('Block', 'Allow', 'DeferToUser', 'DeferToApp')
function Get-ScopeExtra([string]$edge) {
    if ($edge -in 'DeferToUser', 'DeferToApp') { return @{ EdgeTraversalPolicy = 'Block' } }
    @{}
}
# For Undo: the edge traversal to put back, or $null when nothing was recorded (older state files) or it is unchanged.
function Get-UndoEdge($r, [string]$current) {
    $e = "$($r.edgeTraversal)"
    if (-not $e -or $e -eq $current) { return $null }
    $e
}

# SEC-INFRA-9: baseline.json is the undo point. The first -Apply copies the dry run into it; a later -Apply only adds
# rules it doesn't hold yet (each with its state from before its own first change). blocksPresent is kept from the first.
function Update-PackBaseline([string]$statePath, [string]$basePath) {
    $now = Get-Content -Raw $statePath | ConvertFrom-Json
    if (-not (Test-Path $basePath)) { Copy-Item -LiteralPath $statePath -Destination $basePath; return }
    $base = Get-Content -Raw $basePath | ConvertFrom-Json
    $known = @($base.rules | ForEach-Object { "$($_.id)" })
    $add = @($now.rules | Where-Object { $known -notcontains "$($_.id)" })
    if ($add.Count -eq 0) { return }
    $merged = [ordered]@{ pack = $base.pack; folder = $base.folder; time = $base.time; rules = @(@($base.rules) + $add); blocksPresent = @($base.blocksPresent) }
    $merged | ConvertTo-Json -Depth 6 | Out-File -Encoding utf8 $basePath
}

function Get-TargetText($t) {
    if ($t.Block) { return "add block rules for $(($t.Block | ForEach-Object { "$($_.Protocol) $($_.LocalPort)" }) -join ', ') on local address $($t.LocalAddress -join ', ')" }
    $what = if ($t.Port) { "rules on port $($t.Port)" } elseif ($t.NamePrefix) { "rules named '$($t.NamePrefix)...'" } else { "rules for $($t.Programs -join ', ')" }
    if ($t.RemoteAnyOnly) { $what += ' with Remote IP Any' }
    $how = if ($t.Change -eq 'disable') { 'switch off' } else { "limit Remote IP to $($t.Scope -join ', ')" }
    "$how $what"
}

function Show-UnelevatedDryRun($Pack) {
    $all = @(Get-InboundRulesNetsh | Where-Object { $_.Enabled -eq 'Yes' -and $_.Action -eq 'Allow' })
    Write-Host "$($Pack.Id) dry run (not elevated, nothing recorded):"
    foreach ($t in $Pack.Targets) {
        Write-Host "- would $(Get-TargetText $t)"
        if ($t.Block) { foreach ($b in $t.Block) { Write-Host "  RULE (new block) $($Pack.Id)-$($b.Name) | $($b.Protocol) $($b.LocalPort)" }; continue }
        $m = if ($t.Port) { @($all | Where-Object { Test-PortInList $_.LocalPort $t.Port }) }
             elseif ($t.NamePrefix) { @($all | Where-Object { $_.'Rule Name'.StartsWith($t.NamePrefix) }) }
             else { @($all | Where-Object { $_.Program -and ($t.Programs -contains [IO.Path]::GetFileName($_.Program).ToLower()) }) }
        if ($t.RemoteAnyOnly) { $m = @($m | Where-Object { $_.RemoteIP -eq 'Any' }) }
        foreach ($r in $m) { Write-Host "  RULE $($r.'Rule Name') | $($r.Protocol) $($r.LocalPort) | profiles $($r.Profiles) | remote $($r.RemoteIP)" }
    }
    Write-Host '(enabled rules only; the elevated dry run also records disabled ones it would change)'
}

function Invoke-FirewallPack($Pack, [bool]$DryRun, [bool]$Apply, [bool]$Undo) {
    if ((@($DryRun, $Apply, $Undo) | Where-Object { $_ }).Count -ne 1) { Write-Host 'Use exactly one of -DryRun, -Apply or -Undo.'; exit 2 }
    if (-not (Test-Elevated)) {
        if (-not $DryRun) { Write-Host 'Apply and Undo need an elevated window. Nothing changed.'; exit 2 }
        Show-UnelevatedDryRun $Pack; return
    }

    $stateDir = Get-PackStateDir $Pack.Folder
    $statePath = Join-Path $stateDir 'dryrun.json'
    $basePath = Join-Path $stateDir 'baseline.json'
    $blockNames = Get-PackBlockNames $Pack
    $group = "SecurityConsole $($Pack.Id)"

    if ($DryRun) {
        # SEC-INFRA-9: once a pack has changed anything, its first recorded state is the undo point and is never
        # overwritten. Packs applied before baseline.json existed: their last dry run (taken just before -Apply) becomes it.
        $logPath = Join-Path $stateDir 'log.txt'
        if (-not (Test-Path $basePath) -and (Test-Path $statePath) -and (Test-Path $logPath) -and (Select-String -LiteralPath $logPath -Pattern ' applied to | added block rule ' -Quiet)) {
            Copy-Item -LiteralPath $statePath -Destination $basePath
            Write-PackLog $stateDir "$($Pack.Id) kept the dry run from before the first -Apply as the undo point (baseline.json)"
        }
        $state = Get-PackRuleState $Pack
        $existing = @($blockNames | Where-Object { Get-NetFirewallRule -Name $_ -ErrorAction SilentlyContinue })
        [ordered]@{ pack = $Pack.Id; folder = $Pack.Folder; time = (Get-Date).ToString('s'); rules = $state; blocksPresent = $existing } | ConvertTo-Json -Depth 6 | Out-File -Encoding utf8 $statePath
        Write-PackLog $stateDir "$($Pack.Id) dry run (recorded $($state.Count) rule(s)):"
        foreach ($r in $state) { Write-Host "  RULE $($r.name) [$($r.id)] enabled=$($r.enabled) profile=$(ConvertTo-FwProfile $r.profile) remote=$($r.remoteAddress -join ',') -> would $(Get-TargetText $Pack.Targets[$r.target])" }
        foreach ($n in $blockNames) { Write-Host "  RULE (new block) $n$(if ($existing -contains $n) { ' (already there)' })" }
        return
    }

    if (-not (Test-Path $statePath)) { Write-Host 'No recorded dry run. Run -DryRun elevated first. Nothing changed.'; exit 3 }
    $saved = Get-Content -Raw $statePath | ConvertFrom-Json
    if ($Undo -and (Test-Path $basePath)) { $saved = Get-Content -Raw $basePath | ConvertFrom-Json }   # SEC-INFRA-9: undo to the first state
    if ($saved.pack -ne $Pack.Id -or $saved.folder -ne $Pack.Folder) { Write-Host 'The recorded dry run is for another pack. Nothing changed.'; exit 3 }
    $recorded = @($saved.rules | ForEach-Object { [ordered]@{ target = [int]$_.target; id = "$($_.id)"; name = "$($_.name)"; enabled = [bool]$_.enabled; profile = [int]$_.profile; remoteAddress = @($_.remoteAddress | ForEach-Object { "$_" }); edgeTraversal = "$($_.edgeTraversal)" } })
    $blocksBefore = @($saved.blocksPresent | ForEach-Object { "$_" })

    if ($Apply) {
        if (((Get-Date) - [datetime]$saved.time).TotalHours -gt 24) { Write-Host 'The recorded dry run is older than 24 hours. Run -DryRun again. Nothing changed.'; exit 3 }
        if (((Get-PackRuleState $Pack) | ConvertTo-Json -Depth 6 -Compress) -ne ($recorded | ConvertTo-Json -Depth 6 -Compress)) { Write-Host 'The rules changed since the dry run. Run -DryRun again. Nothing changed.'; exit 3 }
        Update-PackBaseline $statePath $basePath   # SEC-INFRA-9: before the first change
        foreach ($r in $recorded) {
            $t = $Pack.Targets[$r.target]
            if ($t.Change -eq 'disable') { Set-NetFirewallRule -Name $r.id -Enabled False } else { $x = Get-ScopeExtra "$($r.edgeTraversal)"; Set-NetFirewallRule -Name $r.id -RemoteAddress $t.Scope @x }
            Write-PackLog $stateDir "$($Pack.Id) applied to $($r.name) [$($r.id)]: $(Get-TargetText $t)"
        }
        foreach ($t in @($Pack.Targets | Where-Object { $_.Block })) {
            foreach ($b in $t.Block) {
                $n = "$($Pack.Id)-$($b.Name)"
                if (Get-NetFirewallRule -Name $n -ErrorAction SilentlyContinue) { Write-PackLog $stateDir "$($Pack.Id) block rule $n already there"; continue }
                New-NetFirewallRule -Name $n -DisplayName $n -Group $group -Direction Inbound -Action Block -Protocol $b.Protocol -LocalPort $b.LocalPort -LocalAddress $t.LocalAddress -Profile Any | Out-Null
                Write-PackLog $stateDir "$($Pack.Id) added block rule $n ($($b.Protocol) $($b.LocalPort))"
            }
        }
        return
    }

    if ($Undo) {
        # Validate everything first, so Undo never stops halfway.
        # SEC-INFRA-9: an applied "RemoteAnyOnly" rule is no longer picked today (its remote isn't Any any more), so the
        # check is that each recorded rule still exists, is an inbound allow rule, and belongs to a real target of this pack.
        foreach ($r in $recorded) {
            if ($r.target -lt 0 -or $r.target -ge $Pack.Targets.Count -or $Pack.Targets[$r.target].Block) { Write-Host "Refused: bad target for $($r.id). Nothing changed."; exit 3 }
            $live = Get-NetFirewallRule -Name $r.id -ErrorAction SilentlyContinue
            if (-not $live -or "$($live.Direction)" -ne 'Inbound' -or "$($live.Action)" -ne 'Allow') { Write-Host "Refused: recorded rule $($r.id) is gone or is not an inbound allow rule. Nothing changed."; exit 3 }
            if ($r.profile -lt 0 -or $r.profile -gt 7) { Write-Host "Refused: profile value $($r.profile) for $($r.id) does not parse. Nothing changed."; exit 3 }
            if ($r.remoteAddress.Count -eq 0 -or @($r.remoteAddress | Where-Object { -not (Test-RemoteAddressValue $_) }).Count) { Write-Host "Refused: a remote address for $($r.id) does not parse. Nothing changed."; exit 3 }
            if ($r.edgeTraversal -and $script:EdgeValues -notcontains $r.edgeTraversal) { Write-Host "Refused: edge traversal '$($r.edgeTraversal)' for $($r.id) does not parse. Nothing changed."; exit 3 }
        }
        foreach ($r in $recorded) {
            $enabled = if ($r.enabled) { 'True' } else { 'False' }
            Set-NetFirewallRule -Name $r.id -Enabled $enabled -Profile (ConvertTo-FwProfile $r.profile) -RemoteAddress $r.remoteAddress
            # SEC-INFRA-12: the remote address is back first (Any for these rules), so "Defer to user" is allowed again.
            $edge = Get-UndoEdge $r "$((Get-NetFirewallRule -Name $r.id).EdgeTraversalPolicy)"
            if ($edge) { Set-NetFirewallRule -Name $r.id -EdgeTraversalPolicy $edge }
            Write-PackLog $stateDir "$($Pack.Id) undone on $($r.name) [$($r.id)]: enabled=$enabled profile=$($r.profile) remote=$($r.remoteAddress -join ',')$(if ($edge) { " edge=$edge" })"
        }
        # Remove only this pack's own block rules that the dry run did not find already there.
        foreach ($n in $blockNames) {
            if ($blocksBefore -contains $n) { continue }
            $rule = Get-NetFirewallRule -Name $n -ErrorAction SilentlyContinue
            if ($rule -and $rule.Group -eq $group -and "$($rule.Action)" -eq 'Block') { Remove-NetFirewallRule -Name $n; Write-PackLog $stateDir "$($Pack.Id) removed block rule $n" }
        }
        # SEC-INFRA-9: everything is back as first recorded, so the next -Apply starts a new undo point.
        if (Test-Path $basePath) { Remove-Item -LiteralPath $basePath; Write-PackLog $stateDir "$($Pack.Id) undo point (baseline.json) cleared after the undo" }
        # SEC-INFRA-10: the last dry run is post-apply; leaving it would let the next dry run promote it as the undo point.
        if (Test-Path $statePath) { Remove-Item -LiteralPath $statePath; Write-PackLog $stateDir "$($Pack.Id) dry run record cleared after the undo (a fresh elevated dry run comes before any -Apply)" }
    }
}
