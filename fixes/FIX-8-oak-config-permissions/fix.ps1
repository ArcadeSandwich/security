# FIX-8 oak-config.json permissions (W-4). See README.md. Switches only: -DryRun, -Apply, -Undo.
# Limits who can read the game's key file to the Admin's account, SYSTEM and Administrators.
# Never reads the file's content; prints names, dates and permission entries only.
[CmdletBinding()]
param([switch]$DryRun, [switch]$Apply, [switch]$Undo)
$ErrorActionPreference = 'Stop'

$File    = 'C:\server\oak-world\oak-world\oak-config.json'
$Task   = 'Startup - Oak World Game'     # the game, Work/Workplace and start-live.bat all run as this task's account
# Copies holding the same live values (SEC-SECRETS-5a, 2026-10-20). Only listed here; the Admin deletes them.
$Copies  = @(
  'C:\server\oak-world\oak-world\oak-config.json.bak',
  'C:\server\oak-world\oak-world\backups\oak-config.before-2026-09-27-fix.json',
  'C:\server\oak-world\oak-world\backups\oak-config.before-queue-lock-2026-09-29.json',
  'C:\server\oak-world\dm-wt\oak-config.json',
  'C:\server\oak-world\jobs\_main\oak-config.json'
)
$Remove  = @('*S-1-5-32-545', '*S-1-5-11')  # BUILTIN\Users, Authenticated Users

if ((@($DryRun, $Apply, $Undo) | ? { $_ }).Count -ne 1) { throw 'Use exactly one of -DryRun, -Apply, -Undo.' }
. (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'lib\common.ps1')

function Fail($what) { throw "FIX-8: $what" }
# The saved permissions live only in the Administrators-and-SYSTEM folder (Get-PackStateDir, lib\common.ps1),
# because -Undo applies them elevated. There is no fallback to a folder a normal chat could write.
function AclSave {
  if (-not (Get-Command Get-PackStateDir -ErrorAction SilentlyContinue)) { Fail 'Get-PackStateDir is missing from lib\common.ps1: nothing done.' }
  Join-Path (Get-PackStateDir 'SEC-FIX-8') 'oak-config.acl'
}
# An icacls /save file is pairs of lines: a file name, then its permissions. Ours must name oak-config.json only.
function Test-AclSave($f) {
  $lines = @(Get-Content -LiteralPath $f -Encoding Unicode | ? { $_.Trim() })   # icacls writes UTF-16 without a BOM
  ($lines.Count -eq 2) -and ($lines[0].Trim() -eq 'oak-config.json') -and ($lines[1] -match '^D:')
}
function Test-Admin { Test-Elevated }
function Get-Account { "$env:COMPUTERNAME\$((Get-ScheduledTask -TaskName $Task -TaskPath '\').Principal.UserId)" }
function Show-Acl($p) { (Get-Acl -LiteralPath $p).Access | % { "    $($_.IdentityReference) $($_.AccessControlType) $($_.FileSystemRights)$(if ($_.IsInherited) { ' (inherited)' })" } }

if ($DryRun) {
  $acct = Get-Account
  "File: $File"
  '  now:'; Show-Acl $File
  "  would: save these permissions to the pack's admin-only state folder (C:\ProgramData\SecurityConsole\state\SEC-FIX-8), stop inheriting (keeping the entries as they are),"
  "         remove BUILTIN\Users and Authenticated Users, and give $acct Modify."
  '  Unknown account SIDs already on the file are left as they are (see README).'
  ''
  'Copies with the same keys (not changed by this pack; the Admin deletes them, README step 3):'
  foreach ($c in $Copies) {
    if (Test-Path -LiteralPath $c) { $i = Get-Item -LiteralPath $c -Force; "  $c | $($i.LastWriteTime.ToString('yyyy-MM-dd')) | $($i.Length) bytes" }
    else { "  $c | gone" }
  }
  'Dry run only: nothing changed.'
  return
}

if (-not (Test-Admin)) { throw 'Needs administrator rights: run it from console\Security fixes.cmd.' }

$AclSave = AclSave

if ($Undo) {
  if (-not (Test-Path -LiteralPath $AclSave)) { Fail "no saved permissions ($AclSave). Nothing undone." }
  if (-not (Test-AclSave $AclSave)) { Fail 'the saved permissions file names something other than oak-config.json. Nothing undone.' }
  & icacls (Split-Path $File) /restore $AclSave | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "icacls /restore failed ($LASTEXITCODE)." }
  & icacls $File /inheritance:e | Out-Null
  'Undo done: the old permissions are back. Run check.ps1 -Undone.'
  return
}

# -Apply
if (Test-Path -LiteralPath $AclSave) {
  if (-not (Test-AclSave $AclSave)) { Fail 'the saved permissions file is not for oak-config.json alone. Nothing changed.' }
  "saved permissions kept (FIX-8 may already be applied): $AclSave"
} else {
  & icacls $File /save $AclSave | Out-Null
  if ($LASTEXITCODE -ne 0 -or -not (Test-AclSave $AclSave)) { Fail 'could not save the current permissions: nothing changed.' }
  "permissions saved: $AclSave"
}
$acct = Get-Account
& icacls $File /grant "${acct}:(M)" | Out-Null       # first, so the game never loses access
if ($LASTEXITCODE -ne 0) { throw "Could not grant $acct; nothing else changed." }
& icacls $File /inheritance:d | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not stop inheritance. Run -Undo.' }
foreach ($g in $Remove) { & icacls $File /remove:g $g | Out-Null; if ($LASTEXITCODE -ne 0) { throw "Could not remove $g. Run -Undo." } }
'applied: oak-config.json is limited to the Admin''s account, SYSTEM and Administrators. Run check.ps1.'
