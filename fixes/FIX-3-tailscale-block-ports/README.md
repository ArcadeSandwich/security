# SEC-FIX-3: block the Windows ports Tailscale devices don't need

Status: draft

- **Finding:** W-9 (medium). Two local rules named "Tailscale-In" allow every protocol and port, from any address, to this PC's Tailscale addresses. Any device on the tailnet, including people shared in later, reaches file sharing, NetBIOS, the Hyper-V console and the rest.
- **Why block rules, not a change to Tailscale-In:** tailscaled creates and recreates "Tailscale-In" itself, so a narrowed rule would come back wide. In Windows Firewall a block rule wins over an allow rule. So this pack leaves Tailscale-In alone and adds block rules that apply only on the Tailscale local addresses (`100.64.0.0/10`, `fd7a:115c:a1e0::/48`).
- **What it blocks over Tailscale:** TCP 139 and UDP 137/138 (NetBIOS), TCP 445 (file sharing), TCP 2179 (Hyper-V console), TCP 4455 (OBS remote control), TCP 5040 (Connected Devices), TCP 5357 (network discovery) and TCP 7680 (Delivery Optimization).
- **What stays reachable over Tailscale:** 3389 (Remote Desktop), 135 (Hyper-V management, see FIX-2), 7420 (Prompt generator), 11434 (Ollama), 25565 (Minecraft), and tailscaled's own ports. The Tailscale ACL (SEC-FIX-7) is the second lock for people shared in.
- **What it does not do:** it changes no existing rule, and doesn't touch the home network or localhost.
- **Risk:** low. File sharing to this PC over Tailscale stops working (it is not used today). If the Admin uses OBS remote control from a phone over Tailscale, that stops too; drop that rule from the pack first if it's needed.
- **Windows permission:** an elevated window, for the recording dry run, Apply and Undo. `check.ps1` and an unelevated dry run need none.
- **The rules it adds:** names `SEC-FIX-3-<name>`, group `SecurityConsole SEC-FIX-3`. `-Undo` removes only those rules, and only the ones the dry run did not find already there.

## Use
1. `fix.ps1 -DryRun` (elevated): records which of its block rules already exist.
2. `fix.ps1 -Apply` (elevated): adds the missing block rules.
3. `check.ps1`: PASS when all 8 block rules exist, are on, block, and apply only on the Tailscale addresses.
4. `fix.ps1 -Undo` (elevated): removes the block rules the pack added.

Source: Microsoft, Windows Firewall rules ("block rules override allow rules"); Tailscale, Windows firewall rules created by tailscaled.

## Where the state is kept
`C:\ProgramData\SecurityConsole\state\FIX-3-tailscale-block-ports\` (`Get-PackStateDir`: only Administrators and SYSTEM).

## How the console calls me
1. Stage 1 (not elevated): `fix.ps1 -DryRun` lists the new rules (lines starting `RULE`). The Admin says yes or no.
2. Stage 2 (elevated, only for a yes): `fix.ps1 -DryRun`, then the console compares the names, runs `fix.ps1 -Apply`, then `check.ps1`.
3. To undo: `fix.ps1 -Undo` elevated, then `check.ps1` (FAIL is expected after an undo).
