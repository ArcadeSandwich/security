# SEC-FIX-1 (W-1): limit every Remote Desktop allow rule (port 3389, TCP and UDP) to Tailscale addresses.
# See README.md. Only -DryRun, -Apply or -Undo.
[CmdletBinding()]
param([switch]$DryRun, [switch]$Apply, [switch]$Undo)
$env:PSModulePath = "$env:windir\System32\WindowsPowerShell\v1.0\Modules"   # R1: before any cmdlet that autoloads a module
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path $root 'lib\common.ps1'); . (Join-Path $root 'lib\firewall-pack.ps1')
$Pack = @{ Folder = 'FIX-1-rdp-tailscale-only'; Id = 'SEC-FIX-1'; Targets = @(
    @{ Port = 3389; Change = 'scope'; Scope = $script:TailscaleRanges }
) }
Invoke-FirewallPack $Pack $DryRun.IsPresent $Apply.IsPresent $Undo.IsPresent
