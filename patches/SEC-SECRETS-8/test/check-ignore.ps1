# SEC-SECRETS-8 test: proves the patched .gitignore ignores every file in private\ and private-musta\.
# Read-only for C:\irl-stream: it copies ONLY .gitignore into a new scratch folder, makes EMPTY files with the
# same names as the private files (names only, never their content), runs git init there, and asks
# git check-ignore about each one. Then it deletes the scratch folder. Prints file names and PASS/FAIL only.
# Usage: powershell -NoProfile -File check-ignore.ps1 [-Gitignore <path to a .gitignore>]   (default C:\irl-stream\.gitignore)
param([string]$Gitignore = 'C:\irl-stream\.gitignore')
$ErrorActionPreference = 'Stop'
$git = (Get-Command git.exe -CommandType Application | Select-Object -First 1).Source
$src = 'C:\irl-stream'
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('sec-secrets-8-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $tmp | Out-Null
$bad = 0
try {
  Copy-Item -LiteralPath $Gitignore (Join-Path $tmp '.gitignore')
  $dirs = @(Get-ChildItem -LiteralPath $src -Directory -Force | Where-Object { $_.Name -like 'private*' })
  foreach ($d in $dirs) {
    New-Item -ItemType Directory (Join-Path $tmp $d.Name) | Out-Null
    foreach ($f in Get-ChildItem -LiteralPath $d.FullName -File -Force) { New-Item -ItemType File (Join-Path $tmp "$($d.Name)\$($f.Name)") | Out-Null }
  }
  & $git -C $tmp init -q
  foreach ($f in Get-ChildItem -LiteralPath $tmp -Recurse -File -Force | Where-Object { $_.FullName -notmatch '\\\.git\\' -and $_.Name -ne '.gitignore' }) {
    $rel = $f.FullName.Substring($tmp.Length + 1).Replace('\', '/')
    & $git -C $tmp check-ignore -q -- $rel
    if ($LASTEXITCODE -eq 0) { "PASS ignored: $rel" } else { "FAIL NOT ignored: $rel"; $bad++ }
  }
  $staged = @(& $git -C $tmp add --dry-run -A 2>$null | Where-Object { $_ -match 'private' })
  if ($staged.Count) { "FAIL git add would stage $($staged.Count) private file(s)"; $bad++ } else { 'PASS git add -A would stage no private file' }
} finally {
  Remove-Item -LiteralPath $tmp -Recurse -Force
}
if ($bad) { "check: FAILED ($bad)"; exit 1 }
'check: OK'; exit 0
