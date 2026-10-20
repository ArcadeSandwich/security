# SEC-FIX-2 check (read-only, no admin rights): no enabled allow rule opens 2179.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path $root 'lib\common.ps1')
$rules = @(Get-OpenRulesForPort 2179)
foreach ($r in $rules) { Write-Host "  still on: $($r.'Rule Name') | $($r.Protocol) | remote $($r.RemoteIP)" }
if ($rules.Count) { Write-Host "FAIL: $($rules.Count) enabled allow rule(s) on 2179."; exit 1 }
Write-Host 'PASS: no enabled allow rule on 2179.'
