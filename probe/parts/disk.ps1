# Probe part "disk" (Security · Resilience). Read-only. Volumes, disks, disk errors; with -Deep, the reliability counters.
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'sections\disk-recovery.ps1')
function Get-ProbePart-disk([switch]$Deep) {
  $rows = @(Get-DiskRecoveryProbe | ? { $_.Check -match '^(volume|disk |reliability|disk errors)' })
  if ($Deep) {
    $rel = @(Get-PhysicalDisk | Get-StorageReliabilityCounter -ErrorAction SilentlyContinue | Select DeviceId, ReadErrorsTotal, WriteErrorsTotal, Temperature, Wear, PowerOnHours)
    $rows = @($rows | ? Check -ne 'reliability counters')
    return [pscustomobject]@{ checks = $rows; reliability = $rel }
  }
  [pscustomobject]@{ checks = $rows }
}
