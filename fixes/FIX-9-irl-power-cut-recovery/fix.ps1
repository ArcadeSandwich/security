# FIX-9 Power-cut recovery for the IRL dashboards (SEC-RES-12), same design as FIX-5. See README.md. Switches only: -DryRun, -Apply, -Undo.
[CmdletBinding()]
param([switch]$DryRun, [switch]$Apply, [switch]$Undo)
# First statement (only param may come before it): load modules from Windows' own folder only, never from a folder a chat can write.
$env:PSModulePath = "$env:windir\System32\WindowsPowerShell\v1.0\Modules"
$ErrorActionPreference = 'Stop'
Import-Module "$env:windir\System32\WindowsPowerShell\v1.0\Modules\ScheduledTasks" -Force

$Tasks     = 'Startup - IRL Stream', 'Startup - IRL Musta'
$BootDelay = @{ 'Startup - IRL Stream' = 'PT4M'; 'Startup - IRL Musta' = 'PT5M' }  # after FIX-5's game (1), Workplace (2), Ollama (3)

if ((@($DryRun, $Apply, $Undo) | ? { $_ }).Count -ne 1) { throw 'Use exactly one of -DryRun, -Apply, -Undo.' }
. (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'lib\common.ps1')

function HasBoot($t) { [bool]($t.Triggers | ? { $_.CimClass.CimClassName -eq 'MSFT_TaskBootTrigger' }) }
function ActionsOf($t) { @($t.Actions | % { "$($_.Execute)|$($_.Arguments)" }) -join ';' }
function Fail($what) { throw "FIX-9: $what" }

# The backups and the record live only in the Administrators-and-SYSTEM folder (Get-PackStateDir, lib\common.ps1),
# because -Undo registers them elevated. There is no fallback to a folder a normal chat could write.
function StateDir {
  if (-not (Get-Command Get-PackStateDir -ErrorAction SilentlyContinue)) { Fail 'Get-PackStateDir is missing from lib\common.ps1: nothing done.' }
  Get-PackStateDir 'FIX-9-irl-power-cut-recovery'
}
function BackupFile($dir, $name) { Join-Path $dir (($name -replace '[^A-Za-z0-9]+', '-') + '.xml') }

if ($DryRun) {
  foreach ($n in $Tasks) {
    $t = Get-ScheduledTask -TaskName $n -TaskPath '\'
    $trig = ($t.Triggers | % { $_.CimClass.CimClassName -replace 'MSFT_Task|Trigger', '' }) -join ','
    "[$n] runs (read from the task, kept): $(($t.Actions | % { "$($_.Execute) $($_.Arguments)".Trim() }) -join '; ')"
    "[$n] now: triggers=$trig logon=$($t.Principal.LogonType) restart=$($t.Settings.RestartCount)"
    "[$n] would set: triggers=Boot(delay $($BootDelay[$n]))+Logon, logon=Password (run whether signed in or not), restart=3 every 1 minute"
  }
  '-Apply first saves each task as it is into the protected state folder, for -Undo.'
  'Dry run only: nothing changed.'
  return
}

if (-not (Test-Elevated)) { Fail 'needs administrator rights: run it from console\Security fixes.cmd.' }
$dir = StateDir
$record = Join-Path $dir 'record.json'

if ($Undo) {
  if (-not (Test-Path $record)) { Fail "no record in $dir. Nothing undone." }
  $rec = Get-Content $record -Raw | ConvertFrom-Json
  $xmls = @{}
  foreach ($n in $Tasks) {
    $f = BackupFile $dir $n
    if (-not (Test-Path $f)) { Fail "no backup for '$n'. Nothing undone." }
    $raw = Get-Content $f -Raw
    [xml]$x = $raw
    $uri = "$($x.Task.RegistrationInfo.URI)".TrimStart('\')
    if ($uri -and $uri -ne $n) { Fail "backup for '$n' names another task ('$uri'). Nothing undone." }
    $acts = @($x.Task.Actions.Exec | % { "$($_.Command)|$($_.Arguments)" }) -join ';'
    if ($acts -ne $rec.$n) { Fail "backup for '$n' runs something other than what -Apply recorded. Nothing undone." }
    $xmls[$n] = $raw
  }
  foreach ($n in $Tasks) {
    try { Register-ScheduledTask -TaskName $n -TaskPath '\' -Xml $xmls[$n] -Force | Out-Null }
    catch { Fail "could not restore '$n' ($($_.Exception.GetType().Name))." }
    "restored: $n"
  }
  'Undo done. Run check.ps1.'
  return
}

# -Apply: save each task as it is (unless FIX-9 is already on it), with a record of what it runs.
$rec = if (Test-Path $record) { Get-Content $record -Raw | ConvertFrom-Json } else { [pscustomobject]@{} }
foreach ($n in $Tasks) {
  $t = Get-ScheduledTask -TaskName $n -TaskPath '\'
  $f = BackupFile $dir $n
  if ((HasBoot $t) -and (Test-Path $f)) { "backup kept (FIX-9 already applied): $n"; continue }
  Export-ScheduledTask -TaskName $n -TaskPath '\' | Set-Content -Path $f -Encoding Unicode
  $rec | Add-Member -NotePropertyName $n -NotePropertyValue (ActionsOf $t) -Force
  "backup saved: $n"
}
$rec | ConvertTo-Json | Set-Content -Path $record -Encoding UTF8

$user = "$env:COMPUTERNAME\$((Get-ScheduledTask -TaskName $Tasks[0]).Principal.UserId)"
$cred = Get-Credential -UserName $user -Message 'FIX-9: your Windows password, so the tasks can start at boot. It goes only to Windows Task Scheduler.'
if (-not $cred) { Fail 'cancelled: nothing changed.' }
try {
  foreach ($n in $Tasks) {
    $t = Get-ScheduledTask -TaskName $n -TaskPath '\'
    $boot = New-ScheduledTaskTrigger -AtStartup
    $boot.Delay = $BootDelay[$n]
    $logon = $t.Triggers | ? { $_.CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger' }
    $s = $t.Settings
    $s.RestartCount = 3
    $s.RestartInterval = 'PT1M'
    $s.MultipleInstances = 'IgnoreNew'
    $s.ExecutionTimeLimit = 'PT0S'
    $set = @{ TaskName = $n; TaskPath = '\'; Trigger = @($boot) + @($logon); Settings = $s; User = $user }
    # The password is read here and nowhere else; an error is reported by its type only, never with its arguments.
    try { Set-ScheduledTask @set -Password $cred.GetNetworkCredential().Password | Out-Null }
    catch { $err = $_.Exception.GetType().Name; $Error.Clear(); Fail "could not set '$n' ($err). Run -Undo to put the tasks back." }
    "applied: $n"
  }
} finally { $cred = $null; $set = $null; $Error.Clear() }
'Apply done. Run check.ps1.'
