<#
.SYNOPSIS
  Read-only security probe of this PC (cadeyserver). SEC-INFRA-2 (normal) and SEC-INFRA-3 (deep).

.DESCRIPTION
  probe.ps1          normal level: any security chat may run it, no admin rights needed.
  probe.ps1 -Deep    deep level: only the Admin starts it, in an elevated window. It refuses to run without admin rights.

  It changes nothing, takes no other arguments, and runs no command it is handed. It writes
  reports\<yyyy-mm-dd>\probe-<normal|deep>-<HHmmss>.json and .txt. Secret values are stripped:
  it never reads service command lines, task arguments or environment values (names and lengths only),
  and every string passes Remove-Secrets. Check the folder with node C:\server\playbook\tools\check.js.

  Hooks: parts\disk.ps1 and parts\recovery.ps1 (Security · Resilience) are loaded if present. Each must
  define Get-ProbePart-<Name> -Deep:<bool> returning one object. Only these fixed names are loaded.
#>
[CmdletBinding()]
param([switch]$Deep)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $root 'lib\common.ps1')

$elevated = Test-Elevated
if ($Deep -and -not $elevated) { Write-Host 'The deep level needs an elevated window (Run as administrator). Nothing was read.'; exit 2 }
$level = if ($Deep) { 'deep' } else { 'normal' }

$report = [ordered]@{}
$errors = [ordered]@{}
function Add-Section([string]$name, [scriptblock]$read) {
    try { $report[$name] = & $read } catch { $errors[$name] = $_.Exception.Message.Split([Environment]::NewLine)[0] }
}

$procs = @{}
Get-CimInstance Win32_Process | ForEach-Object { $procs[[int]$_.ProcessId] = $_ }
function ProcName($id) { $p = $procs[[int]$id]; if ($p) { $p.Name } else { '?' } }
function ProcPath($id) { $p = $procs[[int]$id]; if ($p) { $p.ExecutablePath } else { $null } }

