# Probe section: disk and recovery (SEC-INFRA-2/3, by Security · Resilience). Read-only, normal user rights.
# Dot-source it, then call Get-DiskRecoveryProbe. It returns objects: Section, Check, Status (ok|warn|high|gap), Detail.
# It never prints keys, codes or passwords, and never reads file contents.

function Get-DiskRecoveryProbe {
  $out = [System.Collections.Generic.List[object]]::new()
  function Add($check, $status, $detail) { $out.Add([pscustomobject]@{ Section = 'disk-recovery'; Check = $check; Status = $status; Detail = $detail }) }

  # Volumes: health and free space (20% free on C: is the line).
  foreach ($v in Get-Volume | ? DriveLetter) {
    $pct = if ($v.Size) { [math]::Round(100 * $v.SizeRemaining / $v.Size) } else { 0 }
    $st = if ($v.HealthStatus -ne 'Healthy') { 'high' } elseif ($pct -lt 20) { 'warn' } else { 'ok' }
    Add "volume $($v.DriveLetter):" $st "health $($v.HealthStatus), $pct% free of $([int]($v.Size/1GB)) GB"
  }
  foreach ($d in Get-PhysicalDisk) { Add "disk $($d.FriendlyName)" ($(if ($d.HealthStatus -eq 'Healthy') { 'ok' } else { 'high' })) "$($d.HealthStatus)/$($d.OperationalStatus)" }
  try { Get-PhysicalDisk | Get-StorageReliabilityCounter -ErrorAction Stop | Out-Null; Add 'reliability counters' 'ok' 'readable' }
  catch { Add 'reliability counters' 'gap' 'needs administrator rights (deep probe)' }

  # Disk errors in the System log, last 30 days.
  $ev = @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'disk', 'Ntfs', 'storahci', 'stornvme'; StartTime = (Get-Date).AddDays(-30) } -ErrorAction SilentlyContinue)
  Add 'disk errors 30d' ($(if ($ev.Count) { 'warn' } else { 'ok' })) ("{0} events{1}" -f $ev.Count, $(if ($ev.Count) { ", newest $($ev[0].TimeCreated)" }))

  # Unexpected shutdowns, last 30 days (Kernel-Power 41): blue screen or power button.
  $kp = @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; Id = 41; StartTime = (Get-Date).AddDays(-30) } -ErrorAction SilentlyContinue)
  $btn = @($kp | ? { ([xml]$_.ToXml()).Event.EventData.Data | ? { $_.Name -eq 'PowerButtonTimestamp' -and $_.'#text' -ne '0' } }).Count
  $bsod = @($kp | ? { ([xml]$_.ToXml()).Event.EventData.Data | ? { $_.Name -eq 'BugcheckCode' -and $_.'#text' -ne '0' } }).Count
  Add 'unexpected shutdowns 30d' ($(if ($kp.Count -gt 2) { 'warn' } else { 'ok' })) "$($kp.Count) (blue screen $bsod, power button held $btn)"
  Add 'last boot' 'ok' "$((Get-CimInstance Win32_OperatingSystem).LastBootUpTime)"

  # Startup tasks: start at boot without sign-in, restart on failure (FIX-5 / W-22).
  foreach ($n in 'Startup - Oak World Game', 'Startup - Oak World Work', 'Startup - Ollama') {
    $t = Get-ScheduledTask -TaskName $n -TaskPath '\' -ErrorAction SilentlyContinue
    if (-not $t) { Add "task $n" 'high' 'missing'; continue }
    $boot = [bool]($t.Triggers | ? { $_.CimClass.CimClassName -eq 'MSFT_TaskBootTrigger' })
    $st = if (-not $boot -and $t.Principal.LogonType -eq 'Interactive') { 'high' } elseif ($t.Settings.RestartCount -lt 1) { 'warn' } else { 'ok' }
    Add "task $n" $st "state $($t.State), boot trigger $boot, logon $($t.Principal.LogonType), restart $($t.Settings.RestartCount)"
  }
  $auto = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' -Name AutoAdminLogon -ErrorAction SilentlyContinue).AutoAdminLogon
  Add 'automatic sign-in' 'ok' ($(if ($auto -eq '1') { 'on' } else { 'off' }))

  # Services listening.
  foreach ($p in @{ 3000 = 'game'; 3001 = 'work'; 11434 = 'ollama'; 7420 = 'prompt generator (by hand)' }.GetEnumerator()) {
    $l = Get-NetTCPConnection -State Listen -LocalPort $p.Key -ErrorAction SilentlyContinue | Select -First 1
    Add "port $($p.Key) $($p.Value)" ($(if ($l) { 'ok' } else { 'high' })) ($(if ($l) { "listening on $($l.LocalAddress)" } else { 'not listening' }))
  }

  # Signposts.
  foreach ($s in 'C:\oak-world', 'C:\oak-world-work', 'C:\ai-workspace', 'C:\playbook') {
    $i = Get-Item $s -ErrorAction SilentlyContinue
    $okp = $i -and $i.LinkType -eq 'Junction' -and "$($i.Target)" -like 'C:\server\*'
    Add "signpost $s" ($(if ($okp) { 'ok' } else { 'high' })) ($(if ($i) { "$($i.LinkType) -> $($i.Target)" } else { 'missing' }))
  }

  # Backups: newest game backup age (names and dates only).
  $b = Get-ChildItem 'C:\server\oak-world\oak-world\backups' -Recurse -File -ErrorAction SilentlyContinue | Sort LastWriteTime -Desc | Select -First 1
  $age = if ($b) { [int]((Get-Date) - $b.LastWriteTime).TotalDays } else { -1 }
  Add 'game backup newest' ($(if ($age -ge 0 -and $age -le 1) { 'ok' } else { 'warn' })) ($(if ($b) { "$age days old" } else { 'none found' }))
  Add 'off-PC backup (BACKUP-1)' 'gap' 'log is on the main PC: ask the Admin'

  # Windows Update: newest installed update and a pending restart.
  $hf = Get-HotFix -ErrorAction SilentlyContinue | ? InstalledOn | Sort InstalledOn -Desc | Select -First 1
  Add 'windows update newest' ($(if ($hf -and ((Get-Date) - $hf.InstalledOn).TotalDays -le 45) { 'ok' } else { 'warn' })) ($(if ($hf) { "$($hf.HotFixID) on $($hf.InstalledOn.ToString('yyyy-MM-dd'))" } else { 'unknown' }))
  $pend = Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired'
  Add 'restart pending' ($(if ($pend) { 'warn' } else { 'ok' })) ($(if ($pend) { 'yes: a Windows Update restart is waiting' } else { 'no' }))

  $out
}
