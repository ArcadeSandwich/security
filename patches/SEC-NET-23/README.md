# SEC-NET-23: Ollama on mika-pc, reachable only from cadeyserver

Status: draft
For: LISTEN-10 (the listening app's heavy AI on the main PC). Owner of the steps: the Admin, on mika-pc. Recheck: Security · Resilience (SEC-NET-25). Not a console pack: it runs on another PC.

## Why this matters
- Ollama has no login. Anyone who can reach port 11434 can run models, and also pull new ones or delete the installed ones.
- On mika-pc, the Windows firewall is the only lock in front of it.
- The goal: only cadeyserver (Tailscale address `100.107.176.17`) can reach mika-pc's port 11434. Nothing on the home network can, nothing over IPv6 can, and no other Tailscale device can.

## The choice: bind 0.0.0.0, and let the firewall scope do the limiting
- **Option 1: bind to mika-pc's Tailscale address** (OLLAMA_HOST=<mika-pc's 100.x address>:11434).
  - Ollama starts at logon, often before Tailscale is connected.
  - Then that address doesn't exist yet, the bind fails, and Ollama doesn't retry. LISTEN-10 would silently have no AI until someone restarts Ollama by hand.
  - The Tailscale address can also change if mika-pc is ever re-added to the tailnet.
- **Option 2 (recommended): `OLLAMA_HOST=0.0.0.0:11434`.**
  - Ollama always starts.
  - `0.0.0.0` is IPv4 only, so nothing listens on IPv6. mika-pc's public IPv6 address, if the router hands one out, stays closed.
  - The lock is the firewall: one allow rule scoped to `100.107.176.17`, with every allow-any rule for Ollama switched off.
  - The cost: if someone later adds an allow-any rule, the home network could reach Ollama. Step 3's check shows that at once, and Resilience rechecks it.

## Steps (an elevated PowerShell on mika-pc: right-click PowerShell, Run as administrator)
Paste one block at a time.

**1. Ollama settings (user environment, no keys):**
```powershell
[Environment]::SetEnvironmentVariable('OLLAMA_HOST', '0.0.0.0:11434', 'User')
[Environment]::SetEnvironmentVariable('OLLAMA_NUM_PARALLEL', '1', 'User')
[Environment]::SetEnvironmentVariable('OLLAMA_MAX_LOADED_MODELS', '1', 'User')
```
Then quit Ollama from its tray icon and start it again from the Start menu, so it reads the new values. Pull the model once, in a normal window: `ollama pull qwen3:8b`.

**2. Save the current Ollama rules (for the undo), then switch off every allow rule for Ollama:**
```powershell
$apps = Get-NetFirewallApplicationFilter -All | Where-Object { $_.Program -match '\\ollama( app)?\.exe$' }
$rules = $apps | Get-NetFirewallRule | Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' }
$rules | Select-Object Name, DisplayName, Enabled, Profile | Export-Csv "$env:USERPROFILE\Desktop\ollama-rules-before.csv" -NoTypeInformation
$rules | ForEach-Object { Disable-NetFirewallRule -Name $_.Name; "switched off: $($_.DisplayName) ($($_.Profile))" }
```
This covers ollama.exe and "ollama app.exe", TCP and UDP, every profile: Windows' first-run "Allow access" prompt and anything the installer made. The rules are switched off, not deleted, so Windows doesn't ask again.

**3. The one allow rule: TCP 11434 from cadeyserver only:**
```powershell
New-NetFirewallRule -Name 'SEC-NET-23-ollama-from-cadeyserver' -DisplayName 'SEC-NET-23 Ollama from cadeyserver only' -Group 'SecurityConsole SEC-NET-23' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 11434 -RemoteAddress 100.107.176.17 -Profile Any
```

