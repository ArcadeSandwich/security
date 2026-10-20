# FIX-8 oak-config.json and access.json permissions (W-4). See README.md. Switches only: -DryRun, -Apply, -Undo.
# Limits who can read the game's key file and its guest-code file to the Admin's account, SYSTEM and Administrators.
# Never reads either file's content; prints names, dates and permission entries only.
[CmdletBinding()]
param([switch]$DryRun, [switch]$Apply, [switch]$Undo)
$env:PSModulePath = "$env:windir\System32\WindowsPowerShell\v1.0\Modules"   # R1: first statement after param(); only Windows' own modules load
# R1: drop any copy of these modules already loaded in this process, then load Windows' own by full path.
foreach ($m in 'ScheduledTasks', 'Microsoft.PowerShell.Security', 'Microsoft.PowerShell.Management', 'Microsoft.PowerShell.Utility') {
  Microsoft.PowerShell.Core\Get-Module $m | Microsoft.PowerShell.Core\Remove-Module -Force -ErrorAction SilentlyContinue
  Microsoft.PowerShell.Core\Import-Module "$env:windir\System32\WindowsPowerShell\v1.0\Modules\$m" -Force -ErrorAction Stop
}
foreach ($c in 'Get-ScheduledTask', 'Get-Acl', 'Get-Item', 'Get-Content', 'Test-Path', 'Join-Path', 'Split-Path', 'Invoke-WebRequest', 'ConvertFrom-Json') {   # no function or alias may stand in for them
  foreach ($k in 'function', 'alias') { if (Microsoft.PowerShell.Management\Test-Path "${k}:$c") { Microsoft.PowerShell.Management\Remove-Item "${k}:$c" -Force } }
}
$Icacls = "$env:windir\System32\icacls.exe"   # R1: full path, never a look-up
$ErrorActionPreference = 'Stop'

$Folder  = 'C:\server\oak-world\oak-world'
$Names   = 'oak-config.json', 'access.json'   # each gets its own .acl save
$Task    = 'Startup - Oak World Game'         # the game, Work/Workplace and start-live.bat all run as this task's account
# Copies holding the same live values (SEC-SECRETS-5a, 2026-10-20). Only listed here; the Admin deletes them.
$Copies  = @(
  'C:\server\oak-world\oak-world\oak-config.json.bak',
  'C:\server\oak-world\oak-world\backups\oak-config.before-2026-09-27-fix.json',
  'C:\server\oak-world\oak-world\backups\oak-config.before-queue-lock-2026-09-29.json',
  'C:\server\oak-world\dm-wt\oak-config.json',
  'C:\server\oak-world\jobs\_main\oak-config.json'
)
$Remove  = @('*S-1-5-32-545', '*S-1-5-11', '*S-1-1-0')  # BUILTIN\Users, Authenticated Users, Everyone

if ((@($DryRun, $Apply, $Undo) | ? { $_ }).Count -ne 1) { throw 'Use exactly one of -DryRun, -Apply, -Undo.' }
. (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'lib\common.ps1')

function Fail($what) { throw "FIX-8: $what" }
# The saved permissions live only in the Administrators-and-SYSTEM folder (Get-PackStateDir, lib\common.ps1),
# because -Undo applies them elevated. There is no fallback to a folder a normal chat could write.
function AclSave($name) {
  if (-not (Get-Command Get-PackStateDir -ErrorAction SilentlyContinue)) { Fail 'Get-PackStateDir is missing from lib\common.ps1: nothing done.' }
  Join-Path (Get-PackStateDir 'FIX-8-oak-config-permissions') ($name + '.acl')
}
# An icacls /save file is pairs of lines: a file name, then its permissions. Each save must name its own file only.
function Test-AclSave($f, $name) {
  $lines = @(Get-Content -LiteralPath $f -Encoding Unicode | ? { $_.Trim() })   # icacls writes UTF-16 without a BOM
  ($lines.Count -eq 2) -and ($lines[0].Trim() -eq $name) -and ($lines[1] -match '^D:')
}
function Get-Account { "$env:COMPUTERNAME\$((Get-ScheduledTask -TaskName $Task -TaskPath '\').Principal.UserId)" }
function Show-Acl($p) { (Get-Acl -LiteralPath $p).Access | % { "    $($_.IdentityReference) $($_.AccessControlType) $($_.FileSystemRights)$(if ($_.IsInherited) { ' (inherited)' })" } }

if ($DryRun) {
  $acct = Get-Account
  foreach ($n in $Names) {
    "File: $Folder\$n"
    '  now:'; Show-Acl "$Folder\$n"
    "  would: save these permissions to the pack's admin-only state folder (C:\ProgramData\SecurityConsole\state\FIX-8-oak-config-permissions\$n.acl),"
    "         give $acct Modify, stop inheriting (keeping the entries), and remove BUILTIN\Users, Authenticated Users and Everyone."
    ''
  }
  'Unknown account SIDs already on the files are left as they are (see README).'
  ''
  'Copies with the same keys (not changed by this pack; the Admin deletes them, README step 3):'
  foreach ($c in $Copies) {
    if (Test-Path -LiteralPath $c) { $i = Get-Item -LiteralPath $c -Force; "  $c | $($i.LastWriteTime.ToString('yyyy-MM-dd')) | $($i.Length) bytes" }
    else { "  $c | gone" }
  }
  'Dry run only: nothing changed.'
  return
}

if (-not (Test-Elevated)) { Fail 'needs administrator rights: run it from console\Security fixes.cmd.' }

if ($Undo) {
  foreach ($n in $Names) {   # check every save before restoring any
    $s = AclSave $n
    if (-not (Test-Path -LiteralPath $s)) { Fail "no saved permissions for $n ($s). Nothing undone." }
    if (-not (Test-AclSave $s $n)) { Fail "the saved permissions for $n name another file. Nothing undone." }
  }
  foreach ($n in $Names) {
    & $Icacls $Folder /restore (AclSave $n) | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "icacls /restore failed for $n ($LASTEXITCODE)." }
    & $Icacls "$Folder\$n" /inheritance:e | Out-Null
    "restored: $n"
  }
  'Undo done: the old permissions are back. Run check.ps1 -Undone.'
  return
}

# -Apply: save both files' permissions first; change nothing unless both saves are good.
foreach ($n in $Names) {
  $s = AclSave $n
  if (Test-Path -LiteralPath $s) {
    if (-not (Test-AclSave $s $n)) { Fail "the saved permissions for $n are not for $n alone. Nothing changed." }
    "saved permissions kept (FIX-8 may already be applied): $s"
  } else {
    & $Icacls "$Folder\$n" /save $s | Out-Null
    if ($LASTEXITCODE -ne 0 -or -not (Test-AclSave $s $n)) { Fail "could not save the permissions of ${n}: nothing changed." }
    "permissions saved: $s"
  }
}
$acct = Get-Account
foreach ($n in $Names) {
  $f = "$Folder\$n"
  & $Icacls $f /grant "${acct}:(M)" | Out-Null       # first, so the game never loses access
  if ($LASTEXITCODE -ne 0) { Fail "could not grant $acct on $n. Run -Undo." }
  & $Icacls $f /inheritance:d | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "could not stop inheritance on $n. Run -Undo." }
  foreach ($g in $Remove) { & $Icacls $f /remove:g $g | Out-Null; if ($LASTEXITCODE -ne 0) { Fail "could not remove $g from $n. Run -Undo." } }
  "applied: $n"
}
'applied: both files are limited to the Admin''s account, SYSTEM and Administrators. Run check.ps1.'
