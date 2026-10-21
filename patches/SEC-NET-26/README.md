# SEC-NET-26: whisper-server on mika-pc, reachable only from cadeyserver

Status: draft
For: LISTEN-12 (speech to text on the main PC). Plan: `C:\server\ai-workspace\logs\TRANSCRIPT-LOG.md`, "PLAN LISTEN-12". Owner of the steps: the Admin, on mika-pc. Recheck: Security · Resilience (SEC-NET-27). Built like SEC-NET-23. Not a console pack: it runs on another PC.

## Why this matters
- **whisper-server has no login.** Anyone who can reach its port can send audio and get text back.
- It also has a `/load` route that makes it load another model file **from any path on mika-pc's disk**. No option switches `/load` off or limits it (checked against `whisper-server --help` of the tower's build: there is `--request-path`, which only adds a prefix to every route and so hides nothing). So **the firewall scope and the bind are the only locks**.
- The goal: only cadeyserver (Tailscale address `100.107.176.17`) can reach mika-pc's port 7426 (Tailscale address `100.94.195.32`). Nothing on the home network, nothing over IPv6, and no other Tailscale device.

## Two locks
1. **The bind:** `--host 100.94.195.32 --port 7426`. whisper-server listens only on mika-pc's Tailscale address, which doesn't exist on the home network card or on IPv6.
2. **The firewall:** one allow rule, TCP 7426 from `100.107.176.17` only. Every allow rule that Windows' "Allow access" prompt makes for whisper-server.exe is switched off.

The rule goes in **before** whisper-server first starts on that address (steps 3 and 4 come before step 5).

## No audio on mika-pc's disk
- **Never pass `--convert`.** With `--convert`, whisper-server writes each upload to a temporary file (in `--tmp-dir`, by default its own folder) for ffmpeg.
- Without it, the audio is read from the request in memory and never written.
- The tower already sends 16 kHz mono WAV (it makes one with ffmpeg on its own side), so `--convert` isn't needed.
- whisper-server writes no log of the text. The bat file below doesn't redirect its output to a file.

