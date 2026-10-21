# SEC-NET-23: Ollama on mika-pc, reachable only from cadeyserver

Status: reviewed-security
For: LISTEN-10 (the listening app's heavy AI on the main PC). Owner of the steps: the Admin, on mika-pc. Recheck: Security · Resilience (SEC-NET-25). Not a console pack: it runs on another PC.

## Why this matters
- Ollama has no login. Anyone who can reach port 11434 can run models, and also pull new ones or delete the installed ones.
- On mika-pc, the Windows firewall is the only lock in front of it.
- The goal: only cadeyserver (Tailscale address `100.107.176.17`) can reach mika-pc's port 11434. Nothing on the home network, nothing over IPv6, and no other Tailscale device.

## The choice: listen widely, and let the firewall scope be the lock
- **Option 1: bind to mika-pc's Tailscale address** (OLLAMA_HOST=<mika-pc's 100.x address>:11434).
  - Ollama starts at logon, often before Tailscale is connected.
  - Then that address doesn't exist yet, the bind fails, and Ollama doesn't retry. LISTEN-10 would silently have no AI until someone restarts Ollama by hand.
  - The Tailscale address can also change if mika-pc is ever re-added to the tailnet.
- **Option 2 (recommended): `OLLAMA_HOST=0.0.0.0:11434`.** Ollama always starts.
  - Ollama is written in Go, and Go opens `0.0.0.0` as a dual-stack socket. So Windows may show 11434 listening on `::` (IPv4 and IPv6) rather than on `0.0.0.0`. Either is fine.
  - **The lock is the firewall, not the bind.** There is one allow rule with Remote IP `100.107.176.17`, and every other rule that could reach 11434 is switched off.
  - That rule matches only that one IPv4 sender, so nothing on IPv6 (mika-pc's public IPv6 address included, if the router hands one out) and nothing on the home network is allowed in.
  - The cost: if someone later adds an allow-any rule, the home network or IPv6 could reach Ollama. Step 4's check shows that at once, and Resilience rechecks it.

## Steps on mika-pc
Paste one block at a time.

**1. Ollama settings: in a NORMAL PowerShell window (not "Run as administrator"),** so the values go to the account Ollama runs as:
```powershell
[Environment]::SetEnvironmentVariable('OLLAMA_HOST', '0.0.0.0:11434', 'User')
[Environment]::SetEnvironmentVariable('OLLAMA_NUM_PARALLEL', '1', 'User')
[Environment]::SetEnvironmentVariable('OLLAMA_MAX_LOADED_MODELS', '1', 'User')
ollama pull qwen3:8b
```
Then quit Ollama from its tray icon and start it again from the Start menu, so it reads the new values. No keys or tokens are involved.

**Steps 2 to 4: in an ELEVATED PowerShell** (right-click PowerShell, Run as administrator).

**2. Save the current Ollama rules (for the undo), then switch off every allow rule for Ollama:**
```powershell
$dir = 'C:\ProgramData\SecurityConsole-mika'; New-Item -ItemType Directory -Force -Path $dir | Out-Null
$apps = Get-NetFirewallApplicationFilter -All | Where-Object { $_.Program -match '\\ollama( app)?\.exe$' }
$rules = $apps | Get-NetFirewallRule | Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' }
$rules | Select-Object Name, DisplayName, Enabled, Profile | Export-Csv "$dir\ollama-rules-before.csv" -NoTypeInformation
$rules | ForEach-Object { Disable-NetFirewallRule -Name $_.Name; "switched off: $($_.DisplayName) ($($_.Profile))" }
```
This covers ollama.exe and "ollama app.exe", TCP and UDP, every profile, whether the rule came from the installer or from Windows' first-run "Allow access" prompt. The rules are switched off, not deleted, so Windows doesn't ask again.

**3. The one allow rule: TCP 11434 from cadeyserver only:**
```powershell
New-NetFirewallRule -Name 'SEC-NET-23-ollama-from-cadeyserver' -DisplayName 'SEC-NET-23 Ollama from cadeyserver only' -Group 'SecurityConsole SEC-NET-23' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 11434 -RemoteAddress 100.107.176.17 -Profile Any
```

**4. Check (one block; paste the output to Security):**
```powershell
function Covers($ports) { foreach ($p in @($ports)) { if ($p -eq 'Any' -or $p -eq '11434') { return $true }; if ($p -match '^(\d+)-(\d+)$' -and 11434 -ge [int]$matches[1] -and 11434 -le [int]$matches[2]) { return $true } }; return $false }
"--- listening on 11434 (0.0.0.0 or :: are both fine)"
Get-NetTCPConnection -LocalPort 11434 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort)" }
"--- every enabled inbound allow rule that can reach TCP 11434 (port 11434, Any or a range; program Any or Ollama)"
Get-NetFirewallRule -Direction Inbound -Action Allow -Enabled True | ForEach-Object {
  $pf = $_ | Get-NetFirewallPortFilter; $af = $_ | Get-NetFirewallApplicationFilter; $ad = $_ | Get-NetFirewallAddressFilter
  $protoOk = $pf.Protocol -in 'TCP', 'Any'
  $progOk = (-not $af.Program) -or $af.Program -eq 'Any' -or $af.Program -match '\\ollama( app)?\.exe$'
  if ($protoOk -and $progOk -and (Covers $pf.LocalPort)) { "$($_.DisplayName) | $($pf.Protocol) $(@($pf.LocalPort) -join ',') | $($_.Profile) | program $(if ($af.Program) { $af.Program } else { 'Any' }) | remote $(@($ad.RemoteAddress) -join ',')" }
}
"--- OLLAMA_HOST for this window's user (run step 1's window to see the Ollama user's value): $([Environment]::GetEnvironmentVariable('OLLAMA_HOST','User'))"
```
**Safe looks like this:**
- 11434 listens on `0.0.0.0` or `::`.
- The rule `SEC-NET-23 Ollama from cadeyserver only | TCP 11434 | Any | program Any | remote 100.107.176.17` is in the list.
- **No rule in the list has remote `Any`, `LocalSubnet` or a home-network address.**
  - Windows' own service rules may appear when they have a specific remote and a specific program. The list includes program-Any rules only, plus Ollama's, so most service rules don't show.
  - Any rule with remote Any or LocalSubnet is a finding: switch it off, or scope it, and send the output.

**5. Test from cadeyserver (Security does this; read-only):** `GET http://<mika-pc's Tailscale address>:11434/api/version` answers 200. From a phone on the home Wi-Fi with Tailscale off, `http://<mika-pc's home address>:11434/api/version` must time out.

## The second lock (Tailscale)
- **Already covered by FIX-7 for people shared in.** FIX-7's policy lets `autogroup:shared` reach only `cadeyserver:7420`, so no shared person can reach mika-pc at all.
  - A policy "tests" line can't name `autogroup:shared`: Tailscale's tests take only a specific user, group, tag or host. So none is added here.
- **Not covered: the Admin's own other devices.** The line `autogroup:member -> *:*` lets every one of the Admin's devices reach everything, the phone included.
  - Tailscale rules only allow; they can't carve out an exception. So "only cadeyserver reaches mika-pc:11434" would mean replacing that line with one line per device, for example cadeyserver to mika-pc:11434 and the phone to cadeyserver:443.
  - That is the Admin's later choice. Security can draft it.

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
Then restart Ollama from the tray. It then listens on 127.0.0.1 only, which is its default.

## After Ollama updates
The installer keeps the same path (`%LOCALAPPDATA%\Programs\Ollama`), so the switched-off rules keep matching. If Windows ever shows an "Allow access" prompt for Ollama again, press Cancel and run step 4. Resilience rechecks after each update (SEC-NET-25).

Sources:
- Ollama FAQ: "How do I configure Ollama server?" (OLLAMA_HOST, OLLAMA_NUM_PARALLEL, OLLAMA_MAX_LOADED_MODELS).
- Go net package: a wildcard listen address gives a dual-stack socket.
- Microsoft: New-NetFirewallRule, and Windows Firewall rule scope.
- Tailscale policy syntax, tests (https://tailscale.com/kb/1337/policy-syntax): "src" is a user, group, tag or host.
