# SEC-FIX-2 (W-8): switch off the Hyper-V "REMOTE_DESKTOP_TCP_IN" allow rule (port 2179).
# See README.md. Only -DryRun, -Apply or -Undo.
[CmdletBinding()]
param([switch]$DryRun, [switch]$Apply, [switch]$Undo)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path $root 'lib\common.ps1'); . (Join-Path $root 'lib\firewall-pack.ps1')
$Pack = @{ Folder = 'FIX-2-hyperv-2179-off'; Id = 'SEC-FIX-2'; Port = 2179; Change = 'disable'; Scope = @() }
Invoke-FirewallPack $Pack $DryRun.IsPresent $Apply.IsPresent $Undo.IsPresent
