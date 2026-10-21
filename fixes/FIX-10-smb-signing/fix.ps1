# SEC-FIX-10 (SEC-PC-6, SEC-NET-17): require SMB signing on this PC's file-sharing server.
# See README.md. Only -DryRun, -Apply or -Undo.
[CmdletBinding()]
param([switch]$DryRun, [switch]$Apply, [switch]$Undo)
$env:PSModulePath = "$env:windir\System32\WindowsPowerShell\v1.0\Modules"   # R1: before any cmdlet that autoloads a module
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path $root 'lib\common.ps1')

$Folder = 'FIX-10-smb-signing'; $Id = 'SEC-FIX-10'
if ((@($DryRun, $Apply, $Undo) | Where-Object { $_ }).Count -ne 1) { Write-Host 'Use exactly one of -DryRun, -Apply or -Undo.'; exit 2 }

if (-not (Test-Elevated)) {
    if (-not $DryRun) { Write-Host 'Apply and Undo need an elevated window. Nothing changed.'; exit 2 }
    # Read without admin rights from the registry (the same setting the cmdlet changes).
    $v = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Services\LanmanServer\Parameters' -ErrorAction SilentlyContinue).RequireSecuritySignature
    Write-Host "$Id dry run (not elevated, nothing recorded):"
    Write-Host "  RULE SMB server RequireSecuritySignature = $([bool]$v) -> would set True"
    return
}

$stateDir = Get-PackStateDir $Folder
$statePath = Join-Path $stateDir 'dryrun.json'
function Log([string]$line) { "$(Get-Date -Format s) $env:USERNAME $line" | Out-File -Append -Encoding utf8 (Join-Path $stateDir 'log.txt'); Write-Host $line }
function Current { [bool](Get-SmbServerConfiguration).RequireSecuritySignature }

$basePath = Join-Path $stateDir 'baseline.json'   # SEC-INFRA-9: the undo point, written once before the first change

if ($DryRun) {
    $logPath = Join-Path $stateDir 'log.txt'
    if (-not (Test-Path $basePath) -and (Test-Path $statePath) -and (Test-Path $logPath) -and (Select-String -LiteralPath $logPath -Pattern ' applied: ' -Quiet)) {
        Copy-Item -LiteralPath $statePath -Destination $basePath; Log "$Id kept the dry run from before the first -Apply as the undo point (baseline.json)"
    }
    $now = Current
    [ordered]@{ pack = $Id; folder = $Folder; time = (Get-Date).ToString('s'); requireSecuritySignature = $now } | ConvertTo-Json | Out-File -Encoding utf8 $statePath
    Log "$Id dry run (recorded):"
    Write-Host "  RULE SMB server RequireSecuritySignature = $now -> would set True"
    return
}

if (-not (Test-Path $statePath)) { Write-Host 'No recorded dry run. Run -DryRun elevated first. Nothing changed.'; exit 3 }
$saved = Get-Content -Raw $statePath | ConvertFrom-Json
if ($saved.pack -ne $Id -or $saved.folder -ne $Folder) { Write-Host 'The recorded dry run is for another pack. Nothing changed.'; exit 3 }
if ($saved.requireSecuritySignature -isnot [bool]) { Write-Host 'The recorded value does not parse. Nothing changed.'; exit 3 }

if ($Apply) {
    if (((Get-Date) - [datetime]$saved.time).TotalHours -gt 24) { Write-Host 'The recorded dry run is older than 24 hours. Run -DryRun again. Nothing changed.'; exit 3 }
    if ((Current) -ne $saved.requireSecuritySignature) { Write-Host 'The setting changed since the dry run. Run -DryRun again. Nothing changed.'; exit 3 }
    if (-not (Test-Path $basePath)) { Copy-Item -LiteralPath $statePath -Destination $basePath }   # SEC-INFRA-9
    Set-SmbServerConfiguration -RequireSecuritySignature $true -Force
    Log "$Id applied: RequireSecuritySignature = True (was $($saved.requireSecuritySignature))"
    return
}

if ($Undo) {
    if (Test-Path $basePath) {   # SEC-INFRA-9: undo to the value from before the first -Apply
        $saved = Get-Content -Raw $basePath | ConvertFrom-Json
        if ($saved.pack -ne $Id -or $saved.requireSecuritySignature -isnot [bool]) { Write-Host 'The undo point does not parse. Nothing changed.'; exit 3 }
    }
    Set-SmbServerConfiguration -RequireSecuritySignature ([bool]$saved.requireSecuritySignature) -Force
    Log "$Id undone: RequireSecuritySignature = $($saved.requireSecuritySignature)"
    if (Test-Path $basePath) { Remove-Item -LiteralPath $basePath; Log "$Id undo point (baseline.json) cleared after the undo" }
}
