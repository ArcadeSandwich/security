# SEC-NET-23 (v3): Ollama on mika-pc, reachable over Tailscale only from cadeyserver

Status: draft (v3; the lead reviews)
For: LISTEN-10 (the listening app's corrector on the main PC). Owner of the steps: the Admin, on mika-pc. Recheck: Security · Resilience (SEC-NET-25). Not a console pack: it runs on another PC.

## What changed in v3
- Ollama 0.40.6 is already installed on mika-pc and used locally (the factory, oak-dm work; qwen3:8b is pulled).
- Binding Ollama to the Tailscale address would cut off every local user. So Ollama stays on its default, `127.0.0.1:11434`, and a Windows port proxy republishes it on the Tailscale address only.
- No OLLAMA_NUM_PARALLEL or OLLAMA_MAX_LOADED_MODELS changes.

## Why this matters
- Ollama has no login. Anyone who reaches port 11434 can run models, and also pull new ones or delete the installed ones.
- The goal: Ollama is reachable from mika-pc itself, and over Tailscale only from cadeyserver (`100.107.176.17`), on mika-pc's Tailscale address (`100.94.195.32`). Nothing on the home network, nothing over IPv6, and no other Tailscale device.

## Two locks
1. **Ollama itself listens on 127.0.0.1 only.** No firewall rule for ollama.exe can expose it then, because it isn't listening on any card.
   - The one outside door is the port proxy (`netsh interface portproxy`, run by the IP Helper service, iphlpsvc). It listens only on `100.94.195.32:11434`, an IPv4 address that exists only on the Tailscale card.
   - So nothing listens for Ollama on the home network or on IPv6.
2. **The firewall:**
   - one allow rule, TCP 11434 from `100.107.176.17` only. It is port-based, with no program, because the proxy runs inside svchost, not ollama.exe;
   - one block rule for every other sender on the Tailscale address. A block rule wins over an allow rule in Windows, so this also holds if a broad Tailscale allow rule exists (on cadeyserver, Tailscale's own "Tailscale-In" rules allow every port from every tailnet device; mika-pc likely has them too).
   - In depth: Ollama's own program rules are switched off.

## Steps on mika-pc
Paste one block at a time. Steps 0 to 6 use an **ELEVATED PowerShell** (right-click PowerShell, Run as administrator), except where a step says NORMAL.

**0. What it is today (read-only):**
```powershell
"OLLAMA_HOST user:    $([Environment]::GetEnvironmentVariable('OLLAMA_HOST','User'))"
"OLLAMA_HOST machine: $([Environment]::GetEnvironmentVariable('OLLAMA_HOST','Machine'))"
"--- 11434 listening on:"; Get-NetTCPConnection -LocalPort 11434 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { "$($_.LocalAddress) ($((Get-Process -Id $_.OwningProcess).ProcessName))" }
"--- port proxies:"; netsh interface portproxy show v4tov4
```
**If 11434 listens on `0.0.0.0` or `::`, or OLLAMA_HOST is set to anything,** Ollama is open beyond mika-pc today. The factory reaches it at mika-pc's home address, which suggests exactly that, and it may also be reachable from the internet over IPv6.
- Clear OLLAMA_HOST. User value, in a NORMAL window: `[Environment]::SetEnvironmentVariable('OLLAMA_HOST', $null, 'User')`. Machine value, in the elevated window: `[Environment]::SetEnvironmentVariable('OLLAMA_HOST', $null, 'Machine')`.
- Quit Ollama from its tray icon and start it again from the Start menu. Run step 0 again: 11434 must now show `127.0.0.1` only.
- Note it for Security: the value before, and what 11434 listened on.
- The factory then has to use `http://127.0.0.1:11434` (SEC-NET-29, the Manager's). Until then, the factory's sorter can't reach Ollama and falls back.

**1. Tailscale "Run unattended": already on. Just confirm** it in the Tailscale tray, Preferences. With it on, 100.94.195.32 exists before logon.

**2. Save Ollama's own allow rules (for the undo), then switch them off:**
```powershell
$dir = 'C:\ProgramData\SecurityConsole-mika'; New-Item -ItemType Directory -Force -Path $dir | Out-Null
$apps = Get-NetFirewallApplicationFilter -All | Where-Object { $_.Program -match '\\ollama( app)?\.exe$' }
$rules = $apps | Get-NetFirewallRule | Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' }
$rules | Select-Object Name, DisplayName, Enabled, Profile | Export-Csv "$dir\ollama-rules-before.csv" -NoTypeInformation
$rules | ForEach-Object { Disable-NetFirewallRule -Name $_.Name; "switched off: $($_.DisplayName) ($($_.Profile))" }
"done: $(@($rules).Count) rule(s)"
```

**3. The firewall rules: allow cadeyserver, and block everyone else, on the Tailscale address:**
```powershell
New-NetFirewallRule -Name 'SEC-NET-23-ollama-from-cadeyserver' -DisplayName 'SEC-NET-23 Ollama from cadeyserver only' -Group 'SecurityConsole SEC-NET-23' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 11434 -LocalAddress 100.94.195.32 -RemoteAddress 100.107.176.17 -Profile Any
New-NetFirewallRule -Name 'SEC-NET-23-ollama-block-others' -DisplayName 'SEC-NET-23 Ollama: block every other sender' -Group 'SecurityConsole SEC-NET-23' -Direction Inbound -Action Block -Protocol TCP -LocalPort 11434 -LocalAddress 100.94.195.32 -RemoteAddress '0.0.0.0-100.94.195.31','100.94.195.33-100.107.176.16','100.107.176.18-255.255.255.255' -Profile Any
```
The block's remote ranges leave out exactly two addresses: cadeyserver (`100.107.176.17`) and mika-pc itself (`100.94.195.32`, for its own check in step 5).

**4. The port proxy: Ollama on the Tailscale address only:**
```powershell
netsh interface portproxy add v4tov4 listenaddress=100.94.195.32 listenport=11434 connectaddress=127.0.0.1 connectport=11434
Set-Service iphlpsvc -StartupType Automatic; Start-Service iphlpsvc
```

**5. Check (one block; paste the output to Security):**
```powershell
function Covers($ports) { foreach ($p in @($ports)) { if ($p -eq 'Any' -or $p -eq '11434') { return $true }; if ($p -match '^(\d+)-(\d+)$' -and 11434 -ge [int]$matches[1] -and 11434 -le [int]$matches[2]) { return $true } }; return $false }
"--- port proxies:"; netsh interface portproxy show v4tov4
"--- iphlpsvc: $((Get-Service iphlpsvc).Status), $((Get-Service iphlpsvc).StartType)"
"--- 11434 listening on:"; Get-NetTCPConnection -LocalPort 11434 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { "$($_.LocalAddress) ($((Get-Process -Id $_.OwningProcess).ProcessName))" }
"--- OLLAMA_HOST user/machine: '$([Environment]::GetEnvironmentVariable('OLLAMA_HOST','User'))' / '$([Environment]::GetEnvironmentVariable('OLLAMA_HOST','Machine'))'"
"--- every enabled inbound rule that can reach TCP 11434 (port 11434, Any or a range; program Any or Ollama)"
Get-NetFirewallRule -Direction Inbound -Enabled True | ForEach-Object {
  $pf = $_ | Get-NetFirewallPortFilter; $af = $_ | Get-NetFirewallApplicationFilter; $ad = $_ | Get-NetFirewallAddressFilter
  $protoOk = $pf.Protocol -in 'TCP', 'Any'
  $progOk = (-not $af.Program) -or $af.Program -eq 'Any' -or $af.Program -match '\\ollama( app)?\.exe$'
  if ($protoOk -and $progOk -and (Covers $pf.LocalPort)) { "$($_.Action) | $($_.DisplayName) | $($pf.Protocol) $(@($pf.LocalPort) -join ',') | $($_.Profile) | program $(if ($af.Program) { $af.Program } else { 'Any' }) | local $(@($ad.LocalAddress) -join ',') | remote $(@($ad.RemoteAddress) -join ',')" }
}
"--- from mika-pc itself:"; try { (Invoke-WebRequest http://100.94.195.32:11434/api/version -UseBasicParsing -TimeoutSec 5).StatusCode } catch { "failed: $($_.Exception.Message)" }
```
**Safe looks like this:**
- The port proxy lists `100.94.195.32 11434 -> 127.0.0.1 11434`, and nothing else for 11434.
- iphlpsvc shows Running, Automatic.
- **11434 listens on `100.94.195.32` (svchost) and `127.0.0.1` (ollama) ONLY, with no `0.0.0.0` and no `::`.**
- OLLAMA_HOST is empty for both user and machine.
- No other Allow rule in the list has remote `Any`, `LocalSubnet` or a home address. A broad Tailscale allow rule ("Tailscale-In", local = the Tailscale addresses, remote Any) may be listed; the block rule overrides it for 11434. Note it for Security, but it is not a failure.
- From mika-pc itself, the request answers `200`. Its own address is left out of the block rule, so this works. If it fails, send the output: it decides how the factory question (SEC-NET-25) is answered.
- Both SEC-NET-23 rules are listed: Allow from 100.107.176.17, and Block from every address except 100.107.176.17 and 100.94.195.32.

**6. Test from cadeyserver (Security does this; read-only):** `GET http://100.94.195.32:11434/api/version` answers 200. From a phone on the home Wi-Fi with Tailscale off, `http://<mika-pc's home address>:11434/api/version` must fail to connect.

## After a reboot
- The port proxy is kept across reboots. But iphlpsvc may start before Tailscale has its address, and then the 100.94.195.32 listener is missing. Step 5 then shows no svchost line, and the tower falls back.
- **Quick fix:** in an elevated window, `Restart-Service iphlpsvc`.
- **For good, the Admin's choice:**
  - **(a) Delayed start:** `sc.exe config iphlpsvc start= delayed-auto`. That starts it about 2 minutes after boot. With Run unattended, Tailscale is usually up by then, but it isn't guaranteed.
  - **(b) A startup task (recommended):** at startup, wait until 100.94.195.32 exists (up to 5 minutes), then restart iphlpsvc. That is reliable. In the elevated window:
```powershell
$cmd = 'for ($i=0; $i -lt 60; $i++) { if (Get-NetIPAddress -IPAddress 100.94.195.32 -ErrorAction SilentlyContinue) { Restart-Service iphlpsvc; break }; Start-Sleep 5 }'
$a = New-ScheduledTaskAction -Execute "$env:windir\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument "-NoProfile -NonInteractive -Command `"$cmd`""
$t = New-ScheduledTaskTrigger -AtStartup
$p = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName 'SEC-NET-23 portproxy after Tailscale' -Action $a -Trigger $t -Principal $p
```
  The task runs as SYSTEM, needs no password, and only restarts one service. Undo: `Unregister-ScheduledTask -TaskName 'SEC-NET-23 portproxy after Tailscale' -Confirm:$false`.

## Standing step: after every Ollama update
Run step 5 again. Then:
- if a new Ollama allow rule appears, run step 2;
- if 11434 listens on `0.0.0.0` or `::`, run step 0's fix. An update shouldn't set OLLAMA_HOST, but check anyway.

## If the tower says mika-pc is unreachable
Run step 5.
- No svchost line on 100.94.195.32: run `Restart-Service iphlpsvc` (see "After a reboot").
- No ollama line on 127.0.0.1: start Ollama from the Start menu.

The tower falls back meanwhile, so LISTEN is slower, not stopped.

## The second lock on Tailscale's side
- People shared in are already covered by FIX-7: they reach only `cadeyserver:7420`.
- The Admin's own other devices are not covered there (`autogroup:member -> *:*`). The block rule in step 3 refuses them.
- A Tailscale-side "only cadeyserver" lock would need per-device lines. That is the Admin's later choice.

## Undo
In an ELEVATED PowerShell on mika-pc:
```powershell
netsh interface portproxy delete v4tov4 listenaddress=100.94.195.32 listenport=11434
Remove-NetFirewallRule -Name 'SEC-NET-23-ollama-from-cadeyserver'
Remove-NetFirewallRule -Name 'SEC-NET-23-ollama-block-others'
Import-Csv 'C:\ProgramData\SecurityConsole-mika\ollama-rules-before.csv' | Where-Object { $_.Enabled -eq 'True' } | ForEach-Object { Enable-NetFirewallRule -Name $_.Name; "switched back on: $($_.DisplayName)" }
Unregister-ScheduledTask -TaskName 'SEC-NET-23 portproxy after Tailscale' -Confirm:$false -ErrorAction SilentlyContinue
```
Ollama stays on 127.0.0.1, its default. Step 0's fix is not undone: re-opening Ollama to the home network would be a new decision for Security and Server.

Sources:
- Ollama FAQ: OLLAMA_HOST, default 127.0.0.1:11434.
- Microsoft: "netsh interface portproxy" (served by the IP Helper service); Windows Firewall rule precedence (block rules override allow rules); New-NetFirewallRule; Register-ScheduledTask.
- Tailscale: "Run unattended" on Windows, and the Windows firewall rules tailscaled creates.
