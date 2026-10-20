# SEC-FIX-3 check (read-only, no admin rights): every block rule of this pack exists, is on, blocks, and is
# limited to the Tailscale local addresses.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path $root 'lib\common.ps1')
$names = 'netbios-tcp-139', 'netbios-udp-137-138', 'smb-tcp-445', 'hyperv-tcp-2179', 'obs-tcp-4455', 'cdp-tcp-5040', 'wsd-tcp-5357', 'do-tcp-7680' | ForEach-Object { "SEC-FIX-3-$_" }
$all = @(Get-InboundRulesNetsh)
$fail = 0
foreach ($n in $names) {
    $r = @($all | Where-Object { $_.'Rule Name' -eq $n })
    $ok = $r.Count -eq 1 -and $r[0].Enabled -eq 'Yes' -and $r[0].Action -eq 'Block' -and (Test-RemoteIPWithin $r[0].LocalIP)
    if ($ok) { Write-Host "  ok: $n | $($r[0].Protocol) $($r[0].LocalPort) | local $($r[0].LocalIP)" } else { Write-Host "  MISSING or wrong: $n"; $fail = 1 }
}
if ($fail) { Write-Host 'FAIL: not every block rule is in place.' } else { Write-Host "PASS: all $($names.Count) block rules in place on the Tailscale addresses." }
exit $fail
