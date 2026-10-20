# SEC-FIX-2 check (read-only, no admin rights): no enabled allow rule opens 2179, and every enabled allow rule
# on 135 is limited to Tailscale.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path $root 'lib\common.ps1')
$fail = 0
$r2179 = @(Get-OpenRulesForPort 2179)
foreach ($r in $r2179) { Write-Host "  still on (2179): $($r.'Rule Name') | remote $($r.RemoteIP)" }
if ($r2179.Count) { Write-Host "FAIL: $($r2179.Count) enabled allow rule(s) on 2179."; $fail = 1 } else { Write-Host 'PASS: no enabled allow rule on 2179.' }
$r135 = @(Get-OpenRulesForPort 135)
$bad = @($r135 | Where-Object { -not (Test-RemoteIPWithin $_.RemoteIP) })
foreach ($r in $r135) { Write-Host "  135: $($r.'Rule Name') | profiles $($r.Profiles) | remote $($r.RemoteIP)" }
if ($bad.Count) { Write-Host "FAIL: $($bad.Count) rule(s) on 135 open wider than Tailscale."; $fail = 1 } else { Write-Host "PASS: $($r135.Count) rule(s) on 135, all limited to Tailscale." }
exit $fail