# ---------- normal level ----------
Add-Section 'meta' {
    $os = Get-CimInstance Win32_OperatingSystem
    [ordered]@{ host = $env:COMPUTERNAME; level = $level; elevated = $elevated; time = (Get-Date).ToString('s')
        os = "$($os.Caption) $($os.Version)"; freeMemoryMB = [int]($os.FreePhysicalMemory / 1024); totalMemoryMB = [int]($os.TotalVisibleMemorySize / 1024) }
}
Add-Section 'networks' {
    $prof = @{}; Get-NetConnectionProfile | ForEach-Object { $prof[$_.InterfaceAlias] = "$($_.NetworkCategory)" }
    @(Get-NetIPAddress -AddressFamily IPv4 | ForEach-Object { [ordered]@{ interface = $_.InterfaceAlias; address = $_.IPAddress; profile = $prof[$_.InterfaceAlias] } })
}
Add-Section 'tcpListen' {
    @(Get-NetTCPConnection -State Listen | Sort-Object LocalPort, LocalAddress | ForEach-Object {
        [ordered]@{ address = $_.LocalAddress; port = $_.LocalPort; process = (ProcName $_.OwningProcess); path = (ProcPath $_.OwningProcess)
            scope = if ($_.LocalAddress -in '127.0.0.1', '::1') { 'this PC' } elseif ($_.LocalAddress -in '0.0.0.0', '::') { 'every card' } else { 'one card' } } })
}
Add-Section 'udpEndpoints' {
    @(Get-NetUDPEndpoint | Where-Object { $_.LocalAddress -notin '127.0.0.1', '::1' -and $_.LocalPort -lt 49152 } | Sort-Object LocalPort | ForEach-Object {
        [ordered]@{ address = $_.LocalAddress; port = $_.LocalPort; process = (ProcName $_.OwningProcess) } })
}
Add-Section 'firewallInboundAllow' {
    $all = @(Get-InboundRulesNetsh)
    $on = @($all | Where-Object { $_.Enabled -eq 'Yes' -and $_.Action -eq 'Allow' })
    [ordered]@{ total = $all.Count; enabledAllow = $on.Count; remoteAny = @($on | Where-Object { $_.RemoteIP -eq 'Any' }).Count
        rules = @($on | ForEach-Object { [ordered]@{ name = $_.'Rule Name'; group = $_.Grouping; protocol = $_.Protocol; localPort = $_.LocalPort
            localIP = $_.LocalIP; remoteIP = $_.RemoteIP; profiles = $_.Profiles; edge = $_.'Edge traversal'; program = $_.Program } }) }
}
Add-Section 'remoteDesktop' {
    $ts = Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server'
    $rdp = Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp'
    [ordered]@{ on = ($ts.fDenyTSConnections -eq 0); nla = ($rdp.UserAuthentication -eq 1); port = $rdp.PortNumber }
}
Add-Section 'tailscale' {
    $t = tailscale status --json | ConvertFrom-Json
    $peers = @($t.Peer.psobject.Properties.Value)
    [ordered]@{ peers = $peers.Count; online = @($peers | Where-Object Online).Count; sharedIn = @($peers | Where-Object ShareeNode).Count
        otherUsers = @($peers | Where-Object { $_.UserID -ne $t.Self.UserID }).Count; exitNodeInUse = [bool]$t.ExitNodeStatus
        offersExitNode = [bool]$t.Self.ExitNodeOption; serve = ((tailscale serve status 2>&1) -join ' ') }
}
Add-Section 'tunnel' {
    $c = Invoke-RestMethod -TimeoutSec 5 'http://127.0.0.1:20241/config'
    @($c.config.ingress | ForEach-Object { [ordered]@{ hostname = $_.hostname; service = $_.service } })
}
Add-Section 'signposts' {
    @('C:\oak-world', 'C:\oak-world-work', 'C:\ai-workspace', 'C:\playbook' | ForEach-Object {
        $i = Get-Item $_ -Force; [ordered]@{ path = $_; type = "$($i.LinkType)"; target = "$($i.Target)" } })
}
Add-Section 'userEnvironmentSecrets' {
    $u = [Environment]::GetEnvironmentVariables('User')
    @($u.Keys | Where-Object { $_ -match 'KEY|TOKEN|SECRET|PASS|CODE' } | Sort-Object | ForEach-Object { [ordered]@{ name = $_; set = $true; length = "$($u[$_])".Length } })
}
Add-Section 'multipass' {
    @((multipass list --format json | ConvertFrom-Json).list | ForEach-Object { [ordered]@{ name = $_.name; state = $_.state; addresses = @($_.ipv4) } })
}

