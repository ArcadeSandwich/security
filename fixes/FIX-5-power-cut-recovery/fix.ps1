# FIX-5 Power-cut recovery (W-22). See README.md. Switches only: -DryRun, -Apply, -Undo.
[CmdletBinding()]
param([switch]$DryRun, [switch]$Apply, [switch]$Undo)
$ErrorActionPreference = 'Stop'

$Tasks     = 'Startup - Oak World Game', 'Startup - Oak World Work', 'Startup - Ollama'
$Backup    = 'C:\server\security\reports\FIX-5-backup'
$OllamaDir = 'C:\Users\cadey\AppData\Local\Programs\Ollama'
$BootDelay = @{ 'Startup - Oak World Game' = 'PT1M'; 'Startup - Oak World Work' = 'PT2M'; 'Startup - Ollama' = 'PT3M' }  # boot order: game, Work/Workplace, Ollama

if ((@($DryRun, $Apply, $Undo) | ? { $_ }).Count -ne 1) { throw 'Use exactly one of -DryRun, -Apply, -Undo.' }

function Test-Admin {
  ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole('Administrators')
}
function BackupFile($name) { Join-Path $Backup (($name -replace '[^A-Za-z0-9]+', '-') + '.xml') }
function HasBoot($t) { [bool]($t.Triggers | ? { $_.CimClass.CimClassName -eq 'MSFT_TaskBootTrigger' }) }
# Saves the task as it is now, unless FIX-5 is already applied (then the pre-fix copy is kept for -Undo).
function Save-Backup($n) {
  $t = Get-ScheduledTask -TaskName $n -TaskPath '\'
  $f = BackupFile $n
  if ((HasBoot $t) -and (Test-Path $f)) { return "backup kept (FIX-5 already applied): $f" }
  Export-ScheduledTask -TaskName $n -TaskPath '\' | Set-Content -Path $f -Encoding Unicode
  "backup saved: $f"
}

if ($DryRun) {
  if (-not (Test-Path $Backup)) { New-Item -ItemType Directory $Backup | Out-Null }
  foreach ($n in $Tasks) {
    $t = Get-ScheduledTask -TaskName $n -TaskPath '\'
    Save-Backup $n
    "[$n] runs (read from the task, kept): $(($t.Actions | % { "$($_.Execute) $($_.Arguments)".Trim() }) -join '; ')"
    $trig = ($t.Triggers | % { $_.CimClass.CimClassName -replace 'MSFT_Task|Trigger', '' }) -join ','
    "[$n] now: triggers=$trig logon=$($t.Principal.LogonType) restart=$($t.Settings.RestartCount)"
    "[$n] would set: triggers=Boot(delay $($BootDelay[$n]))+Logon, logon=Password (run whether signed in or not), restart=3 every 1 minute"
    if ($n -eq 'Startup - Ollama') { "[$n] would set action: $OllamaDir\ollama.exe serve (tray app needs a desktop)" }
  }
  'Dry run only: nothing changed.'
  return
}

if (-not (Test-Admin)) { throw 'Needs administrator rights: run it from console\Security fixes.cmd.' }

if ($Undo) {
  foreach ($n in $Tasks) {
    $f = BackupFile $n
    if (-not (Test-Path $f)) { throw "No backup for '$n' ($f). Nothing undone." }
  }
  foreach ($n in $Tasks) {
    Register-ScheduledTask -TaskName $n -TaskPath '\' -Xml (Get-Content (BackupFile $n) -Raw) -Force | Out-Null
    "restored: $n"
  }
  'Undo done. Run check.ps1.'
  return
}

# -Apply
foreach ($n in $Tasks) {
  if (-not (Test-Path (BackupFile $n))) { throw "Run -DryRun first (no backup for '$n')." }
}
$user = "$env:COMPUTERNAME\$((Get-ScheduledTask -TaskName $Tasks[0]).Principal.UserId)"
$cred = Get-Credential -UserName $user -Message 'FIX-5: your Windows password, so the tasks can start at boot. It goes only to Windows Task Scheduler.'
if (-not $cred) { throw 'Cancelled: nothing changed.' }
try {
  foreach ($n in $Tasks) {
    Save-Backup $n
    $t = Get-ScheduledTask -TaskName $n -TaskPath '\'
    $boot = New-ScheduledTaskTrigger -AtStartup
    $boot.Delay = $BootDelay[$n]
    $logon = $t.Triggers | ? { $_.CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger' }
    $s = $t.Settings
    $s.RestartCount = 3
    $s.RestartInterval = 'PT1M'
    $args2 = @{ TaskName = $n; TaskPath = '\'; Trigger = @($boot) + @($logon); Settings = $s; User = $user; Password = $cred.GetNetworkCredential().Password }
    if ($n -eq 'Startup - Ollama') {
      $args2.Action = New-ScheduledTaskAction -Execute "$OllamaDir\ollama.exe" -Argument 'serve' -WorkingDirectory $OllamaDir
    }
    Set-ScheduledTask @args2 | Out-Null
    $args2.Password = $null
    "applied: $n"
  }
} finally { $cred = $null; $args2 = $null }
'Apply done. Run check.ps1.'
