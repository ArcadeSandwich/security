# SEC-FIX-1: Remote Desktop from Tailscale only

Status: draft

- **Finding:** W-1 (high). Remote Desktop (port 3389, TCP and UDP) is allowed from any address on every network profile, so any device on the home network can reach the sign-in screen.
- **What it does:** every enabled inbound allow rule on port 3389 gets Remote IP `100.64.0.0/10` and `fd7a:115c:a1e0::/48` (Tailscale's IPv4 and IPv6 ranges). Remote Desktop stays on; it works from the Admin's Tailscale devices only.
- **What it does not do:** it doesn't switch Remote Desktop off, change NLA or passwords, or touch any other rule. Over Tailscale, the separate "Tailscale-In" rule (W-9) still lets tailnet devices in; SEC-FIX-3 handles that.
- **Risk:** low. If the Admin uses Remote Desktop from a device without Tailscale, that stops working; `-Undo` brings the old rules back exactly.
- **Windows permission:** an elevated window (administrator), for the dry run that records state, for Apply and for Undo. `check.ps1` and an unelevated dry run need none.

## Use
1. `fix.ps1 -DryRun` (elevated): records the matching rules' exact state to `state\dryrun.json` and shows the change.
2. `fix.ps1 -Apply` (elevated): refuses if the dry run is missing, older than 24 hours, or the rules changed since; otherwise sets the scope.
3. `check.ps1`: PASS when every enabled rule on 3389 is limited to Tailscale.
4. `fix.ps1 -Undo` (elevated): puts Enabled, Profile and Remote IP back exactly as the dry run recorded them.

Every run is logged in `state\log.txt`. Source: Microsoft, Windows Firewall rules (Scope, Remote IP addresses); Tailscale, "What are these 100.x.y.z addresses" (100.64.0.0/10, fd7a:115c:a1e0::/48).
