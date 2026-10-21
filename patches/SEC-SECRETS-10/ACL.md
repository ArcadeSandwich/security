# SEC-SECRETS-10, part 2: limit who can read the IRL stream's secret folders

Status: reviewed-security

- **What is wrong:** `C:\irl-stream\private` and `C:\irl-stream\private-musta` hold the stream keys (now including the named keys' streamkeys.json), the dashboard passwords, the OBS remote password and the Twitch app secret. Today every local account can read them: BUILTIN\Users has read (RX), and Authenticated Users can even change them (Modify), all inherited from C:\. The `0o600` mode that the dashboard sets on streamkeys.json does nothing on Windows.
- **The fix:** each folder stops inheriting and gets exactly three entries: Administrators Full control, SYSTEM Full control, and CadeyServer Modify. Both dashboards run as CadeyServer ("Startup - IRL Stream" and "Startup - IRL Musta", RunLevel Limited, so the Administrators entry doesn't count for them), and FIX-9 keeps that account, so they still read and write.
- **By SID, not name:** this Windows is Norwegian (BUILTIN\Administratorer, NT-MYNDIGHET\SYSTEM), so every grant below uses SIDs: Administrators `S-1-5-32-544`, SYSTEM `S-1-5-18`, Users `S-1-5-32-545`, Authenticated Users `S-1-5-11`, and CadeyServer's own SID, looked up in step 2.
- **The four unknown SIDs:** they are not on these folders (C:\irl-stream is outside C:\server; read on 2026-10-21, step 1). If they are ever inherited here, the inheritance break removes them, and that is intended: only the three entries above remain.
- **Who opens these folders (IRLToolkit, 2026-10-21):** only CadeyServer: the two dashboards, IRLToolkit's tools, and vm/make-stream-urls.sh through multipass. OBS, the Linux VM and Multipass never read them. New files inherit the three entries through (OI)(CI).
- Owner of the folders: IRLToolkit. The Admin applies this, in an elevated window. No step reads or prints a file's content.

## 1. Read only: look first
In any PowerShell window:
```powershell
foreach ($d in 'C:\irl-stream\private', 'C:\irl-stream\private-musta') { "== $d  owner: $((Get-Acl $d).Owner)"; icacls $d }
```
Expected today (2026-10-21): owner CADEYSERVER\CadeyServer; inherited (I) entries for Administratorer (F), SYSTEM (F), Brukere (RX) and Godkjente brukere (M). If you see anything else, stop and send it to Security · Secrets.

## 2. Save today's permissions for the undo (elevated)
Open **Windows PowerShell as administrator**, then:
```powershell
$state = 'C:\ProgramData\SecurityConsole\state\SEC-SECRETS-10'
New-Item -ItemType Directory -Force $state | Out-Null
icacls $state /inheritance:r /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F'    # only Administrators and SYSTEM can change the saved copy
icacls 'C:\irl-stream\private'       /save "$state\private.acl" /t
icacls 'C:\irl-stream\private-musta' /save "$state\private-musta.acl" /t
$me = ([Security.Principal.NTAccount]"$env:COMPUTERNAME\CadeyServer").Translate([Security.Principal.SecurityIdentifier]).Value
"CadeyServer SID found: $([bool]$me)"
```
Each .acl file lists the folder and its files (relative names such as `private\keys.json`), each followed by one permissions line. It holds no file contents.

## 3. Apply (same elevated window)
```powershell
# Stop BEFORE anything changes if the account or the saved copies are missing.
if (-not $me) { throw 'CadeyServer SID not found: nothing changed' }
foreach ($f in "$state\private.acl", "$state\private-musta.acl") {
  if (-not (Test-Path $f) -or (Get-Item $f).Length -eq 0) { throw "saved permissions missing or empty ($f): nothing changed" }
}
foreach ($d in 'C:\irl-stream\private', 'C:\irl-stream\private-musta') {
  icacls $d /grant "*${me}:(OI)(CI)M"                              # first, so the dashboards never lose access
  if ($LASTEXITCODE -ne 0) { throw "could not grant CadeyServer on ${d}: stopped before removing anything" }
  icacls $d /inheritance:r                                          # stop inheriting; the inherited entries (Users, Authenticated Users, any unknown SID) go
  if ($LASTEXITCODE -ne 0) { throw "inheritance not removed on ${d}: run the undo (step 5)" }
  icacls $d /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' "*${me}:(OI)(CI)M"
  if ($LASTEXITCODE -ne 0) { throw "the three entries were not set on ${d}: run the undo (step 5)" }
  icacls "$d\*" /reset /t /c                                        # every file inside takes the folder's three entries
}
```
Run steps 2 and 3 in the same window, so `$state` and `$me` are still set.

## 4. Check
1. Elevated window: `icacls C:\irl-stream\private` and `icacls C:\irl-stream\private-musta`. Each must show exactly three entries, none marked (I): Administratorer (OI)(CI)(F), SYSTEM (OI)(CI)(F) and CadeyServer (OI)(CI)(M). There must be no Brukere and no Godkjente brukere entry.
2. Read and write test as CadeyServer, in a **normal (not elevated)** PowerShell window. It opens each file and closes it, without printing anything from it:
   ```powershell
   foreach ($d in 'C:\irl-stream\private', 'C:\irl-stream\private-musta') {
     $n = 0; foreach ($f in Get-ChildItem $d -File) { [IO.File]::OpenRead($f.FullName).Dispose(); $n++ }
     $t = Join-Path $d 'acl-write-test.tmp'; Set-Content $t 'x'; Remove-Item $t
     "$d : read $n files, write OK"
   }
   ```
3. Restart both dashboards through their own tasks, only when neither channel is live (check first: `node C:\irl-stream\tools\obs.js GetStreamStatus`). Do this whole patch before FIX-9 or after it, never while FIX-9 is being applied, since FIX-9 changes the same two tasks. Then:
   `powershell -File C:\irl-stream\tools\restart-dashboards.ps1`
4. After about 10 seconds, both dashboard pages must answer locally with **200**. Anything else (404, 500, no answer) means run the undo (step 5):
   ```powershell
   foreach ($u in 'http://127.0.0.1:3002/stream', 'http://127.0.0.1:3003/musta') {
     $code = try { (Invoke-WebRequest -UseBasicParsing $u -TimeoutSec 5).StatusCode } catch { if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 } }
     "$u -> $code $(if ($code -eq 200) { 'OK' } else { 'NOT OK: run the undo' })"
   }
   ```
5. Open the stream page once and check the keys still load (IRLToolkit can confirm).

## 5. Undo (elevated)
```powershell
$state = 'C:\ProgramData\SecurityConsole\state\SEC-SECRETS-10'
icacls 'C:\irl-stream\private'       /inheritance:e
icacls 'C:\irl-stream\private-musta' /inheritance:e
icacls 'C:\irl-stream' /restore "$state\private.acl"
icacls 'C:\irl-stream' /restore "$state\private-musta.acl"
```
Then run step 1 again: it must look as it did before. A file added after step 2 keeps the folder's new entries. Run `icacls "<that file>" /reset` to give it the old inherited ones.

## What this does not do
Every chat on this PC runs as CadeyServer too, so this keeps the secrets from other accounts and programs, not from the chats. The protections against leaks stay: `private*/` in .gitignore (SEC-SECRETS-8), check.js knowing the values (part 1 of SEC-SECRETS-10), and changing the keys if one ever leaks.