## Downloads (the Admin's; nothing else)
- **whisper.cpp, from github.com/ggml-org/whisper.cpp releases only:** the Windows CUDA 12 build (the asset named `whisper-cublas-12.x...-bin-x64.zip` in the same release as the tower's).
  - The tower's copy is `whisper-cuda12.zip`: **684,913,404 bytes, SHA-256 `afef0b881c500958921c3f5523b50e59ee2ec9b6f5cbd25b324c51ed308a957a`**.
  - Compare the size and the SHA-256 with GitHub's digest on the release page before unpacking.
  - The tower's own download of this zip isn't recorded in AIW-LOG (the CUDA 11 one is). The Manager should add its release tag and asset name.
- **The models: copy them from the tower, no new download.** The picked model (ggml-large-v3-turbo-q5_0.bin, 574,041,195 bytes, or nb-whisper-medium-q5_0.bin, 539,212,484 bytes) and ggml-silero-v5.1.2.bin (the voice detector) come from `C:\server\ai-workspace\app\listen\bin`. Their SHA-256 values are in TRANSCRIPT-LOG ("LISTEN-6 downloads"). Check them after copying with `Get-FileHash <file> -Algorithm SHA256`.
- Folder on mika-pc: `C:\speech\` (the program in `C:\speech\whisper\`, the models in `C:\speech\models\`).

## Steps on mika-pc
Paste one block at a time.

**1. Put the files in place (NORMAL PowerShell window).** Unpack the zip to `C:\speech\whisper\`, copy the models to `C:\speech\models\`, and check the SHA-256 values (see Downloads).

**2. Tailscale "Run unattended": already on** (SEC-NET-23). Check it in the Tailscale tray, Preferences.

**Steps 3, 4 and 6: in an ELEVATED PowerShell** (right-click PowerShell, Run as administrator).

**3. Switch off any allow rule Windows made for whisper-server.exe (and save them for the undo):**
```powershell
$dir = 'C:\ProgramData\SecurityConsole-mika'; New-Item -ItemType Directory -Force -Path $dir | Out-Null
$apps = Get-NetFirewallApplicationFilter -All | Where-Object { $_.Program -match '\\whisper-server\.exe$' }
$rules = $apps | Get-NetFirewallRule | Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' }
$rules | Select-Object Name, DisplayName, Enabled, Profile | Export-Csv "$dir\whisper-rules-before.csv" -NoTypeInformation
$rules | ForEach-Object { Disable-NetFirewallRule -Name $_.Name; "switched off: $($_.DisplayName) ($($_.Profile))" }
"done: $(@($rules).Count) rule(s)"
```
On a fresh install there are none yet; that's fine. If Windows later shows an "Allow access" prompt for whisper-server, press **Cancel** and run this step again.

**4. The one allow rule: TCP 7426 from cadeyserver only:**
```powershell
New-NetFirewallRule -Name 'SEC-NET-26-whisper-from-cadeyserver' -DisplayName 'SEC-NET-26 whisper-server from cadeyserver only' -Group 'SecurityConsole SEC-NET-26' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 7426 -RemoteAddress 100.107.176.17 -Profile Any
```

**5. The start file and the logon task.** Save this as `C:\speech\start-speech.bat` (it is the only way whisper-server is started):
```bat
@echo off
title Speech (100.94.195.32:7426)
rem SEC-NET-26 / LISTEN-12: whisper-server on mika-pc's Tailscale address only, from cadeyserver only (firewall rule SEC-NET-26).
rem Never --convert (no audio on disk). The loop also covers a failed bind at logon (Tailscale not up yet): it retries every 10 s.
cd /d C:\speech\whisper
:loop
whisper-server.exe -m C:\speech\models\ggml-large-v3-turbo-q5_0.bin --host 100.94.195.32 --port 7426 -t 4 --vad -vm C:\speech\models\ggml-silero-v5.1.2.bin
timeout /t 10 /nobreak >nul
goto loop
```
Use nb-whisper-medium-q5_0.bin instead if that is the model LISTEN-6 picked.

Then, in the ELEVATED window, the logon task (it runs as the Admin, only while logged in, at BelowNormal priority):
```powershell
$a = New-ScheduledTaskAction -Execute 'C:\speech\start-speech.bat'
$t = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$s = New-ScheduledTaskSettingsSet -Priority 7 -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$p = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'Speech - whisper-server (SEC-NET-26)' -Action $a -Trigger $t -Settings $s -Principal $p
Start-ScheduledTask -TaskName 'Speech - whisper-server (SEC-NET-26)'
```
Notes:
- Priority 7 is BelowNormal. The task runs with normal rights (Limited), not as administrator.
- If the elevated window runs under another admin account, replace `$env:USERNAME` with the Admin's own user name.

**6. Check (ELEVATED; one block; paste the output to Security):**
```powershell
function Covers($ports) { foreach ($p in @($ports)) { if ($p -eq 'Any' -or $p -eq '7426') { return $true }; if ($p -match '^(\d+)-(\d+)$' -and 7426 -ge [int]$matches[1] -and 7426 -le [int]$matches[2]) { return $true } }; return $false }
"--- listening on 7426"
Get-NetTCPConnection -LocalPort 7426 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort)" }
"--- every enabled inbound allow rule that can reach TCP 7426 (port 7426, Any or a range; program Any or whisper-server)"
Get-NetFirewallRule -Direction Inbound -Action Allow -Enabled True | ForEach-Object {
  $pf = $_ | Get-NetFirewallPortFilter; $af = $_ | Get-NetFirewallApplicationFilter; $ad = $_ | Get-NetFirewallAddressFilter
  $protoOk = $pf.Protocol -in 'TCP', 'Any'
  $progOk = (-not $af.Program) -or $af.Program -eq 'Any' -or $af.Program -match '\\whisper-server\.exe$'
  if ($protoOk -and $progOk -and (Covers $pf.LocalPort)) { "$($_.DisplayName) | $($pf.Protocol) $(@($pf.LocalPort) -join ',') | $($_.Profile) | program $(if ($af.Program) { $af.Program } else { 'Any' }) | remote $(@($ad.RemoteAddress) -join ',')" }
}
"--- the task"
Get-ScheduledTask -TaskName 'Speech - whisper-server (SEC-NET-26)' | ForEach-Object { "$($_.State) | priority $($_.Settings.Priority) | runlevel $($_.Principal.RunLevel) | $($_.Actions.Execute)" }
"--- --convert in the start file: $(Select-String -Path C:\speech\start-speech.bat -Pattern '--convert' -SimpleMatch -Quiet)"
"--- audio-like files in C:\speech: $(@(Get-ChildItem C:\speech -Recurse -File -Include *.wav,*.mp3,*.m4a,*.ogg,*.webm -ErrorAction SilentlyContinue).Count)"
```
**Safe looks like this:**
- **whisper-server listens on `100.94.195.32:7426` only, not on `0.0.0.0` or `::`.** If nothing is listed, Tailscale was not up yet; the loop retries every 10 seconds.
- The rule `SEC-NET-26 whisper-server from cadeyserver only | TCP 7426 | Any | program Any | remote 100.107.176.17` is in the list.
- **No rule in the list has remote `Any`, `LocalSubnet` or a home-network address.**
- The task shows Running, priority 7, runlevel Limited.
- `--convert` in the start file: False.
- Audio-like files: 0.

**7. Test from cadeyserver (Security does this; read-only):** `GET http://100.94.195.32:7426/` answers (the server's page). From a phone on the home Wi-Fi with Tailscale off, `http://<mika-pc's home address>:7426/` must fail to connect.

## Standing step: after every whisper.cpp update
Run step 6 again. Then:
- if a rule with remote `Any` appears, run step 3;
- if the program's path changed (a new folder), update `start-speech.bat` and the rule check;
- check that the new start file still has no `--convert`.

## If the tower says the main PC's speech server is unreachable
- The tower reads the piece itself, as today, so nothing is lost; it is only slower.
- On mika-pc, check that the "Speech" window is open. If it isn't, run the task again: `Start-ScheduledTask -TaskName 'Speech - whisper-server (SEC-NET-26)'`.
- It runs only while the Admin is logged in to mika-pc.

## Undo
In an ELEVATED PowerShell on mika-pc:
```powershell
Unregister-ScheduledTask -TaskName 'Speech - whisper-server (SEC-NET-26)' -Confirm:$false
Get-Process whisper-server -ErrorAction SilentlyContinue | Stop-Process
Remove-NetFirewallRule -Name 'SEC-NET-26-whisper-from-cadeyserver'
Import-Csv 'C:\ProgramData\SecurityConsole-mika\whisper-rules-before.csv' | Where-Object { $_.Enabled -eq 'True' } | ForEach-Object { Enable-NetFirewallRule -Name $_.Name; "switched back on: $($_.DisplayName)" }
```
Then close the "Speech" window if it is still open. Deleting `C:\speech\` is the Admin's own step, if wanted. The tower's `speechRemote` setting goes back to empty (the Manager's).

Sources:
- whisper.cpp server: `whisper-server --help` (--host, --port, --convert, --tmp-dir, --request-path; the /load and /inference routes in examples/server).
- Microsoft: New-NetFirewallRule and Register-ScheduledTask (task priority 7 = below normal).
- Tailscale: "Run unattended" on Windows.
