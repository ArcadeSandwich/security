$env:PSModulePath = "$env:windir\System32\WindowsPowerShell\v1.0\Modules" # R1: only the system modules, never a planted one (set before anything autoloads)
# SEC-INFRA-5, stage 1 (normal rights): list ready packs, show each README, run its dry run, ask yes or no.
# Then start apply.ps1 ONCE, elevated, with only the chosen "pack=hash" pairs; it checks each pack and hash again.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

Write-Log "=== Security fixes console started by $(Get-Who) ==="
# Only committed tools may run: any uncommitted change in fixes, console or probe stops the console.
$dirty = & $Git -C $Root status --porcelain -- fixes console probe 2>&1
if ($LASTEXITCODE -ne 0 -or $dirty) {
  Write-Log 'STOPPED: the security folder has uncommitted changes (or git could not read it), so no fix is offered. Ask Security to commit or remove them first.'
  foreach ($l in $dirty) { Write-Log "  $l" }
  exit 1
}
Write-Log "Security tools at commit $(& $Git -C $Root log -1 --format=%h); APPROVED.sha256 is $(if (Test-Path -LiteralPath $ApprovedFile) { Get-FileSha $ApprovedFile } else { 'missing' }) (compare both with the desk card)"

$ready = Get-ReadyPacks
$chosen = @()
if ($ready.Count -eq 0) { Write-Log 'No fix pack is ready.' }
foreach ($name in $ready) {
  Write-Host ''
  Write-Host "================ $name ================"
  Get-Content -LiteralPath (Join-Path (Join-Path $FixesDir $name) 'README.md') | ForEach-Object { Write-Host $_ }
  $hash = Get-PackHash $name
  Write-Log "Dry run of $name (fix.ps1 sha256 $hash)"
  if (-not (Invoke-PackScript $Root $name 'fix.ps1' 'DryRun')) { Write-Log "Dry run of $name failed: it will not be offered."; continue }
  if (Read-YesNo "Apply $name") { $chosen += "$name=$hash"; Write-Log "$(Get-Who) chose YES for $name" } else { Write-Log "$(Get-Who) chose NO for $name" }
}

$deep = $false
if (Test-Path -LiteralPath (Join-Path $ProbeDir 'probe.ps1') -PathType Leaf) {
  if (Test-ProbeApproved) {
    Write-Host ''
    $deep = Read-YesNo 'Also run the deep probe (read-only) in the same elevated window'
    Write-Log "Deep probe: $(if ($deep) { 'YES' } else { 'NO' }) ($(Get-Who))"
  } else { Write-Log 'The deep probe is not approved (APPROVED.sha256): not offered.' }
}

Write-Host ''
$undo = Read-YesNo 'Undo a pack applied earlier (shows the list in the elevated window)'
Write-Log "Undo menu: $(if ($undo) { 'YES' } else { 'NO' }) ($(Get-Who))"

if ($chosen.Count -eq 0 -and -not $deep -and -not $undo) { Write-Log 'Nothing to apply. Done.'; exit 0 }

$apply = Join-Path $PSScriptRoot 'apply.ps1'
$argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$apply`"")
if ($chosen.Count) { $argList += @('-Packs', ($chosen -join ',')) }
if ($deep) { $argList += '-Deep' }
if ($undo) { $argList += '-UndoMenu' }
# apply.ps1 and common.ps1 must be the approved versions before Windows is even asked (apply.ps1 checks itself again).
if (-not (Test-ConsoleApproved)) { Write-Log 'STOPPED: console\apply.ps1 or common.ps1 is not the approved version (APPROVED.sha256). Nothing was applied.'; exit 1 }
Write-Log "Asking Windows for one elevated window: $(($chosen | ForEach-Object { $_.Split('=')[0] }) -join ', ')$(if ($deep) { ' + deep probe' })"
try {
  $p = Start-Process "$PSHOME\powershell.exe" -Verb RunAs -ArgumentList $argList -Wait -PassThru
  Write-Log "Elevated window finished (exit $($p.ExitCode)). Results are in $(Get-LogFile)"
} catch {
  Write-Log 'Windows permission was refused or cancelled: nothing was applied.'
}
