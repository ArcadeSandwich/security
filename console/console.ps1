# SEC-INFRA-5, stage 1 (normal rights): list ready packs, show each README, run its dry run, ask yes or no.
# Then start apply.ps1 ONCE, elevated, with only the chosen pack names; it checks each name again before running it.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

Write-Log '=== Security fixes console started ==='
$ready = Get-ReadyPacks
$chosen = @()
if ($ready.Count -eq 0) { Write-Log 'No fix pack is ready.' }
foreach ($name in $ready) {
  Write-Host ''
  Write-Host "================ $name ================"
  Get-Content -LiteralPath (Join-Path (Join-Path $FixesDir $name) 'README.md') | ForEach-Object { Write-Host $_ }
  Write-Log "Dry run of $name (fix.ps1 sha256 $(Get-PackHash $name))"
  if (-not (Invoke-PackScript $name 'fix.ps1' 'DryRun')) { Write-Log "Dry run of $name failed: it will not be offered."; continue }
  if (Read-YesNo "Apply $name") { $chosen += $name; Write-Log "Admin chose YES for $name" } else { Write-Log "Admin chose NO for $name" }
}

$deep = $false
if (Test-Path -LiteralPath (Join-Path $ProbeDir 'probe.ps1') -PathType Leaf) {
  Write-Host ''
  $deep = Read-YesNo 'Also run the deep probe (read-only) in the same elevated window'
  Write-Log "Deep probe: $(if ($deep) { 'YES' } else { 'NO' })"
}

if ($chosen.Count -eq 0 -and -not $deep) { Write-Log 'Nothing to apply. Done.'; exit 0 }

$apply = Join-Path $PSScriptRoot 'apply.ps1'
$argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$apply`"")
if ($chosen.Count) { $argList += @('-Packs', ($chosen -join ',')) }
if ($deep) { $argList += '-Deep' }
Write-Log "Asking Windows for one elevated window: $($chosen -join ', ')$(if ($deep) { ' + deep probe' })"
try {
  $p = Start-Process powershell.exe -Verb RunAs -ArgumentList $argList -Wait -PassThru
  Write-Log "Elevated window finished (exit $($p.ExitCode)). Results are in $(Get-LogFile)"
} catch {
  Write-Log 'Windows permission was refused or cancelled: nothing was applied.'
}
