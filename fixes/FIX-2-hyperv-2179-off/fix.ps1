# SEC-FIX-2 (W-8, SEC-NET-16): switch off the Hyper-V "REMOTE_DESKTOP_TCP_IN" allow rule (port 2179), and limit
# the allow rules on port 135 (Hyper-V WMI DCOM-In and the Remote Assistance DCOM rule) to Tailscale addresses.
# See README.md. Only -DryRun, -Apply or -Undo.
[CmdletBinding()]
param([switch]$DryRun, [switch]$Apply, [switch]$Undo)
$env:PSModulePath = "$env:windir\System32\WindowsPowerShell\v1.0\Modules"   # R1: before any cmdlet that autoloads a module
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path $root 'lib\common.ps1'); . (Join-Path $root 'lib\firewall-pack.ps1')
$Pack = @{ Folder = 'FIX-2-hyperv-2179-off'; Id = 'SEC-FIX-2'; Targets = @(
    @{ Port = 2179; Change = 'disable' },
    @{ Port = 135; Change = 'scope'; Scope = $script:TailscaleRanges }
) }
Invoke-FirewallPack $Pack $DryRun.IsPresent $Apply.IsPresent $Undo.IsPresent
