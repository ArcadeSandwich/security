# SEC-RES-8 A second Minecraft backup target off the failing D: drive

Status: draft (for Security's review, then ready-for-owner)
Finding: SEC-RES-8, **high**. Every Arcade SMP backup goes only to the failing D:. DriveBackupV2 saves a 32.6 GB world zip and a 1 GB plugins zip at 06:00 and 12:00 to D:/SERVER BACKUPS/backups, and every remote target is off.
Owner: SMP Main (offline). Diff made against `plugins/DriveBackupV2/config.yml`, file date 2026-10-07 12:32. If the file has changed since then, re-check before applying.

## What the patch changes
- Turns on the plugin's **SFTP** target, pointed at the Admin's main PC over Tailscale. The world then exists on C: (live), on D: (local copies) and on the main PC (off this PC). That is the 3-2-1 rule.
- `keep-count` (copies kept on remote targets) goes from 20 to 4: 4 x 34 GB, about 135 GB on the main PC. At 20, it would be about 680 GB.
- The local D: copies are unchanged (`local-keep-count: 24`). D: keeps working as long as it lasts.

### Why not a local folder on C:
The plugin has only one local folder. Moving it to C: would stop the D: copies, and C: has 128 GB free: only 3 world zips fit, and C: would drop under 20% free, which would endanger the game and the PC. A second copy belongs off this PC.

### Options the Admin may prefer instead (no diff needed)
- **Google Drive or OneDrive:** set `enabled: true` and run `/drivebackup linkaccount googledrive` in the Minecraft console. That is a login, so it is the Admin's step. Mind the space: about 135 GB.
- **BACKUP-1** (Network) copies `D:\SERVER BACKUPS\backups` to the main PC every night. That needs no plugin change, but it reads from the failing disk.

## Steps that need a login or a permission (the Admin)
1. On the main PC: turn on Windows' OpenSSH Server (Settings, Apps, Optional features). Create a local user for backups only, with no administrator rights, and give it a folder with about 150 GB free.
2. Allow port 22 on the main PC only from cadeyserver's Tailscale address (100.107.176.17), never from Any.
3. Give the backup user a key or a password. Enter it only in the plugin's `password:` line, or as the key file path in `sftp-public-key:` (see the DriveBackupV2 wiki, "FTP/SFTP"). It is never sent to a chat and never committed. SMP Main types it into the config locally.

## How SMP Main applies it
1. Use only SMP Main's own commands; never restart Minecraft by hand, and never kill java.
2. Apply the diff to a copy, then check it: `git apply --check` from the Arcade SMP folder. That folder has no git, so either apply by hand from the diff (5 lines) or run `git apply --unsafe-paths --directory=. fix.diff` on a copy.
3. Replace `MAIN-PC-TAILSCALE-ADDRESS` and `MAIN-PC-BACKUP-USER` with the real ones, and put in the login from the Admin's step 3.
4. Reload the plugin with SMP Main's console: `SMP_main\console.ps1 -Send "drivebackup reloadconfig"`. If SMP Main prefers a full restart, use `console.ps1 -Send restart` at a quiet time.
5. Test: `console.ps1 -Send "drivebackup test ftp"`, then `drivebackup backup` once at a quiet time. Saving is paused while the backup runs.

## Check it worked
`powershell -File test\check.ps1` (read-only). The same world zip, with the same size, must be on D: and on the main PC after the next 06:00 or 12:00 run.

## Undo
Set the `ftp:` block back to `enabled: false` and `keep-count` back to 20 (the reverse of fix.diff), then `drivebackup reloadconfig`. The copies on the main PC can stay.
