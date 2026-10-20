# SEC-FIX-10 check (read-only, no admin rights): the SMB server requires signing.
$env:PSModulePath = "$env:windir\System32\WindowsPowerShell\v1.0\Modules"   # R1: before any cmdlet that autoloads a module
$ErrorActionPreference = 'Stop'
$v = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Services\LanmanServer\Parameters' -ErrorAction SilentlyContinue).RequireSecuritySignature
if ($v -eq 1) { Write-Host 'PASS: the SMB server requires signing.'; exit 0 }
Write-Host "FAIL: the SMB server does not require signing (RequireSecuritySignature = $v)."; exit 1
