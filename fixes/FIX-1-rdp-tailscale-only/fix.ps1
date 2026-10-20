# SEC-FIX-1 (W-1): limit every Remote Desktop allow rule (port 3389, TCP and UDP) to Tailscale addresses.
# See README.md. Only -DryRun, -Apply or -Undo.
[CmdletBinding()]
param([switch]$DryRun, [switch]$Apply, [switch]$Undo)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path $root 'lib\common.ps1'); . (Join-Path $root 'lib\firewall-pack.ps1')
$Pack = @{ Folder = 'FIX-1-rdp-tailscale-only'; Id = 'SEC-FIX-1'; Port = 3389; Change = 'scope'; Scope = @('100.64.0.0/10', 'fd7a:115c:a1e0::/48') }
Invoke-FirewallPack $Pack $DryRun.IsPresent $Apply.IsPresent $Undo.IsPresent
