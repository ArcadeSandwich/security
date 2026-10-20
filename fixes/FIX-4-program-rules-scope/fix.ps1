# SEC-FIX-4 (W-2, W-10, SEC-NET-15): limit the wide "Any" allow rules.
# - Program rules with Remote IP Any for ollama, OBS, obs-browser-page, Node.js, bun and bunx: Tailscale addresses only.
#   Java (java.exe, javaw.exe) is left out on purpose: its rules carry Minecraft's voice chat (UDP 24454) for players.
# - The HNS container DNS rules (port 53): the Hyper-V switch range 172.16.0.0/12 only. Windows may recreate
#   these after a restart; check.ps1 after each restart shows it.
# See README.md. Only -DryRun, -Apply or -Undo.
[CmdletBinding()]
param([switch]$DryRun, [switch]$Apply, [switch]$Undo)
$env:PSModulePath = "$env:windir\System32\WindowsPowerShell\v1.0\Modules"   # R1: before any cmdlet that autoloads a module
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path $root 'lib\common.ps1'); . (Join-Path $root 'lib\firewall-pack.ps1')
$Pack = @{ Folder = 'FIX-4-program-rules-scope'; Id = 'SEC-FIX-4'; Targets = @(
    @{ Programs = @('ollama.exe', 'obs64.exe', 'obs-browser-page.exe', 'node.exe', 'bun.exe', 'bunx.exe'); RemoteAnyOnly = $true; Change = 'scope'; Scope = $script:TailscaleRanges },
    @{ NamePrefix = 'HNS Container Networking - DNS'; RemoteAnyOnly = $true; Change = 'scope'; Scope = @('172.16.0.0/12') },
    @{ NamePrefix = 'HNS Container Networking - ICS DNS'; RemoteAnyOnly = $true; Change = 'scope'; Scope = @('172.16.0.0/12') }
) }
Invoke-FirewallPack $Pack $DryRun.IsPresent $Apply.IsPresent $Undo.IsPresent
