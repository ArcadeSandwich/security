# FIX-5 check: read-only. PASS when each startup task starts at boot without sign-in and restarts on failure.
$ErrorActionPreference = 'Stop'
$Tasks = 'Startup - Oak World Game', 'Startup - Oak World Work', 'Startup - Ollama'
$fail = 0
foreach ($n in $Tasks) {
  $t = Get-ScheduledTask -TaskName $n -TaskPath '\' -ErrorAction SilentlyContinue
  if (-not $t) { "FAIL [$n] task missing"; $fail++; continue }
  $boot = [bool]($t.Triggers | ? { $_.CimClass.CimClassName -eq 'MSFT_TaskBootTrigger' -and $_.Enabled })
  $nosign = $t.Principal.LogonType -in 'Password', 'S4U', 'ServiceAccount'
  $restart = $t.Settings.RestartCount -ge 1 -and $t.Settings.RestartInterval
  $info = $t | Get-ScheduledTaskInfo
  $ok = $boot -and $nosign -and $restart
  if (-not $ok) { $fail++ }
  "{0} [{1}] boot={2} runs-without-sign-in={3} restart-on-failure={4} state={5} last-result={6}" -f ($(if ($ok) { 'PASS' } else { 'FAIL' })), $n, $boot, $nosign, [bool]$restart, $t.State, $info.LastTaskResult
}
$auto = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' -Name AutoAdminLogon -ErrorAction SilentlyContinue).AutoAdminLogon
"info automatic sign-in (AutoAdminLogon) = $(if ($auto -eq '1') { 'on' } else { 'off' })"
"info last boot: $((Get-CimInstance Win32_OperatingSystem).LastBootUpTime)"
foreach ($p in 3000, 3001, 11434) {
  $l = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue | Select -First 1
  "info port ${p}: $(if ($l) { "listening on $($l.LocalAddress)" } else { 'NOT listening' })"
}
if ($fail) { "RESULT: FAIL ($fail of $($Tasks.Count))"; exit 1 } else { 'RESULT: PASS' }
