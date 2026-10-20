# Security fixes console (SEC-INFRA-5)

Double-click `Security fixes.cmd`. It never takes anything but yes or no.

## What happens
1. **Normal window (console.ps1).** It stops at once if the security folder has uncommitted changes (`git status` on fixes, console and probe), and logs the commit it runs from. It lists only packs whose README says `Status: ready` and whose files all match `fixes\APPROVED.sha256`. For each one it shows the README, logs the fix.ps1 fingerprint (SHA-256), runs `-DryRun`, and asks yes or no. Then it asks about the deep probe (only if approved) and about the "Undo a pack" list.
2. Before asking Windows, it checks that `console\apply.ps1` and `console\common.ps1` are the approved versions.
3. **One elevated window (apply.ps1), one Windows prompt.** It first checks its own fingerprint and common.ps1's, and stops on a mismatch. It checks every pack again: ready, approved, and fix.ps1 still the one shown in the dry run. Then it makes a fresh folder `C:\ProgramData\SecurityConsole\run-<id>`, with the rights set to Administrators and SYSTEM only at the moment it is created. It copies the pack's files and the shared `lib\` into that folder, and checks each copy against APPROVED.sha256. For each pack, it runs, from the copy: `-DryRun` (the pack records its state), `-Apply`, then `check.ps1`. If something fails, it offers `-Undo` (yes or no). The "Undo a pack" list shows packs that have state in `C:\ProgramData\SecurityConsole\state\<pack folder name>`. That state folder is also Administrators and SYSTEM only, and it stays after the run. The run copy is deleted at the end.
4. Everything is logged in `reports\<date>\console.log`, with the name of the Windows user who answered.

## APPROVED.sha256
- **Only Server writes it, after its review.** One line per file: `<path from the security folder> <SHA-256>`, for example `fixes/FIX-1-rdp-tailscale-only/fix.ps1 <hash>`. It must list every file that runs elevated: each ready pack's fix.ps1 and check.ps1, every `lib\*.ps1`, every file under `probe\`, and `console/apply.ps1` and `console/common.ps1`.
- A file that is missing from it, or has changed since, is refused in both windows.

## The remaining risk, in plain words
The elevated window starts `apply.ps1` from this folder, which normal users can write to. So between the moment the normal window checks apply.ps1 and the moment Windows starts it, a program running as you could swap it. The elevated window checks its own fingerprint as its first step, so a swapped file is caught unless the swap also changed that check. That means rewriting apply.ps1 itself in the fraction of a second before Windows starts it. Closing that gap completely would need an installed service or a protected install folder, and we don't install one. Server writing APPROVED.sha256, the git-clean check, and apply.ps1 checking itself make the gap as small as it gets without one.
