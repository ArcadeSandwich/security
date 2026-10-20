# SEC-INFRA-5, stage 2 (started elevated by console.ps1 only). Applies each named pack, then runs its check.ps1.
# Every name is checked again here: a name that is malformed or not ready is refused, never run.
param([string]$Packs = '', [switch]$Deep)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$failed = 0
Write-Log '--- elevated window started ---'
foreach ($name in ($Packs -split ',' | Where-Object { $_ })) {
  if (-not (Test-Ready $name)) { Write-Log "REFUSED $name : not a ready pack"; $failed++; continue }
  Write-Log "Applying $name (fix.ps1 sha256 $(Get-PackHash $name))"
  if (-not (Invoke-PackScript $name 'fix.ps1' 'Apply')) { Write-Log "FAILED $name : fix.ps1 -Apply did not succeed"; $failed++; continue }
  if (Invoke-PackScript $name 'check.ps1' '') { Write-Log "OK $name : check passed" } else { Write-Log "CHECK FAILED $name : see above; its README says how to undo"; $failed++ }
}
if ($Deep) {
  $probe = Join-Path $ProbeDir 'probe.ps1'
  if (Test-Path -LiteralPath $probe -PathType Leaf) {
    Write-Log 'Running the deep probe (read-only)'
    $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $probe -Deep 2>&1
    foreach ($l in $out) { Write-Log "  [probe] $l" }
  } else { Write-Log 'Deep probe not found: skipped' }
}
Write-Log "--- elevated window done: $failed problem(s) ---"
Write-Host ''
Write-Host 'Press Enter to close this window.'
[void][Console]::ReadLine()
exit $failed
