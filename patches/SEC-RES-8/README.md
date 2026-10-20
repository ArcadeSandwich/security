# SEC-RES-8 A second Minecraft backup target off the failing D: drive

Status: ready-for-owner
Finding: SEC-RES-8, **high**. Every Arcade SMP backup goes only to the failing D:. DriveBackupV2 saves a 32.6 GB world zip and a 1 GB plugins zip at 06:00 and 12:00 to D:/SERVER BACKUPS/backups, and every remote target is off.
Owner: SMP Main (offline). Diff made against `plugins/DriveBackupV2/config.yml`, file date 2026-10-07 12:32. If the file has changed since then, re-check before applying.

## What the patch changes
- Turns on the plugin's **SFTP** target, pointed at the Admin's main PC over Tailscale. The world then exists on C: (live), on D: (local copies) and on the main PC (off this PC). That is the 3-2-1 rule.
- `keep-count` stays at 20. No setting that makes the plugin delete existing backups is changed: deleting backups is the Admin's call alone (Server, 2026-10-20).
- The local D: copies are unchanged. The live config sets `local-keep-count: 24` explicitly, on line 13, right under `keep-count`. In DriveBackupV2, `keep-count` covers the local folder only when `local-keep-count` is -1 (the default). Since it is set, changing `keep-count` affects only the remote targets. Line 13 is not in the diff and must stay; if SMP Main finds it missing, add `local-keep-count: 24` before applying. D: keeps working as long as it lasts.

### Why not a local folder on C:
The plugin has only one local folder. Moving it to C: would stop the D: copies, and C: has 128 GB free: only 3 world zips fit, and C: would drop under 20% free, which would endanger the game and the PC. A second copy belongs off this PC.

### Options the Admin may prefer instead (no diff needed)
- **Google Drive or OneDrive:** set `enabled: true` and run `/drivebackup linkaccount googledrive` in the Minecraft console. That is a login, so it is the Admin's step. Mind the space: see "For the Admin".
- **BACKUP-1** (Network) copies `D:\SERVER BACKUPS\backups` to the main PC every night. That needs no plugin change, but it reads from the failing disk.

## For the Admin: disk space on the main PC (mika-pc)
- Each run is about 34 GB: a 32.6 GB world zip plus a 1 GB plugins zip, twice a day.
- With keep-count 20 the main PC fills up to 20 x 34 GB, about **680 GB**, after 10 days. With 10 copies it would be about 340 GB, and with 4 about 135 GB.
- I could not read mika-pc's free space from here. If it has less than about 700 GB free, the Admin decides: a bigger disk, or a lower keep-count. A lower count makes the plugin delete the oldest remote copies, so it is the Admin's call alone.

## Steps that need a login or a permission (the Admin)
1. On the main PC: turn on Windows' OpenSSH Server (Settings, Apps, Optional features). Create a local user for backups only, with no administrator rights, and give it a folder with enough free space (see "For the Admin").
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
Set the `ftp:` block back to `enabled: false` (the reverse of fix.diff), then `drivebackup reloadconfig`. The copies on the main PC can stay.
