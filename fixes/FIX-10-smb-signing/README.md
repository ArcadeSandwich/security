# SEC-FIX-10: require SMB signing (and one Settings step for Delivery Optimization)

Status: reviewed-security

- **Findings:** SEC-PC-6 and SEC-NET-17 (low).
  - The PC's file-sharing server (SMB) doesn't require signing, so on a network path someone could tamper with or relay SMB traffic.
  - Today only the built-in admin shares exist, SMB1 is off, and 445 is closed to the home network. Over Tailscale it is blocked once FIX-3 is applied.
- **What it does:** `Set-SmbServerConfiguration -RequireSecuritySignature $true`. Every SMB connection to this PC must then be signed. All current Windows, macOS and Linux clients can sign.
- **What it changes for things that connect to this PC's shares:** any device that opens a share on this PC (today only the admin shares C$, D$, ADMIN$, IPC$) must sign every SMB message. Windows 10 and 11, macOS and current Linux (Samba) sign automatically, so nothing visible changes for them. A device too old to sign gets "access denied" or can't connect.
- **What it does not do:** it changes no share and no firewall rule. **It doesn't change this PC's client side:** that is a separate setting (LanmanWorkstation `RequireSecuritySignature`), which this pack doesn't touch. When this PC opens a share on another PC, nothing changes.
- **BACKUP-1 is not affected.** The planned nightly copy goes from this PC to mika-pc. There this PC is the SMB client and mika-pc is the server, so mika-pc's server setting and this PC's client setting apply, never this PC's server setting. If BACKUP-1 later runs the other way (mika-pc pulling from this PC's shares), mika-pc signs automatically as a Windows client, so it keeps working.
- **Risk:** low. Large file copies to this PC over SMB may be slower, and very old devices that can't sign can no longer connect. Neither is used today. `-Undo` sets the recorded value back.
- **Windows permission:** an elevated window, for the recording dry run, Apply and Undo. `check.ps1` and an unelevated dry run need none (they read the registry value `LanmanServer\Parameters\RequireSecuritySignature`).

## Use
1. `fix.ps1 -DryRun` (elevated): records the current value to the protected state folder.
2. `fix.ps1 -Apply` (elevated): refuses if the dry run is missing, older than 24 hours, or the value changed since. Otherwise it sets signing to required.
3. `check.ps1`: PASS when signing is required.
4. `fix.ps1 -Undo` (elevated): sets the recorded value back.

## Where the state is kept
`C:\ProgramData\SecurityConsole\state\FIX-10-smb-signing\` (`Get-PackStateDir`: only Administrators and SYSTEM).

## How the console calls me
1. Stage 1 (not elevated): `fix.ps1 -DryRun` shows the current value (a line starting `RULE`). The Admin says yes or no.
2. Stage 2 (elevated, only for a yes): `fix.ps1 -DryRun`, then `fix.ps1 -Apply`, then `check.ps1`.
3. To undo: `fix.ps1 -Undo` elevated, then `check.ps1` (FAIL is expected after an undo).

## The Admin's Settings step (no script): Delivery Optimization (port 7680)
Windows Update can share update files with other PCs through port 7680, and its firewall rule allows any address. To switch that off:
1. Open Settings, then Update & Security, then Delivery Optimization.
2. Switch off "Allow downloads from other PCs".

Windows then stops offering updates to other PCs, and nothing listens for them. Windows Update itself keeps working. A security chat checks it afterwards with NET-P1 (7680 no longer listening).

Source: Microsoft, "Overview of Server Message Block signing" and Set-SmbServerConfiguration docs; Microsoft, Delivery Optimization for Windows updates.
