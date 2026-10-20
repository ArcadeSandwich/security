# SEC-FIX-2: Hyper-V remote console rule off

Status: draft

- **Finding:** W-8 (high). The rule "Hyper-V (REMOTE_DESKTOP_TCP_IN)" allows TCP 2179 (the Hyper-V VM console, vmms) from any address on every profile, and vmms listens on every card, so the home network can reach it.
- **What it does:** switches off every enabled inbound allow rule on port 2179. VM consoles still work on this PC itself (Hyper-V Manager connects locally). Multipass and the stream VM don't use this port.
- **What it does not do:** it doesn't stop Hyper-V, any VM or any switch, and doesn't touch other rules.
- **Risk:** low. Opening a VM console from another PC stops working; `-Undo` switches the rule back on exactly as it was.
- **Windows permission:** an elevated window, for the recording dry run, Apply and Undo. `check.ps1` and an unelevated dry run need none.

## Use
1. `fix.ps1 -DryRun` (elevated): records the matching rules' exact state to `state\dryrun.json`.
2. `fix.ps1 -Apply` (elevated): refuses if the dry run is missing, older than 24 hours, or the rules changed since; otherwise switches them off.
3. `check.ps1`: PASS when no enabled allow rule opens 2179.
4. `fix.ps1 -Undo` (elevated): puts Enabled, Profile and Remote IP back exactly as recorded.

Every run is logged in `state\log.txt`. Source: Microsoft, Hyper-V firewall rules and Windows Firewall docs.
