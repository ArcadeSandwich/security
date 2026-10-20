# FIX-8: limit who can read oak-config.json and access.json, and the Admin's list of old copies

- **What:** `oak-config.json` holds the game's AI keys and the Lab code. Today every account on this PC can read it, and every signed-in account can change it (BUILTIN\Users: read; Authenticated Users: modify). This pack limits it to the Admin's own account (CadeyServer, Modify), SYSTEM and Administrators. `access.json` holds the guest access codes and has the same open permissions, so the pack limits it the same way (Security · Lead, 2026-10-20). It never reads or prints either file's content.
- **Why:** finding W-4 (SECURITY-TRACKER). Today the keys have one protection (out of git); this adds a second (only the Admin's account can read them). Found by Security · Secrets, SEC-SECRETS-5a, 2026-10-20.
- **Risk:** low. The game (and start-live.bat) and Work/Workplace run as CadeyServer, "Limited" (not elevated), so the Administrators entry does not count for them. That is why the pack grants CadeyServer explicitly, BEFORE it removes anything. The AI chats also run as CadeyServer, so the Playbook's check.js still reads the file. If anything goes wrong, `-Undo` puts back exactly the permissions `-Apply` saved.
- **What it does not do:** every AI chat on this PC runs as the same Windows account (CadeyServer), so this limit protects the file from other local accounts and processes, not from the chats themselves. The real protection against leaks stays git-ignore plus changing (rotating) the keys.
- **Windows permission:** administrator (it changes a file's permissions). Run it only from `console\Security fixes.cmd`.
- **Leaves as they are:** four account SIDs on the file that Windows can't name (inherited from C:\server; they are not local accounts). Most likely accounts left from an earlier Windows install or another PC; the question is on the Admin's list, and removing them is a separate decision.

Status: reviewed-security

## What each mode does
- `-DryRun` (no admin needed): shows the file's current permissions, what would change, and the list of old copies below. Changes nothing.
- `-Apply`: saves each file's current permissions with `icacls <file> /save` to its own file, `oak-config.json.acl` and `access.json.acl`, in `C:\ProgramData\SecurityConsole\state\FIX-8-oak-config-permissions\`, a folder only Administrators and SYSTEM can write, so no chat can change what `-Undo` applies (it never overwrites an earlier save, and changes nothing unless both saves are good). Then, for each file, it grants CadeyServer Modify, turns off inheritance (keeping the entries) and removes BUILTIN\Users, Authenticated Users and Everyone. Both scripts first reset PSModulePath to Windows' own modules, reload ScheduledTasks and the PowerShell Security, Management and Utility modules from System32, remove any function or alias that shadows the commands they use, and call icacls by its full path (R1, Server's review).
- `-Undo`: checks both saves first and refuses one that names any file other than its own; otherwise restores the saved permissions with `icacls <folder> /restore` and turns inheritance back on.
- `check.ps1`: read-only, for both files. It passes when inheritance is off; there is no Users, Authenticated Users or Everyone entry; the accounts of the "Startup - Oak World Game" and "Startup - Oak World Work" tasks each have an explicit read entry and no deny; and the game still answers on 127.0.0.1:3000. `check.ps1 -Undone` checks an undo instead.

## The Admin's own steps (no script does these)
1. Run the pack from `console\Security fixes.cmd`, then play one turn, to confirm the game still reads its keys.
2. **Change the keys**, because old copies of them existed (OWASP: rotate after exposure). Do it in this order, one key at a time:
   1. Make a new key at the provider: Google AI Studio for each Gemini key; the extra provider's dashboard for its key.
   2. Put it into oak-config.json in place of the old one (the game reads the file on every turn, so no restart is needed).
   3. Play one turn to check it works.
   4. Delete the old key at the provider.
   5. The Lab code: choose a new one in oak-config.json (`labCode`), and use it from then on on every device.
3. **Delete the old copies** (only you delete data). Each holds the same keys:
   - `C:\server\oak-world\oak-world\oak-config.json.bak` (2026-09-28)
   - `C:\server\oak-world\oak-world\backups\oak-config.before-2026-09-27-fix.json`
   - `C:\server\oak-world\oak-world\backups\oak-config.before-queue-lock-2026-09-29.json`
   - `C:\server\oak-world\dm-wt\oak-config.json` (in an old worktree)
   - `C:\server\oak-world\jobs\_main\oak-config.json` (in an old job folder)
   (`C:\server\oak-world\live\backups` is a signpost to the same backups folder: delete the files once, never the signpost.)
4. Optional: rotating the keys first makes step 3 less urgent, since the old copies then hold dead keys.
