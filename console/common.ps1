# SEC-INFRA-5: shared by console.ps1 (normal rights) and apply.ps1 (elevated). Paths come from this file's own place only.
$Root = Split-Path -Parent $PSScriptRoot
$FixesDir = Join-Path $Root 'fixes'
$ProbeDir = Join-Path $Root 'probe'
$PackName = '^FIX-\d+-[a-z0-9-]+$'

function Get-LogFile {
  $dir = Join-Path (Join-Path $Root 'reports') (Get-Date -Format 'yyyy-MM-dd')
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  Join-Path $dir 'console.log'
}

function Write-Log([string]$text) {
  $line = "$(Get-Date -Format 'HH:mm:ss') $text"
  Add-Content -Path (Get-LogFile) -Value $line -Encoding UTF8
  Write-Host $text
}

# A pack is ready only if its folder name is well formed, it has README.md, fix.ps1 and check.ps1,
# and its README has the exact line "Status: ready".
function Test-Ready([string]$name) {
  if ($name -notmatch $PackName) { return $false }
  $dir = Join-Path $FixesDir $name
  foreach ($f in 'README.md', 'fix.ps1', 'check.ps1') { if (-not (Test-Path -LiteralPath (Join-Path $dir $f) -PathType Leaf)) { return $false } }
  return [bool](Get-Content -LiteralPath (Join-Path $dir 'README.md') | Where-Object { $_.Trim() -eq 'Status: ready' })
}

function Get-ReadyPacks {
  if (-not (Test-Path $FixesDir)) { return @() }
  @(Get-ChildItem -LiteralPath $FixesDir -Directory | Where-Object { Test-Ready $_.Name } | Sort-Object { [int]($_.Name -replace '^FIX-(\d+)-.*$', '$1') } | ForEach-Object { $_.Name })
}

function Get-PackHash([string]$name) {
  (Get-FileHash -LiteralPath (Join-Path (Join-Path $FixesDir $name) 'fix.ps1') -Algorithm SHA256).Hash
}

# Runs a pack's script in this window and logs everything it prints. Returns $true when it exits with 0.
function Invoke-PackScript([string]$name, [string]$script, [string]$mode) {
  $path = Join-Path (Join-Path $FixesDir $name) $script
  $psArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $path)
  if ($mode) { $psArgs += "-$mode" }
  $out = & powershell.exe @psArgs 2>&1
  $code = $LASTEXITCODE
  foreach ($l in $out) { Write-Log "  [$name $script $mode] $l" }
  return ($code -eq 0)
}

# Only "y", "yes", "n" or "no" are accepted; anything else asks again. Nothing typed is ever run.
function Read-YesNo([string]$question) {
  while ($true) {
    Write-Host -NoNewline "$question (yes/no): "
    $a = [Console]::ReadLine()
    if ($null -eq $a) { return $false } # no more input: treat as no
    switch ($a.Trim().ToLower()) { { $_ -in 'y', 'yes' } { return $true } { $_ -in 'n', 'no' } { return $false } }
    Write-Host 'Please type yes or no.'
  }
}
