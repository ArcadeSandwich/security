# SEC-FIX-4: limit the wide program rules and the container DNS rules

Status: draft

- **Findings:** W-10 and W-2 (medium), and SEC-NET-15 (medium).
  - W-10 and W-2: program rules allow any address for ollama.exe, obs64.exe (OBS), obs-browser-page.exe, node.exe, bun.exe and bunx.exe. Today they are safe only because those programs listen narrowly, or because the home network is Public.
  - SEC-NET-15: the "HNS Container Networking - DNS" and "- ICS DNS" rules allow port 53 from any address on every profile, so the home network can query the container DNS.
- **What it does:**
  - Every enabled or disabled allow rule for those six programs that has Remote IP Any gets Remote IP `100.64.0.0/10` and `fd7a:115c:a1e0::/48`.
  - The HNS DNS rules with Remote IP Any get `172.16.0.0/12`, the range the Hyper-V switches use (Default Switch 172.18.224.1, the stream VM 172.18.228.252).
- **Left out on purpose:**
  - Java (java.exe, javaw.exe, OpenJDK): its program rules carry Minecraft's voice chat (UDP 24454) for players.
  - Port rules such as "Cadeys World Rule" (25565): Minecraft is public on purpose.
- **Risk:** low.
  - A program in the list can no longer take connections from the home network. None does today.
  - When Windows asks again for a new program, answer only for Private networks.
  - If the container DNS breaks for the VM, run `-Undo`.
- **After a restart:** Windows may recreate the HNS rules with Any. Run `check.ps1` after each restart; if it fails, run the pack again.
- **Windows permission:** an elevated window, for the recording dry run, Apply and Undo. `check.ps1` and an unelevated dry run need none.

## Use
1. `fix.ps1 -DryRun` (elevated): records the exact state of the matching rules.
2. `fix.ps1 -Apply` (elevated): refuses if the dry run is missing, older than 24 hours, or the rules changed since.
3. `check.ps1`: PASS when no enabled allow rule for the six programs, and no HNS DNS rule, has Remote IP Any.
4. `fix.ps1 -Undo` (elevated): puts Enabled, Profile and Remote IP back exactly as recorded.

Source: Microsoft, Windows Firewall rules (Scope); Microsoft, Host Network Service (HNS) firewall rules for container networking.

## Where the state is kept
`C:\ProgramData\SecurityConsole\state\FIX-4-program-rules-scope\` (`Get-PackStateDir`: only Administrators and SYSTEM). `-Undo` checks every recorded rule before it changes any.

## How the console calls me
1. Stage 1 (not elevated): `fix.ps1 -DryRun` lists the rules (lines starting `RULE`). The Admin says yes or no.
2. Stage 2 (elevated, only for a yes): `fix.ps1 -DryRun`, then the console compares the names, runs `fix.ps1 -Apply`, then `check.ps1`.
3. To undo: `fix.ps1 -Undo` elevated, then `check.ps1` (FAIL is expected after an undo).
