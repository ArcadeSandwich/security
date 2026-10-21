# SEC-INFRA-5, stage 2 (started elevated by console.ps1 only).
# -Packs holds "pack=hash" pairs (the fix.ps1 hash stage 1 showed for the dry run). -UndoMenu offers packs that have state.
# Everything runs from a fresh admin-only copy under C:\ProgramData\SecurityConsole\<run id>; the copy is deleted at the end.
param([string]$Packs = '', [switch]$Deep, [switch]$UndoMenu)
$env:PSModulePath = "$env:windir\System32\WindowsPowerShell\v1.0\Modules" # R1: only the system modules, never a planted one (set before anything autoloads)
$ErrorActionPreference = 'Stop'

# Check this script and common.ps1 against APPROVED.sha256 BEFORE loading common.ps1.
$root0 = Split-Path -Parent $PSScriptRoot
$want = @{}
foreach ($l in Get-Content -LiteralPath (Join-Path $root0 'fixes\APPROVED.sha256') -ErrorAction SilentlyContinue) {
  $p = $l.Trim() -split '\s+'; if ($p.Count -eq 2 -and -not $l.Trim().StartsWith('#')) { $want[$p[0].ToLower()] = $p[1].ToUpper() }
}
foreach ($f in 'apply.ps1', 'common.ps1') {
  $h = (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $f) -Algorithm SHA256).Hash
  if ($want["console/$f"] -ne $h) { Write-Host "STOPPED: console\$f is not the approved version. Nothing was run."; [void][Console]::ReadLine(); exit 99 }
}
. (Join-Path $PSScriptRoot 'common.ps1')

