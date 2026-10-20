# SEC-FIX-3 (W-9): the "Tailscale-In" rules allow every port from any tailnet device, and tailscaled recreates
# them, so this pack leaves them alone and adds block rules (a block rule wins over an allow rule in Windows
# Firewall) for the Windows ports no tailnet device needs, on this PC's Tailscale addresses only.
# Stays reachable over Tailscale: 135 (Hyper-V management, FIX-2), 3389 (Remote Desktop), 7420 (Prompt generator), 11434 (Ollama), 25565, tailscaled.
# See README.md. Only -DryRun, -Apply or -Undo.
[CmdletBinding()]
param([switch]$DryRun, [switch]$Apply, [switch]$Undo)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path $root 'lib\common.ps1'); . (Join-Path $root 'lib\firewall-pack.ps1')
$Pack = @{ Folder = 'FIX-3-tailscale-block-ports'; Id = 'SEC-FIX-3'; Targets = @(
    @{ LocalAddress = $script:TailscaleRanges; Block = @(
        @{ Name = 'netbios-tcp-139';    Protocol = 'TCP'; LocalPort = '139' },
        @{ Name = 'netbios-udp-137-138'; Protocol = 'UDP'; LocalPort = @('137', '138') },
        @{ Name = 'smb-tcp-445';        Protocol = 'TCP'; LocalPort = '445' },
        @{ Name = 'hyperv-tcp-2179';    Protocol = 'TCP'; LocalPort = '2179' },
        @{ Name = 'obs-tcp-4455';       Protocol = 'TCP'; LocalPort = '4455' },
        @{ Name = 'cdp-tcp-5040';       Protocol = 'TCP'; LocalPort = '5040' },
        @{ Name = 'wsd-tcp-5357';       Protocol = 'TCP'; LocalPort = '5357' },
        @{ Name = 'do-tcp-7680';        Protocol = 'TCP'; LocalPort = '7680' }
    ) }
) }
Invoke-FirewallPack $Pack $DryRun.IsPresent $Apply.IsPresent $Undo.IsPresent
