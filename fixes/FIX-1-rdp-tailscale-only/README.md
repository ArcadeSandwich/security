# SEC-FIX-1: Remote Desktop from Tailscale only

Status: reviewed-security

- **Finding:** W-1 (high). Remote Desktop (port 3389, TCP and UDP) is allowed from any address on every network profile, so any device on the home network can reach the sign-in screen.
- **What it does:** every enabled inbound allow rule on port 3389 gets Remote IP `100.64.0.0/10` and `fd7a:115c:a1e0::/48` (Tailscale's IPv4 and IPv6 ranges). Remote Desktop stays on; it works from the Admin's Tailscale devices only.
- **What it does not do:** it doesn't switch Remote Desktop off, change NLA or passwords, or touch any other rule. Over Tailscale, the separate "Tailscale-In" rule (W-9) still lets tailnet devices in; SEC-FIX-3 handles that.
- **Risk:** low. If the Admin uses Remote Desktop from a device without Tailscale, that stops working; `-Undo` brings the old rules back exactly.
- **Windows permission:** an elevated window (administrator), for the dry run that records state, for Apply and for Undo. `check.ps1` and an unelevated dry run need none.

## Use
1. `fix.ps1 -DryRun` (elevated): records the matching rules' exact state to the protected state folder (below) and shows the change.
2. `fix.ps1 -Apply` (elevated): refuses if the dry run is missing, older than 24 hours, or the rules changed since; otherwise sets the scope.
3. `check.ps1`: PASS when every enabled rule on 3389 is limited to Tailscale.
4. `fix.ps1 -Undo` (elevated): puts Enabled, Profile and Remote IP back exactly as the dry run recorded them.

Elevated runs are logged in `log.txt` in the state folder. Source: Microsoft, Windows Firewall rules (Scope, Remote IP addresses); Tailscale, "What are these 100.x.y.z addresses" (100.64.0.0/10, fd7a:115c:a1e0::/48).

## Where the state is kept
`C:\ProgramData\SecurityConsole\state\FIX-1-rdp-tailscale-only\` (`Get-PackStateDir` in `lib\common.ps1`). It is created elevated, with only Administrators and SYSTEM (inheritance off). A folder with another owner, or one that anybody else can write to, is refused. The state is not kept inside the pack, because the console runs packs from a temporary copy. `-Undo` checks every recorded rule before it changes any: the rule must still be picked by this pack today, the profile a valid number and every address valid. Otherwise it changes nothing.

## How the console calls me
1. Stage 1 (not elevated): `fix.ps1 -DryRun` lists the rules (lines starting `RULE`) and the change, and records nothing. The Admin reads this and says yes or no.
2. Stage 2 (one elevated session, only for a yes): `fix.ps1 -DryRun` records the state. The console checks that the recorded rule names are the same as the ones stage 1 showed. Then it runs `fix.ps1 -Apply`, then `check.ps1`.
3. To undo: `fix.ps1 -Undo` in an elevated session, then `check.ps1` shows the old state (FAIL is expected after an undo).
