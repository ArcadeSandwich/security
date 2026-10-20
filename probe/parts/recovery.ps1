# Probe part "recovery" (Security · Resilience). Read-only. Shutdowns, startup tasks (FIX-5), ports, signposts, backups, Windows Update.
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'sections\disk-recovery.ps1')
function Get-ProbePart-recovery([switch]$Deep) {
  [pscustomobject]@{ checks = @(Get-DiskRecoveryProbe | ? { $_.Check -notmatch '^(volume|disk |reliability|disk errors)' }) }
}
