# SEC-FIX-2: Hyper-V remote console rule off, Hyper-V management from Tailscale only

Status: ready

- **Findings:** W-8 (high) and SEC-NET-16 (medium).
  - W-8: the rule "Hyper-V (REMOTE_DESKTOP_TCP_IN)" allows TCP 2179 (the Hyper-V VM console, vmms) from any address on every profile, and vmms listens on every card, so the home network can reach it.
  - SEC-NET-16: two Hyper-V WMI (DCOM-In) rules allow TCP 135 from any address on every profile.
- **What it does:**
  - It switches off every enabled inbound allow rule on port 2179. VM consoles still work on this PC itself, because Hyper-V Manager connects locally. Multipass and the stream VM don't use this port.
  - It limits every inbound allow rule on port 135 to Remote IP `100.64.0.0/10` and `fd7a:115c:a1e0::/48`. Today those are the two Hyper-V WMI rules and the Remote Assistance DCOM rule (Domain only). The Admin can still manage Hyper-V over Tailscale.
- **What it does not do:** it doesn't stop Hyper-V, any VM or any switch, and doesn't touch other rules.
- **Risk:** low. Opening a VM console from another PC stops working, and Hyper-V management works only over Tailscale. `-Undo` restores both exactly.
- **Windows permission:** an elevated window, for the recording dry run, Apply and Undo. `check.ps1` and an unelevated dry run need none.

## Use
1. `fix.ps1 -DryRun` (elevated): records the exact state of the matching rules to the protected state folder (below).
2. `fix.ps1 -Apply` (elevated): refuses if the dry run is missing, older than 24 hours, or the rules changed since. Otherwise it applies both changes.
3. `check.ps1`: PASS when no enabled allow rule opens 2179 and every enabled allow rule on 135 is limited to Tailscale.
4. `fix.ps1 -Undo` (elevated): puts Enabled, Profile and Remote IP back exactly as recorded.

Elevated runs are logged in `log.txt` in the state folder. Source: Microsoft, Hyper-V firewall rules and Windows Firewall docs.

## Where the state is kept
`C:\ProgramData\SecurityConsole\state\FIX-2-hyperv-2179-off\` (`Get-PackStateDir` in `lib\common.ps1`).
- The folder is created elevated, with only Administrators and SYSTEM (inheritance off). A folder with another owner, or one anybody else can write to, is refused.
- The state is not kept inside the pack, because the console runs packs from a temporary copy.
- `-Undo` checks every recorded rule before it changes any. The rule must still be picked by this pack today, the profile must be a valid number and every address must be valid. Otherwise it changes nothing.

## How the console calls me
1. Stage 1 (not elevated): `fix.ps1 -DryRun` lists the rules (lines starting `RULE`) and the change, and records nothing. The Admin reads this and says yes or no.
2. Stage 2 (one elevated session, only for a yes): `fix.ps1 -DryRun` records the state. The console checks that the recorded rule names are the same as the ones stage 1 showed. Then it runs `fix.ps1 -Apply`, then `check.ps1`.
3. To undo: `fix.ps1 -Undo` in an elevated session, then `check.ps1` shows the old state (FAIL is expected after an undo).