# ---------- deep level (elevated) ----------
if ($Deep) {
    Add-Section 'firewallFull' {
        $rules = Get-NetFirewallRule -Direction Inbound
        $ports = @{}; Get-NetFirewallPortFilter | ForEach-Object { $ports[$_.InstanceID] = $_ }
        $addrs = @{}; Get-NetFirewallAddressFilter | ForEach-Object { $addrs[$_.InstanceID] = $_ }
        $apps = @{}; Get-NetFirewallApplicationFilter | ForEach-Object { $apps[$_.InstanceID] = $_ }
        @($rules | ForEach-Object { $id = $_.Name
            [ordered]@{ id = $id; name = $_.DisplayName; group = $_.DisplayGroup; enabled = "$($_.Enabled)"; action = "$($_.Action)"; profile = "$($_.Profile)"
                protocol = $ports[$id].Protocol; localPort = @($ports[$id].LocalPort); remoteAddress = @($addrs[$id].RemoteAddress); localAddress = @($addrs[$id].LocalAddress)
                program = $apps[$id].Program; source = "$($_.PolicyStoreSourceType)" } })
    }
    Add-Section 'firewallProfiles' {
        @(Get-NetFirewallProfile | ForEach-Object { [ordered]@{ name = $_.Name; enabled = "$($_.Enabled)"; inbound = "$($_.DefaultInboundAction)"; allowLocalRules = "$($_.AllowLocalFirewallRules)"; log = "$($_.LogBlocked)" } })
    }
    Add-Section 'services' {
        # StartName only; never PathName (the cloudflared service's command line holds the tunnel token).
        @(Get-CimInstance Win32_Service | Sort-Object Name | ForEach-Object { [ordered]@{ name = $_.Name; state = $_.State; start = $_.StartMode; account = $_.StartName } })
    }
    Add-Section 'scheduledTasks' {
        # The program only, never its arguments.
        @(Get-ScheduledTask | Where-Object { $_.TaskPath -notlike '\Microsoft\*' } | ForEach-Object {
            [ordered]@{ path = "$($_.TaskPath)$($_.TaskName)"; state = "$($_.State)"; user = $_.Principal.UserId; runLevel = "$($_.Principal.RunLevel)"
                programs = @($_.Actions | ForEach-Object { $_.Execute }); triggers = @($_.Triggers | ForEach-Object { $_.CimClass.CimClassName -replace 'MSFT_Task|Trigger', '' }) } })
    }
    Add-Section 'localUsers' {
        @(Get-LocalUser | ForEach-Object { [ordered]@{ name = $_.Name; enabled = $_.Enabled; passwordRequired = $_.PasswordRequired; lastLogon = "$($_.LastLogon)" } })
    }
    Add-Section 'localGroups' {
        $g = [ordered]@{}
        foreach ($sid in 'S-1-5-32-544', 'S-1-5-32-555', 'S-1-5-32-578') {   # Administrators, Remote Desktop Users, Hyper-V Administrators
            $grp = Get-LocalGroup -SID $sid -ErrorAction SilentlyContinue
            if ($grp) { $g[$grp.Name] = @(Get-LocalGroupMember -SID $sid -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Name) ($($_.ObjectClass))" }) }
        }
        $g
    }
    Add-Section 'securityLogCounts' {
        # Counts per event ID over 7 days; no message bodies.
        $since = (Get-Date).AddDays(-7); $c = [ordered]@{}
        foreach ($id in 4624, 4625, 4740, 4720, 4732, 1149) {
            $log = if ($id -eq 1149) { 'Microsoft-Windows-TerminalServices-RemoteConnectionManager/Operational' } else { 'Security' }
            $c["$id"] = @(Get-WinEvent -FilterHashtable @{ LogName = $log; Id = $id; StartTime = $since } -ErrorAction SilentlyContinue).Count
        }
        $c
    }
    Add-Section 'smb' {
        $cfg = Get-SmbServerConfiguration
        [ordered]@{ smb1 = $cfg.EnableSMB1Protocol; signingRequired = $cfg.RequireSecuritySignature; encrypt = $cfg.EncryptData
            shares = @(Get-SmbShare | ForEach-Object { $n = $_.Name
                [ordered]@{ name = $n; path = $_.Path; access = @(Get-SmbShareAccess -Name $n | ForEach-Object { "$($_.AccountName): $($_.AccessControlType) $($_.AccessRight)" }) } }) }
    }
    Add-Section 'bitlocker' {
        @(Get-BitLockerVolume | ForEach-Object { [ordered]@{ drive = $_.MountPoint; protection = "$($_.ProtectionStatus)"; status = "$($_.VolumeStatus)"; protectors = @($_.KeyProtector | ForEach-Object { "$($_.KeyProtectorType)" }) } })
    }
    Add-Section 'defender' {
        $d = Get-MpComputerStatus
        [ordered]@{ realTime = $d.RealTimeProtectionEnabled; antivirus = $d.AntivirusEnabled; signaturesAgeDays = $d.AntivirusSignatureAge; lastQuickScan = "$($d.QuickScanEndTime)"; tamperProtected = $d.IsTamperProtected }
    }
    Add-Section 'windowsUpdate' {
        $h = Get-HotFix | Sort-Object InstalledOn -Descending
        [ordered]@{ lastInstalled = "$(($h | Select-Object -First 1).InstalledOn)"; count = @($h).Count; latest = @($h | Select-Object -First 5 | ForEach-Object { "$($_.HotFixID) $($_.InstalledOn)" }) }
    }
    Add-Section 'disks' {
        @(Get-PhysicalDisk | ForEach-Object { $r = $_ | Get-StorageReliabilityCounter -ErrorAction SilentlyContinue
            [ordered]@{ name = $_.FriendlyName; media = "$($_.MediaType)"; health = "$($_.HealthStatus)"; status = "$($_.OperationalStatus)"
                temperatureC = $r.Temperature; wear = $r.Wear; readErrors = $r.ReadErrorsTotal; writeErrors = $r.WriteErrorsTotal; powerOnHours = $r.PowerOnHours } })
    }
    Add-Section 'hyperV' {
        [ordered]@{ vms = @(Get-VM | ForEach-Object { $vm = $_
                [ordered]@{ name = $vm.Name; state = "$($vm.State)"; adapters = @($vm | Get-VMNetworkAdapter | ForEach-Object { [ordered]@{ switch = $_.SwitchName; addresses = @($_.IPAddresses) } }) } })
            switches = @(Get-VMSwitch | ForEach-Object { [ordered]@{ name = $_.Name; type = "$($_.SwitchType)"; adapter = $_.NetAdapterInterfaceDescription; sharedWithHost = $_.AllowManagementOS } }) }
    }
    Add-Section 'portsByService' {
        $svc = @{}; Get-CimInstance Win32_Service | Where-Object ProcessId | ForEach-Object { $svc[[int]$_.ProcessId] += @($_.Name) }
        @(Get-NetTCPConnection -State Listen | Sort-Object LocalPort | ForEach-Object { [ordered]@{ address = $_.LocalAddress; port = $_.LocalPort; process = (ProcName $_.OwningProcess); services = @($svc[[int]$_.OwningProcess]) } })
    }
}

# ---------- hooks for Security · Resilience (fixed names only) ----------
foreach ($part in 'disk', 'recovery') {
    $file = Join-Path $PSScriptRoot "parts\$part.ps1"
    if (Test-Path $file) {
        Add-Section "part-$part" { . $file; & "Get-ProbePart-$part" -Deep:$Deep }
    }
}

# ---------- write ----------
$clean = Remove-SecretsDeep $report
$out = [ordered]@{ report = $clean; errors = $errors }
$dir = Join-Path $root ("reports\" + (Get-Date -Format 'yyyy-MM-dd'))
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$base = Join-Path $dir ("probe-$level-" + (Get-Date -Format 'HHmmss'))
$out | ConvertTo-Json -Depth 8 | Out-File -Encoding utf8 "$base.json"

$txt = New-Object System.Collections.Generic.List[string]
$txt.Add("Security probe, $level level, $($clean.meta.time) on $($clean.meta.host) (elevated: $elevated)")
foreach ($k in $clean.Keys) {
    $txt.Add(''); $txt.Add("== $k")
    $v = $clean[$k]
    if ($v -is [System.Collections.IDictionary]) { foreach ($kk in $v.Keys) { $vv = $v[$kk]; if ($vv -is [array] -and $vv.Count -and $vv[0] -is [System.Collections.IDictionary]) { $txt.Add("${kk}:"); foreach ($r in $vv) { $txt.Add('  ' + (($r.Keys | ForEach-Object { "$_=$(@($r[$_]) -join ',')" }) -join ' | ')) } } else { $txt.Add("${kk}: $(@($vv) -join ', ')") } } }
    elseif ($v -is [array]) { foreach ($r in $v) { if ($r -is [System.Collections.IDictionary]) { $txt.Add((($r.Keys | ForEach-Object { "$_=$(@($r[$_]) -join ',')" }) -join ' | ')) } else { $txt.Add("$r") } } }
    else { $txt.Add("$v") }
}
if ($errors.Count) { $txt.Add(''); $txt.Add('== could not read'); foreach ($k in $errors.Keys) { $txt.Add("${k}: $($errors[$k])") } }
$txt | Out-File -Encoding utf8 "$base.txt"
Write-Host "Written: $base.txt and .json ($($clean.Keys.Count) sections, $($errors.Count) not readable)"
