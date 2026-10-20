# SEC-INFRA-5: shared by console.ps1 (normal rights) and apply.ps1 (elevated). Paths come from this file's own place only.
$Root = Split-Path -Parent $PSScriptRoot
$FixesDir = Join-Path $Root 'fixes'
$ProbeDir = Join-Path $Root 'probe'
$LibDir = Join-Path $Root 'lib'
$PackName = '^FIX-\d+-[a-z0-9-]+$'
$HashRe = '^[0-9A-F]{64}$'
$ApprovedFile = Join-Path $FixesDir 'APPROVED.sha256'
$ConsoleData = Join-Path $env:ProgramData 'SecurityConsole' # admin-only: run copies and pack state
$StateRoot = Join-Path $ConsoleData 'state'
$LogRoot = Join-Path $ConsoleData 'logs' # the elevated window logs here (admin-only), then copies the log out
$Git = Join-Path $env:ProgramFiles 'Git\cmd\git.exe' # R1: external tools by full path

function Get-LogFile {
  if (Test-Elevated) { Initialize-AdminOnlyDir $ConsoleData; Initialize-AdminOnlyDir $LogRoot; return Join-Path $LogRoot "$(Get-Date -Format 'yyyy-MM-dd')-console.log" }
  $dir = Join-Path (Join-Path $Root 'reports') (Get-Date -Format 'yyyy-MM-dd')
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  Join-Path $dir 'console.log'
}
function Write-Log([string]$text) {
  Add-Content -Path (Get-LogFile) -Value "$(Get-Date -Format 'HH:mm:ss') $text" -Encoding UTF8
  Write-Host $text
}
function Get-Who { "$env:USERDOMAIN\$env:USERNAME" }
function Get-FileSha([string]$path) { (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash }

# fixes\APPROVED.sha256, written only by Server after its review: "<path from the security folder> <SHA-256>" per line,
# e.g. "fixes/FIX-1-rdp-tailscale-only/fix.ps1 <hash>", "lib/common.ps1 <hash>", "console/apply.ps1 <hash>".
function Get-Approved {
  $map = @{}
  if (-not (Test-Path -LiteralPath $ApprovedFile -PathType Leaf)) { return $map }
  foreach ($l in Get-Content -LiteralPath $ApprovedFile) {
    $p = $l.Trim() -split '\s+'
    if ($l.Trim().StartsWith('#') -or $p.Count -ne 2) { continue }
    if ($p[1].ToUpper() -match $HashRe) { $map[$p[0].ToLower()] = $p[1].ToUpper() }
  }
  $map
}
# $rel is the path from the security folder with forward slashes; $base is the folder that holds it (the real one or a copy).
function Test-Approved([string]$rel, [string]$base = $Root) {
  $want = (Get-Approved)[$rel.ToLower()]
  $path = Join-Path $base ($rel -replace '/', '\')
  return [bool]($want -and (Test-Path -LiteralPath $path -PathType Leaf) -and (Get-FileSha $path) -eq $want)
}
function Get-LibFiles { @(Get-ChildItem -LiteralPath $LibDir -File -Filter *.ps1 -ErrorAction SilentlyContinue | ForEach-Object { "lib/$($_.Name)" }) }
function Get-ProbeFiles {
  if (-not (Test-Path -LiteralPath $ProbeDir)) { return @() }
  @(Get-ChildItem -LiteralPath $ProbeDir -File -Recurse | ForEach-Object { 'probe/' + ($_.FullName.Substring($ProbeDir.Length + 1) -replace '\\', '/') })
}
# Every file a pack needs to run: its two scripts and the shared lib. All must be approved.
function Get-PackFiles([string]$name) { @("fixes/$name/fix.ps1", "fixes/$name/check.ps1") + (Get-LibFiles) }

# A pack is ready only if its folder name is well formed, it has README.md, fix.ps1 and check.ps1, its README has the
# exact line "Status: ready", and every file it needs matches its line in APPROVED.sha256.
function Test-Ready([string]$name) {
  if ($name -notmatch $PackName) { return $false }
  $dir = Join-Path $FixesDir $name
  foreach ($f in 'README.md', 'fix.ps1', 'check.ps1') { if (-not (Test-Path -LiteralPath (Join-Path $dir $f) -PathType Leaf)) { return $false } }
  if (-not [bool](Get-Content -LiteralPath (Join-Path $dir 'README.md') | Where-Object { $_.Trim() -eq 'Status: ready' })) { return $false }
  foreach ($rel in Get-PackFiles $name) { if (-not (Test-Approved $rel)) { return $false } }
  return $true
}
function Test-ProbeApproved {
  $files = Get-ProbeFiles
  if (-not ($files -contains 'probe/probe.ps1')) { return $false }
  foreach ($rel in $files) { if (-not (Test-Approved $rel)) { return $false } }
  return $true
}
function Test-ConsoleApproved { (Test-Approved 'console/apply.ps1') -and (Test-Approved 'console/common.ps1') }

function Get-ReadyPacks {
  if (-not (Test-Path $FixesDir)) { return @() }
  @(Get-ChildItem -LiteralPath $FixesDir -Directory | Where-Object { Test-Ready $_.Name } | Sort-Object { [int]($_.Name -replace '^FIX-(\d+)-.*$', '$1') } | ForEach-Object { $_.Name })
}
function Get-PackHash([string]$name) { Get-FileSha (Join-Path (Join-Path $FixesDir $name) 'fix.ps1') }

# Runs a pack's script from $base (the admin-only copy) in this window and logs what it prints. $true when it exits 0.
function Invoke-PackScript([string]$base, [string]$name, [string]$script, [string]$mode) {
  $path = Join-Path (Join-Path (Join-Path $base 'fixes') $name) $script
  $psArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $path)
  if ($mode) { $psArgs += "-$mode" }
  $out = & "$PSHOME\powershell.exe" @psArgs 2>&1
  $code = $LASTEXITCODE
  foreach ($l in $out) { Write-Log "  [$name $script $mode] $l" }
  return ($code -eq 0)
}

# Only "y", "yes", "n" or "no" are accepted; anything else asks again; no input at all counts as no. Nothing typed is run.
function Read-YesNo([string]$question) {
  while ($true) {
    Write-Host -NoNewline "$question (yes/no): "
    $a = [Console]::ReadLine()
    if ($null -eq $a) { return $false }
    switch ($a.Trim().ToLower()) { { $_ -in 'y', 'yes' } { return $true } { $_ -in 'n', 'no' } { return $false } }
    Write-Host 'Please type yes or no.'
  }
}

# ---- elevated only: folders that normal users cannot write to ----
function Test-Elevated { ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) }
$AdminSids = @('S-1-5-32-544', 'S-1-5-18') # Administrators, SYSTEM
function New-AdminOnlySecurity {
  $sec = New-Object System.Security.AccessControl.DirectorySecurity
  $sec.SetAccessRuleProtection($true, $false) # no inherited rules
  foreach ($sid in $AdminSids) {
    $id = New-Object System.Security.Principal.SecurityIdentifier($sid)
    $sec.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($id, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
  }
  $sec.SetOwner((New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544')))
  $sec
}
# Creates the folder with the admin-only rules in the same step (no moment without them). An existing folder is accepted
# only if its owner is Administrators or SYSTEM and nobody else has any allow rule on it.
function Initialize-AdminOnlyDir([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { [void][System.IO.Directory]::CreateDirectory($path, (New-AdminOnlySecurity)); return }
  $acl = Get-Acl -LiteralPath $path
  $owner = (New-Object System.Security.Principal.NTAccount($acl.Owner)).Translate([System.Security.Principal.SecurityIdentifier]).Value
  if ($owner -notin $AdminSids) { throw "$path is not owned by Administrators or SYSTEM" }
  foreach ($r in $acl.Access) {
    if ($r.AccessControlType -ne 'Allow') { continue }
    $sid = $r.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
    if ($sid -notin $AdminSids) { throw "$path gives access to $($r.IdentityReference)" }
  }
}
# Copies the listed files into $dest (same layout) and checks each copy against APPROVED.sha256. $false on any mismatch.
function Copy-Approved([string[]]$rels, [string]$dest) {
  foreach ($rel in $rels) {
    $to = Join-Path $dest ($rel -replace '/', '\')
    $toDir = Split-Path -Parent $to
    if (-not (Test-Path -LiteralPath $toDir)) { [void][System.IO.Directory]::CreateDirectory($toDir) } # inherits admin-only
    Copy-Item -LiteralPath (Join-Path $Root ($rel -replace '/', '\')) -Destination $to -Force
    if (-not (Test-Approved $rel $dest)) { Write-Log "  copy of $rel does not match APPROVED.sha256"; return $false }
  }
  return $true
}

# ---- copying out of the admin-only folders, as administrator, into reports (which normal users can write to) ----
# Refuses when the target or any folder on the way is a reparse point (a junction or link could aim the copy anywhere).
function Test-NoReparse([string]$path) {
  $p = $path
  while ($p -and $p.Length -ge $Root.Length) {
    if (Test-Path -LiteralPath $p) { if ((Get-Item -LiteralPath $p -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { return $false } }
    $p = Split-Path -Parent $p
  }
  return $true
}
function Copy-OutSafely([string]$from, [string]$to) {
  foreach ($f in Get-ChildItem -LiteralPath $from -File -Recurse) {
    $dest = Join-Path $to $f.FullName.Substring($from.Length + 1)
    if (-not (Test-NoReparse $dest)) { Write-Log "NOT COPIED (a link is in the way): $dest"; continue }
    $d = Split-Path -Parent $dest
    if (-not (Test-Path -LiteralPath $d)) { [void][IO.Directory]::CreateDirectory($d) }
    if (-not (Test-NoReparse $dest)) { Write-Log "NOT COPIED (a link is in the way): $dest"; continue }
    Copy-Item -LiteralPath $f.FullName -Destination $dest -Force
  }
}
function Copy-LogOut {
  $src = Get-LogFile
  $dest = Join-Path (Join-Path (Join-Path $Root 'reports') (Get-Date -Format 'yyyy-MM-dd')) 'console.log'
  if (-not (Test-NoReparse $dest)) { Write-Host "The log stays in $src (a link is in the way of reports\)."; return }
  $d = Split-Path -Parent $dest
  if (-not (Test-Path -LiteralPath $d)) { [void][IO.Directory]::CreateDirectory($d) }
  if (-not (Test-NoReparse $dest)) { Write-Host "The log stays in $src (a link is in the way of reports\)."; return }
  Add-Content -LiteralPath $dest -Value (Get-Content -LiteralPath $src) -Encoding UTF8
  Clear-Content -LiteralPath $src
}
