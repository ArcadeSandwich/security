# SEC-FIX-1 check (read-only, no admin rights): every enabled allow rule on 3389 is limited to Tailscale.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path $root 'lib\common.ps1')
$rules = @(Get-OpenRulesForPort 3389)
$bad = @($rules | Where-Object { $_.RemoteIP -notmatch '^(100\.64\.0\.0/10|100\.64\.0\.0-100\.127\.255\.255)(,\s*fd7a:115c:a1e0::/48)?$' -and $_.RemoteIP -notmatch '^fd7a' })
foreach ($r in $rules) { Write-Host "  $($r.'Rule Name') | $($r.Protocol) | remote $($r.RemoteIP)" }
if ($bad.Count) { Write-Host "FAIL: $($bad.Count) rule(s) on 3389 still open wider than Tailscale."; exit 1 }
Write-Host "PASS: $($rules.Count) rule(s) on 3389, all limited to Tailscale (or none enabled)."
