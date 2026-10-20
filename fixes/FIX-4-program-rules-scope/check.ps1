# SEC-FIX-4 check (read-only, no admin rights): no enabled allow rule for the listed programs has Remote IP Any,
# and no HNS container DNS rule has Remote IP Any. Run it again after every restart: Windows may recreate HNS rules.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path $root 'lib\common.ps1')
$programs = 'ollama.exe', 'obs64.exe', 'obs-browser-page.exe', 'node.exe', 'bun.exe', 'bunx.exe'
$on = @(Get-InboundRulesNetsh | Where-Object { $_.Enabled -eq 'Yes' -and $_.Action -eq 'Allow' -and $_.RemoteIP -eq 'Any' })
$bad = @($on | Where-Object { ($_.Program -and ($programs -contains [IO.Path]::GetFileName($_.Program).ToLower())) -or $_.'Rule Name'.StartsWith('HNS Container Networking - DNS') -or $_.'Rule Name'.StartsWith('HNS Container Networking - ICS DNS') })
foreach ($r in $bad) { Write-Host "  still Any: $($r.'Rule Name') | $($r.Protocol) $($r.LocalPort) | profiles $($r.Profiles)" }
if ($bad.Count) { Write-Host "FAIL: $($bad.Count) rule(s) still allow Any."; exit 1 }
Write-Host 'PASS: no program rule in the list and no HNS DNS rule allows Any.'
