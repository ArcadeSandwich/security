# FIX-8 check: read-only. Proves the limit holds on both files AND that the game's accounts can still read them.
# -Undone checks that Undo brought back the saved permissions instead.
[CmdletBinding()]
param([switch]$Undone)
$ErrorActionPreference = 'Stop'

$Folder  = 'C:\server\oak-world\oak-world'
$Names   = 'oak-config.json', 'access.json'
$State   = 'C:\ProgramData\SecurityConsole\state\FIX-8-oak-config-permissions'   # Get-PackStateDir 'FIX-8-oak-config-permissions' (admin-only)
$Tasks   = 'Startup - Oak World Game', 'Startup - Oak World Work'   # the game + start-live.bat, and Work/Workplace
$bad = 0
function Say($ok, $msg) { if ($ok) { "PASS $msg" } else { "FAIL $msg"; $script:bad++ } }

foreach ($n in $Names) {
  $acl  = Get-Acl -LiteralPath "$Folder\$n"
  $aces = $acl.Access | % { $sid = try { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value } catch { "$($_.IdentityReference)" }; [pscustomobject]@{ Sid = $sid; Ace = $_ } }

  if ($Undone) {
    Say (Test-Path -LiteralPath "$State\$n.acl") "[$n] the saved permissions file exists"
    Say (-not $acl.AreAccessRulesProtected) "[$n] inheritance is back on"
    Say ([bool]($aces | ? { $_.Sid -eq 'S-1-5-32-545' })) "[$n] BUILTIN\Users is back (as before FIX-8)"
  } else {
    Say ($acl.AreAccessRulesProtected) "[$n] inheritance is off"
    Say (-not ($aces | ? { $_.Sid -in 'S-1-5-32-545', 'S-1-5-11', 'S-1-1-0' })) "[$n] no Users, Authenticated Users or Everyone entry"
  }

  # Each service account must have an explicit allow entry with read rights: its tasks run "Limited" (not elevated),
  # so the Administrators entry does not count for them.
  foreach ($t in $Tasks) {
    $u = (Get-ScheduledTask -TaskName $t -TaskPath '\').Principal.UserId
    $sid = ([Security.Principal.NTAccount]"$env:COMPUTERNAME\$u").Translate([Security.Principal.SecurityIdentifier]).Value
    $read = $aces | ? { $_.Sid -eq $sid -and $_.Ace.AccessControlType -eq 'Allow' -and ($_.Ace.FileSystemRights -band [Security.AccessControl.FileSystemRights]::ReadData) }
    $deny = $aces | ? { $_.Sid -eq $sid -and $_.Ace.AccessControlType -eq 'Deny' }
    if ($Undone) { Say (-not $deny) "[$n] [$t] account $u has no deny entry" }
    else { Say ([bool]$read -and -not $deny) "[$n] [$t] account $u can read the file" }
  }
}

# The live game is still up (it reads oak-config.json on every turn and access.json at the door). No code is sent, so 401 counts as up.
try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3000/api/saves' -TimeoutSec 5; $code = [int]$r.StatusCode }
catch { $code = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 } }
Say ($code -in 200, 401) "the game answers on 127.0.0.1:3000 ($code)"

if ($bad) { "check: FAILED ($bad)"; exit 1 }
'check: OK'; exit 0
