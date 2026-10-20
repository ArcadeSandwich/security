# FIX-5 Power-cut recovery (SEC-FIX-5)

Status: reviewed-security (design A approved by Server, 2026-10-20)

## What and why
- Finding: **W-22, high** (Security · Resilience, round 1, INS-015, log commit fc1f783f in oak-world).
- Today, the three startup tasks ("Startup - Oak World Game", "Startup - Oak World Work" and "Startup - Ollama") start only when someone signs in at the PC (a Logon trigger), and automatic sign-in is off.
- After a power cut or a Windows Update restart, the game, Work and Ollama therefore stay down until the Admin signs in.
- The tasks also have no restart-on-failure, so if one stops, it stays stopped.
- The PC had 11 unexpected shutdowns between 2026-09-20 and 2026-10-20 (W-20).

## The design choice (the Admin decides)
### A. The tasks run at boot under the Admin's account (Windows keeps the password)
Recommended.
- **How it works:** each task gets an extra "At startup" trigger and is set to "Run whether user is logged on or not". The Admin types the Windows password once, into Windows' own sign-in box. Task Scheduler stores it encrypted (in LSA secrets, which only administrators and the system can read). The script never sees, prints or saves it beyond handing it to Windows.
- **Good:** the services come back about 1 to 2 minutes after any restart, with nobody at the PC, and the desktop stays locked.
- **Risks:**
  - If the Admin changes the Windows password, the tasks stop starting until FIX-5 is applied again (check.ps1 shows it).
  - Tasks started at boot run in the background with no window. The game's console window will not appear, so nothing can be clicked by mistake (INS-003), but the log is the only way to see the game running.
  - Anyone with administrator rights on this PC could in principle pull the stored password out.
- **Ollama:** its tray program ("ollama app.exe") needs a desktop, so at boot the task runs `ollama.exe serve` from the same folder instead. The same OLLAMA_HOST setting applies. The tray icon then no longer shows.
- Boot order: the game at 1 minute, then Work/Workplace at 2, then Ollama at 3. The game and Work tasks keep the .bat file they already run; fix.ps1 reads it from the task, so start-workplace.bat after WP-SWITCH works the same.
- The Logon trigger stays as a fallback. A task that is already running is never started twice ("IgnoreNew").

### B. Automatic sign-in (a password stored in the registry)
- **How it works:** Windows signs the Admin in by itself at every start, and the tasks work unchanged.
- **Risks:**
  - The password sits in the registry (Winlogon DefaultPassword): in plain text with the built-in method, or LSA-encrypted with Microsoft's Sysinternals Autologon tool.
  - Anyone who walks up to the PC, or switches it on, gets an unlocked desktop with every chat, key and service.
  - Windows Update and some security features can switch automatic sign-in off again.
- This pack does not include option B. If the Admin picks B, it is done by hand with Sysinternals Autologon (steps on request).

**Pick: A.** The PC stays locked, and the password never sits in a readable place.

## Restart-on-failure (part of A)
- All three tasks get "If the task fails, restart every 1 minute, up to 3 times".
- This only helps if the task's program actually stops. start-live.bat already restarts the game itself in a loop.

## Risk and permission
- Changes: the three tasks' triggers, settings, sign-in type (and Ollama's action). Nothing else.
- Needs administrator rights (an "At startup" trigger), so it runs only from `console\Security fixes.cmd`, started by the Admin.
- The services keep running while it applies. The new settings take effect at the next start.
- Undo: `fix.ps1 -Undo` re-registers each task from the XML that -Apply saved in the protected state folder. The tasks go back to Logon only, with no password stored.

## Files
- `fix.ps1 -DryRun`: prints what would change, including the .bat each task runs. It changes nothing and writes nothing.
- `fix.ps1 -Apply`: needs elevation. It first saves each task's XML, plus a record of the program each one runs, into `C:\ProgramData\SecurityConsole\state\FIX-5-power-cut-recovery\` (Get-PackStateDir, which only Administrators and SYSTEM can write). It does this only when FIX-5 is not already on the task, so the pre-fix copy is kept. Then it asks for the Admin's password in Windows' own box, and sets A plus restart-on-failure. If Get-PackStateDir is missing, it stops before changing anything.
- `fix.ps1 -Undo`: needs elevation. It restores each backed-up task only if the XML names one of the three tasks and runs exactly what -Apply recorded; otherwise nothing is undone.
- The password: it is read once and passed straight to Set-ScheduledTask. An error is reported by its type only, never with its arguments, and the variables and $Error are cleared afterwards.
- `check.ps1`: read-only. PASS or FAIL for each task (startup trigger, runs without sign-in, restart-on-failure), and shows whether automatic sign-in is on.

## After applying
- A real restart test is a PLAN for Server, at a quiet time.
- After the restart, run check.ps1 and confirm that 127.0.0.1:3000 and 3001, and port 11434, answer within 3 minutes, before anyone signs in.

## Change log
- 2026-10-20: drafted by Security · Resilience. Not applied and not run elevated.
- 2026-10-20: Security's review: backups moved to the protected state folder, -Undo checks names and programs, the password is kept out of errors.
