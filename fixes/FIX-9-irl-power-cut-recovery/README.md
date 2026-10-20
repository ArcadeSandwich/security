# FIX-9 Power-cut recovery for the IRL dashboards (SEC-FIX-9)

Status: reviewed-security (Server's review next, under the freeze)

## What and why
- Finding: **SEC-RES-12, medium** (Security · Resilience, round 2).
- "Startup - IRL Stream" (dashboard on 127.0.0.1:3002, which also starts the Linux VM) and "Startup - IRL Musta" (dashboard on 127.0.0.1:3003) start only when someone signs in. After a power cut, /stream and /musta stay down until the Admin signs in.
- Owner of the IRL files: IRLToolkit (offline). This pack changes only the two scheduled tasks, never a file in C:\irl-stream.

## Design (the same as FIX-5, design A, approved by Server)
- Each task gets an "At startup" trigger, after FIX-5's three tasks: IRL Stream at 4 minutes, IRL Musta at 5. The tasks run whether or not the Admin is signed in, with the Admin's own account.
- The Admin types the password once, in Windows' own box. Only Task Scheduler gets it, and no chat sees it.
- Restart on failure: 3 times, 1 minute apart. MultipleInstances=IgnoreNew, and ExecutionTimeLimit=PT0S (no time limit).
- Each .bat is read from the existing task and kept as it is. The Logon trigger stays as a fallback.

## Not covered: an accepted gap (Security and Server agreed)
- "Startup - Arcade SMP" stays Logon only. SMP Main's console.ps1 controls the server by attaching to java's console window, and a java started without a sign-in, in session 0, can't be reached from a chat. Stop and restart through the console would break.
- "Startup - IRL Musta OBS" stays Logon only, because OBS needs a desktop.
- After a power cut, both come back only after a sign-in. SMP Main and IRLToolkit are asked to confirm.

## Risk and permission
- Needs administrator rights, so it runs only from `console\Security fixes.cmd`, started by the Admin.
- The dashboards keep running while it applies.
- Session 0: the dashboards' windows (the "IRL Stream dashboard" title) no longer appear at boot. "Close this window to stop it" no longer works for a boot start: stop it with the task (End) instead.
- Today "Startup - IRL Stream" shows state Ready with last result 0xFFFFFFFF (failed or ended), yet 3002 is listening, so the dashboard was probably started some other way. IRLToolkit should look at this. The fix does not depend on it.

## Files
- `fix.ps1 -DryRun`: prints what would change, including the .bat each task runs. It writes nothing.
- `fix.ps1 -Apply`: needs elevation.
  1. Saves each task's XML and a record of what it runs in `C:\ProgramData\SecurityConsole\state\FIX-9-irl-power-cut-recovery\` (Get-PackStateDir: Administrators and SYSTEM only). It does this only when FIX-9 is not already on the task.
  2. Asks for the password in Windows' own box.
  3. Sets the boot trigger and the settings above.
- `fix.ps1 -Undo`: needs elevation. It restores each task only if the XML names that task and runs exactly what -Apply recorded.
- `check.ps1`: read-only. PASS or FAIL per task, and whether ports 3002 and 3003 are listening.

## Hardening (as FIX-5)
- PSModulePath is set to Windows' own module folder as the first statement, and ScheduledTasks is imported by its full path.
- Tested 2026-10-20 with a dummy ScheduledTasks module first in PSModulePath: check.ps1 read the real tasks.
- The password is read only inside Set-ScheduledTask. Errors are reported by their type, and $Error is cleared.

## Mandatory test right after applying (run -Undo if any step fails)
Do it together with FIX-5's test, in the same restart, with nobody signed in. Within 6 minutes:
1. 3002 and 3003 are listening.
2. arcadesandwich.com/stream and /stream?c=musta load through the game (access door first).
3. The Linux VM that start-stream.bat starts is running (`multipass list`, after sign-in).
4. check.ps1 gives RESULT: PASS.

## Change log
- 2026-10-20: built by Security · Resilience from FIX-5's reviewed scripts (GO from Security · Lead). Not applied and not run elevated.