$failed = 0
$stopped = $false
# SEC-INFRA-7: any error below is caught, shown and logged; the log is copied out and the window waits for Enter.
try {
Write-Log "--- elevated window started by $(Get-Who) ---"

# 1. Which packs: each must still be ready and approved, and its fix.ps1 must be the one the Admin saw in the dry run.
$run = @()
foreach ($pair in ($Packs -split ',' | Where-Object { $_ })) {
  $name, $hash = $pair -split '=', 2
  if (-not $hash -or $hash -notmatch $HashRe) { Write-Log "REFUSED $name : no valid dry-run hash"; $failed++; continue }
  if (-not (Test-Ready $name)) { Write-Log "REFUSED $name : not a ready, approved pack"; $failed++; continue }
  if ((Get-PackHash $name) -ne $hash) { Write-Log "REFUSED $name : fix.ps1 changed since the dry run"; $failed++; continue }
  $run += $name
}

if (-not (Test-Elevated)) { Write-Log 'STOPPED: this window is not elevated. Nothing was run.'; exit 98 }

# 2. The admin-only folders: state (kept) and this run's copy (deleted at the end).
Initialize-AdminOnlyDir $ConsoleData
Initialize-AdminOnlyDir $StateRoot
$runDir = Join-Path $ConsoleData ('run-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
Initialize-AdminOnlyDir $runDir
Write-Log "Run copy: $runDir"

try {
  # 3. Each pack: copy, check the copy, then -DryRun (records state), -Apply, check.ps1; offer -Undo if the check fails.
  foreach ($name in $run) {
    if (-not (Copy-Approved (Get-PackFiles $name) $runDir) -or (Get-FileSha (Join-Path $runDir "fixes\$name\fix.ps1")) -ne (($Packs -split ',' | Where-Object { $_ -like "$name=*" }) -split '=', 2)[1]) {
      Write-Log "REFUSED $name : the copy does not match"; $failed++; continue
    }
    Write-Log "Applying $name from the admin-only copy"
    if (-not (Invoke-PackScript $runDir $name 'fix.ps1' 'DryRun')) { Write-Log "FAILED $name : elevated -DryRun did not succeed; not applied"; $failed++; continue }
    if (-not (Invoke-PackScript $runDir $name 'fix.ps1' 'Apply')) { Write-Log "FAILED $name : fix.ps1 -Apply did not succeed"; $failed++ }
    elseif (Invoke-PackScript $runDir $name 'check.ps1' '') { Write-Log "OK $name : check passed"; continue }
    else { Write-Log "CHECK FAILED $name"; $failed++ }
    if (Read-YesNo "$name did not finish cleanly. Undo $name now") {
      Write-Log "$(Get-Who) chose UNDO for $name"
      if (Invoke-PackScript $runDir $name 'fix.ps1' 'Undo') { Write-Log "UNDONE $name" } else { Write-Log "UNDO FAILED $name : follow its README by hand" }
    } else { Write-Log "$(Get-Who) chose to keep $name as it is" }
  }

  # 4. Undo a pack: packs with saved state (a folder named after the pack in state\), each still ready and approved.
  if ($UndoMenu) {
    $withState = @(Get-ChildItem -LiteralPath $StateRoot -Directory | Where-Object { $_.Name -match $PackName } | ForEach-Object { $_.Name })
    if ($withState.Count -eq 0) { Write-Log 'No pack has saved state: nothing to undo.' }
    foreach ($name in $withState) {
      if (-not (Test-Ready $name)) { Write-Log "Undo of $name not offered: not a ready, approved pack"; continue }
      if (-not (Read-YesNo "Undo $name")) { Write-Log "$(Get-Who) chose NO undo for $name"; continue }
      if (-not (Copy-Approved (Get-PackFiles $name) $runDir)) { Write-Log "REFUSED undo of $name : the copy does not match"; $failed++; continue }
      Write-Log "$(Get-Who) chose UNDO for $name"
      if (Invoke-PackScript $runDir $name 'fix.ps1' 'Undo') { Write-Log "UNDONE $name" } else { Write-Log "UNDO FAILED $name"; $failed++ }
    }
  }

  # 5. The deep probe, from the copy.
  if ($Deep) {
    if ((Test-ProbeApproved) -and (Copy-Approved (Get-ProbeFiles) $runDir)) {
      Write-Log 'Running the deep probe (read-only)'
      $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue' # SEC-INFRA-7: a stderr line must not end the run
      try { $out = & "$PSHOME\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File (Join-Path $runDir 'probe\probe.ps1') -Deep 2>&1 } finally { $ErrorActionPreference = $old }
      foreach ($l in $out) { if ($l -is [System.Management.Automation.ErrorRecord]) { Write-Log "  [probe] (error) $($l.Exception.Message)" } else { Write-Log "  [probe] $l" } }
    } else { Write-Log 'REFUSED deep probe: missing or not approved (APPROVED.sha256)'; $failed++ }
  }
} finally {
  # R2: the deep probe writes its reports inside the copy; bring them out before the copy goes.
  $probeReports = Join-Path $runDir 'reports'
  if (Test-Path -LiteralPath $probeReports) { Copy-OutSafely $probeReports (Join-Path $Root 'reports') }
  # Only this run's own folder, checked by name, is removed.
  if ($runDir -like (Join-Path $ConsoleData 'run-*') -and (Test-Path -LiteralPath $runDir)) { Remove-Item -LiteralPath $runDir -Recurse -Force }
  Write-Log "Run copy removed: $(-not (Test-Path -LiteralPath $runDir))"
}
} catch {
  $stopped = $true
  $msg = "STOPPED by an error, so the packs after this point were not run: $($_.Exception.Message) ($(Split-Path -Leaf "$($_.InvocationInfo.ScriptName)") line $($_.InvocationInfo.ScriptLineNumber))"
  try { Write-Log $msg } catch { Write-Host $msg -ForegroundColor Red }
}
try { Write-Log "--- elevated window done: $failed problem(s)$(if ($stopped) { ', stopped by an error' }) ---"; Copy-LogOut } catch { Write-Host "The log could not be copied out: $($_.Exception.Message)" -ForegroundColor Red }
Write-Host ''
Write-Host 'Press Enter to close this window.'
[void][Console]::ReadLine()
# Exit codes: 0 all fine; 1-89 the number of packs with a problem; 97 stopped by an error; 98 not elevated; 99 not approved.
if ($stopped) { exit 97 }
exit ([Math]::Min($failed, 89))