**4. Check (paste the output to Security):**
```powershell
"--- listening on 11434"; Get-NetTCPConnection -LocalPort 11434 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort)" }
"--- enabled inbound allow rules that reach 11434 or Ollama"
$ids = @(Get-NetFirewallPortFilter -All | Where-Object { @($_.LocalPort) -contains '11434' -or @($_.LocalPort) -contains 'Any' } | ForEach-Object InstanceID)
$prog = @(Get-NetFirewallApplicationFilter -All | Where-Object { $_.Program -match '\\ollama( app)?\.exe$' } | ForEach-Object InstanceID)
Get-NetFirewallRule -Direction Inbound -Action Allow -Enabled True | Where-Object { ($prog -contains $_.Name) -or ($ids -contains $_.Name -and @(($_ | Get-NetFirewallPortFilter).LocalPort) -contains '11434') } | ForEach-Object { $a = $_ | Get-NetFirewallAddressFilter; $p = $_ | Get-NetFirewallPortFilter; "$($_.DisplayName) | $($p.Protocol) $($p.LocalPort) | $($_.Profile) | remote $($a.RemoteAddress -join ',')" }
"--- OLLAMA_HOST (user): $([Environment]::GetEnvironmentVariable('OLLAMA_HOST','User'))"
```
**Safe looks like this:**
- 11434 listens on `0.0.0.0` only, with no `::` line.
- Exactly one rule is listed: `SEC-NET-23 Ollama from cadeyserver only | TCP 11434 | Any | remote 100.107.176.17`.
- OLLAMA_HOST is `0.0.0.0:11434`.

Any other rule in the list is a finding.

**5. Test from cadeyserver (Security does this; read-only):** `GET http://<mika-pc's Tailscale address>:11434/api/version` answers 200. From a phone on the home Wi-Fi with Tailscale off, `http://<mika-pc's home address>:11434/api/version` must time out.

## Optional second lock: the Tailscale access rule
- FIX-7's policy already keeps people shared in away from mika-pc: they reach only `cadeyserver:7420`. Add a test line so the policy can't be saved if that ever changes:
  `{ "src": "autogroup:shared", "deny": ["mika-pc:11434"] }`
- **Limit:** the policy's line `autogroup:member -> *:*` lets all of the Admin's own devices reach everything, including the phone. Tailscale rules can only allow, never carve out an exception. So "only cadeyserver" can't be added on top of that line.
  - A real second lock would mean replacing that line with a list of what each device may reach (for example, cadeyserver to mika-pc:11434, and the phone to cadeyserver:443).
  - That is a bigger policy change, for the Admin to decide; Security can write it.
- Steps for the test line: open https://login.tailscale.com/admin/acls/file, copy the current policy as a backup, add the line inside `"tests"`, save. Undo: paste the backup.

## Undo
In an elevated PowerShell on mika-pc:
```powershell
Remove-NetFirewallRule -Name 'SEC-NET-23-ollama-from-cadeyserver'
Import-Csv "$env:USERPROFILE\Desktop\ollama-rules-before.csv" | Where-Object { $_.Enabled -eq 'True' } | ForEach-Object { Enable-NetFirewallRule -Name $_.Name; "switched back on: $($_.DisplayName)" }
[Environment]::SetEnvironmentVariable('OLLAMA_HOST', $null, 'User')
[Environment]::SetEnvironmentVariable('OLLAMA_NUM_PARALLEL', $null, 'User')
[Environment]::SetEnvironmentVariable('OLLAMA_MAX_LOADED_MODELS', $null, 'User')
```
Then restart Ollama from the tray. Ollama then listens on 127.0.0.1 only, which is its default.

## After Ollama updates
The installer keeps the same path (`%LOCALAPPDATA%\Programs\Ollama`), so the switched-off rules keep matching. If Windows ever shows an "Allow access" prompt for Ollama again, press Cancel and run step 4. Resilience rechecks after each update (SEC-NET-25).

Sources: Ollama FAQ ("How do I configure Ollama server?", OLLAMA_HOST, OLLAMA_NUM_PARALLEL, OLLAMA_MAX_LOADED_MODELS); Microsoft, New-NetFirewallRule and Windows Firewall rule scope; Tailscale, ACL tests (https://tailscale.com/kb/1018/acls).
