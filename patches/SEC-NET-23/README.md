# SEC-NET-23: Ollama on mika-pc, reachable only from cadeyserver

Status: reviewed-security
For: LISTEN-10 (the listening app's heavy AI on the main PC). Owner of the steps: the Admin, on mika-pc. Recheck: Security · Resilience (SEC-NET-25). Not a console pack: it runs on another PC.

## Why this matters
- Ollama has no login. Anyone who can reach port 11434 can run models, and also pull new ones or delete the installed ones.
- The goal: only cadeyserver (Tailscale address `100.107.176.17`) can reach mika-pc's Ollama (Tailscale address `100.94.195.32`). Nothing on the home network, nothing over IPv6, and no other Tailscale device.

## Two locks
1. **The bind:** `OLLAMA_HOST=100.94.195.32:11434`. Ollama listens only on mika-pc's Tailscale address. It doesn't exist on the home network card or on any IPv6 address, so no rule change can expose it there.
2. **The firewall:** one allow rule, TCP 11434 from `100.107.176.17` only. Every allow rule for Ollama's programs is switched off, so no other Tailscale device gets in either.

**Why not 0.0.0.0:**
- Then the firewall would be the only lock.
- Ollama's updater, or Windows' "Allow access" prompt, can re-add an allow-any rule for ollama.exe. One changed rule would then open Ollama to the home network, and to the internet through mika-pc's public IPv6 address if the router hands one out.

**The cost: the logon race.**
- The Tailscale address exists only once Tailscale is connected. Without "Run unattended", Tailscale on Windows connects only after the Admin logs in.
- If Ollama starts first, its bind fails and it doesn't retry. It stays down until someone restarts it.
- The tower then quietly uses its fallback, so this is a slow moment for LISTEN, not an outage.
- Step 1 below ("Run unattended") removes the race: the address then exists before anyone logs in.

## Steps on mika-pc
Paste one block at a time.

The order matters: Ollama moves to the Tailscale address only after the firewall rules are in place (step 5), so it is never reachable there unguarded.

**1. Pull the model while Ollama is still on localhost.** In a NORMAL PowerShell window (not "Run as administrator"), with no OLLAMA_HOST set: `ollama pull qwen3:8b`.

**2. Tailscale: Run unattended (the Admin's Tailscale setting).** Click the Tailscale icon in the tray, then Preferences, and switch on **Run unattended**. Tailscale then connects when Windows starts, before logon, so 100.94.195.32 exists by the time Ollama starts.

**Steps 3 and 4: in an ELEVATED PowerShell** (right-click PowerShell, Run as administrator).

**3. Save the current Ollama rules (for the undo), then switch off every allow rule for Ollama:**
```powershell
$dir = 'C:\ProgramData\SecurityConsole-mika'; New-Item -ItemType Directory -Force -Path $dir | Out-Null
$apps = Get-NetFirewallApplicationFilter -All | Where-Object { $_.Program -match '\\ollama( app)?\.exe$' }
$rules = $apps | Get-NetFirewallRule | Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' }
$rules | Select-Object Name, DisplayName, Enabled, Profile | Export-Csv "$dir\ollama-rules-before.csv" -NoTypeInformation
$rules | ForEach-Object { Disable-NetFirewallRule -Name $_.Name; "switched off: $($_.DisplayName) ($($_.Profile))" }
```
This covers ollama.exe and "ollama app.exe", TCP and UDP, every profile, whether the rule came from the installer or from Windows' first-run "Allow access" prompt. The rules are switched off, not deleted, so Windows doesn't ask again.

**4. The one allow rule: TCP 11434 from cadeyserver only:**
```powershell
New-NetFirewallRule -Name 'SEC-NET-23-ollama-from-cadeyserver' -DisplayName 'SEC-NET-23 Ollama from cadeyserver only' -Group 'SecurityConsole SEC-NET-23' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 11434 -RemoteAddress 100.107.176.17 -Profile Any
```

**5. Only now: move Ollama to the Tailscale address.** In a NORMAL PowerShell window, so the values go to the account Ollama runs as:
```powershell
[Environment]::SetEnvironmentVariable('OLLAMA_HOST', '100.94.195.32:11434', 'User')
[Environment]::SetEnvironmentVariable('OLLAMA_NUM_PARALLEL', '1', 'User')
[Environment]::SetEnvironmentVariable('OLLAMA_MAX_LOADED_MODELS', '1', 'User')
```
Then quit Ollama from its tray icon and start it again from the Start menu, so it reads the new values. No keys or tokens are involved.

**6. Check (ELEVATED; one block; paste the output to Security):**
```powershell
function Covers($ports) { foreach ($p in @($ports)) { if ($p -eq 'Any' -or $p -eq '11434') { return $true }; if ($p -match '^(\d+)-(\d+)$' -and 11434 -ge [int]$matches[1] -and 11434 -le [int]$matches[2]) { return $true } }; return $false }
"--- listening on 11434"
Get-NetTCPConnection -LocalPort 11434 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort)" }
"--- every enabled inbound allow rule that can reach TCP 11434 (port 11434, Any or a range; program Any or Ollama)"
Get-NetFirewallRule -Direction Inbound -Action Allow -Enabled True | ForEach-Object {
  $pf = $_ | Get-NetFirewallPortFilter; $af = $_ | Get-NetFirewallApplicationFilter; $ad = $_ | Get-NetFirewallAddressFilter
  $protoOk = $pf.Protocol -in 'TCP', 'Any'
  $progOk = (-not $af.Program) -or $af.Program -eq 'Any' -or $af.Program -match '\\ollama( app)?\.exe$'
  if ($protoOk -and $progOk -and (Covers $pf.LocalPort)) { "$($_.DisplayName) | $($pf.Protocol) $(@($pf.LocalPort) -join ',') | $($_.Profile) | program $(if ($af.Program) { $af.Program } else { 'Any' }) | remote $(@($ad.RemoteAddress) -join ',')" }
}
```
**Safe looks like this:**
- **Ollama listens on `100.94.195.32:11434` only, not on `0.0.0.0` or `::`.** If nothing is listed, Ollama lost the logon race: see "If the tower says mika-pc is unreachable" below.
- The rule `SEC-NET-23 Ollama from cadeyserver only | TCP 11434 | Any | program Any | remote 100.107.176.17` is in the list.
- **No rule in the list has remote `Any`, `LocalSubnet` or a home-network address.** Any such rule is a finding: switch it off, or scope it, and send the output.

**7. Test from cadeyserver (Security does this; read-only):** `GET http://100.94.195.32:11434/api/version` answers 200. From a phone on the home Wi-Fi with Tailscale off, `http://<mika-pc's home address>:11434/api/version` must fail to connect.

## Standing step: after every Ollama update
**Run step 6 again after every Ollama update** (Ollama updates itself, and the tray shows "Restart to update"). Then do two things:
- If a new rule appears with remote `Any`, run step 3 again.
- If Ollama listens anywhere other than 100.94.195.32, run step 5 again.

Resilience rechecks after each update (SEC-NET-25). If Windows shows an "Allow access" prompt for Ollama, press Cancel.

## If the tower says mika-pc is unreachable
Usually Ollama started before Tailscale (the logon race) and its bind failed. On mika-pc, quit Ollama from its tray icon and start it again from the Start menu. With "Run unattended" on (step 2) this should not happen. Meanwhile the tower uses its fallback, so LISTEN is slower, not stopped.

## The second lock on Tailscale's side
- **Already covered by FIX-7 for people shared in.** FIX-7's policy lets them reach only `cadeyserver:7420`, so no shared person can reach mika-pc at all.
- **Not covered: the Admin's own other devices.** The policy line `autogroup:member -> *:*` lets every one of the Admin's devices reach everything, so the phone could reach mika-pc's Ollama over Tailscale. The firewall rule in step 4 still refuses it.
  - Tailscale rules only allow; they can't carve out an exception. So a Tailscale-side "only cadeyserver" lock would mean replacing that line with one line per device.
  - That is the Admin's later choice, and Security can draft it.

## Undo
Firewall lines in an ELEVATED PowerShell on mika-pc:
```powershell
Remove-NetFirewallRule -Name 'SEC-NET-23-ollama-from-cadeyserver'
Import-Csv 'C:\ProgramData\SecurityConsole-mika\ollama-rules-before.csv' | Where-Object { $_.Enabled -eq 'True' } | ForEach-Object { Enable-NetFirewallRule -Name $_.Name; "switched back on: $($_.DisplayName)" }
```
Settings in a NORMAL PowerShell window:
```powershell
[Environment]::SetEnvironmentVariable('OLLAMA_HOST', $null, 'User')
[Environment]::SetEnvironmentVariable('OLLAMA_NUM_PARALLEL', $null, 'User')
[Environment]::SetEnvironmentVariable('OLLAMA_MAX_LOADED_MODELS', $null, 'User')
```
Then restart Ollama from the tray. It then listens on 127.0.0.1 only, which is its default. "Run unattended" can stay on, or be switched off in Tailscale's Preferences.

Sources:
- Ollama FAQ: "How do I configure Ollama server?" (OLLAMA_HOST, OLLAMA_NUM_PARALLEL, OLLAMA_MAX_LOADED_MODELS).
- Tailscale: "Run unattended" on Windows.
- Microsoft: New-NetFirewallRule, and Windows Firewall rule scope.
- Tailscale policy syntax, tests (https://tailscale.com/kb/1337/policy-syntax).
