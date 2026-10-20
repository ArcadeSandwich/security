# FIX-8 oak-config.json permissions (W-4). See README.md. Switches only: -DryRun, -Apply, -Undo.
# Limits who can read the game's key file to the Admin's account, SYSTEM and Administrators.
# Never reads the file's content; prints names, dates and permission entries only.
[CmdletBinding()]
param([switch]$DryRun, [switch]$Apply, [switch]$Undo)
$ErrorActionPreference = 'Stop'

$File    = 'C:\server\oak-world\oak-world\oak-config.json'
$Backup  = 'C:\server\security\reports\FIX-8-backup'
$AclSave = Join-Path $Backup 'oak-config.acl'
$Task    = 'Startup - Oak World Game'     # the game, Work/Workplace and start-live.bat all run as this task's account
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

function Test-Admin { ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole('Administrators') }
function Get-Account { "$env:COMPUTERNAME\$((Get-ScheduledTask -TaskName $Task -TaskPath '\').Principal.UserId)" }
function Show-Acl($p) { (Get-Acl -LiteralPath $p).Access | % { "    $($_.IdentityReference) $($_.AccessControlType) $($_.FileSystemRights)$(if ($_.IsInherited) { ' (inherited)' })" } }

if ($DryRun) {
  $acct = Get-Account
  "File: $File"
  '  now:'; Show-Acl $File
  "  would: save these permissions to $AclSave, stop inheriting (keeping the entries as they are),"
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

if ($Undo) {
  if (-not (Test-Path -LiteralPath $AclSave)) { throw "No saved permissions ($AclSave). Nothing undone." }
  & icacls (Split-Path $File) /restore $AclSave | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "icacls /restore failed ($LASTEXITCODE)." }
  & icacls $File /inheritance:e | Out-Null
  'Undo done: the old permissions are back. Run check.ps1 -Undone.'
  return
}

# -Apply
if (-not (Test-Path $Backup)) { New-Item -ItemType Directory $Backup | Out-Null }
if (Test-Path -LiteralPath $AclSave) { "saved permissions kept (FIX-8 may already be applied): $AclSave" }
else {
  & icacls $File /save $AclSave | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not save the current permissions: nothing changed.' }
  "permissions saved: $AclSave"
}
$acct = Get-Account
& icacls $File /grant "${acct}:(M)" | Out-Null       # first, so the game never loses access
if ($LASTEXITCODE -ne 0) { throw "Could not grant $acct; nothing else changed." }
& icacls $File /inheritance:d | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not stop inheritance. Run -Undo.' }
foreach ($g in $Remove) { & icacls $File /remove:g $g | Out-Null; if ($LASTEXITCODE -ne 0) { throw "Could not remove $g. Run -Undo." } }
'applied: oak-config.json is limited to the Admin''s account, SYSTEM and Administrators. Run check.ps1.'
