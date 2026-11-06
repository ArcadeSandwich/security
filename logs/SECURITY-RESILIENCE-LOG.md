# Security · Resilience log

Notes of the "Security · Resilience" chat (staying up and recovering). Handbook: C:\server\playbook\handbooks\security-resilience.md.

## 2026-10-20 Round 1 (GO SEC-RESILIENCE-1 from Security · Lead)
Free memory before starting: 1.8 GB of 16 GB (INS-005: these are tiny read-only commands, so they could run).

### INS-013 Backups and test restore
- Game backups (live\backups, which is a junction to oak-world\backups): 318 files, 0.01 GB. The newest is from 2026-09-29, more than 3 weeks old. They are all local on C:, and there is no copy off this PC (BACKUP-1 is not built).
- D:\SERVER BACKUPS: 960 GB (Minecraft world and plugins, plus manual copies from 2026-10-07 and 2026-10-19). They sit only on D:, which is failing (see INS-014).
- Test restore: I copied backups\saves-before-folders-2026-09-28-030705\partyref_12400\save.json into a new empty scratch folder. The SHA256 hashes matched and the file parses as JSON. Then I removed the scratch copy. That save has no live counterpart any more (the folders were reorganised).
- Copies of oak-config.json in backups were listed by name only, never opened.
- Finding: **medium**: no backup in 24 hours, no copy off the PC, and no tested restore from a nightly run. The fix is BACKUP-1.

### INS-014 D: drive (LaCie Rugged USB-C, 4.6 TB)
- Get-Volume: HealthStatus **Warning**. Get-PhysicalDisk: Healthy/OK.
- Reliability counters: not readable without admin rights (a gap; I did not elevate).
- System log, last 30 days: 14 disk 153 events (I/O retried) and 3 disk 51 events (error during a paging operation). The last one was on 2026-10-18 at 20:54.
- On D:: SERVER BACKUPS (960 GB), EDITING (531 GB, last written 2026-07-27) and ai-workspace (4.5 GB of models, builds and npm cache).
- On 2026-10-18, between 20:06 and 23:57, the PC had 8 unexpected shutdowns (Event 41/6008). They fall in the same hour as the D: paging errors.
- Finding: **HIGH (W-3)**: D: holds the only copy of the Minecraft backup history, the manual backups and EDITING, and it is reporting errors. Sent to Server.

### INS-015 Recovery after a restart
- All three startup tasks (Game, Work, Ollama) are Running, last run 2026-10-20 04:38. Their result 267009 (0x41301) means "task is running", which is normal for a server. Restart count 0.
- Their trigger is **Logon only**, and AutoAdminLogon is not set. After a power cut, nothing comes back until someone signs in at the PC.
- Ports: 3000 and 3001 on 127.0.0.1, 11434 on ::, 7420 on the Tailscale address. That is correct.
- Signposts: all four are junctions to C:\server. That is correct.
- Unexpected shutdowns in the last 30 days: 11 (8 on 2026-10-18, 1 on 10-09, 2 on 10-07). Last boot: 2026-10-18 23:56.
- The Prompt generator (7420) has no task and is started by hand.
- W-20, the cause of the 11 shutdowns (read-only, Kernel-Power 41 data):
  - BugcheckCode is 0 every time, so there was no blue screen. There are no WHEA hardware errors and no minidumps.
  - 7 of the 11 have a PowerButtonTimestamp, so someone held the power button down. The other 4 have none: the power was cut or the PC was reset.
  - Just before 20:06 on 10-18: "Windows failed fast startup" (Kernel-Boot 29, 0xC00000D4) and repeated DCOM timeouts. An NVIDIA driver installer (617.42) was saved on D: at 21:47 that evening.
  - Reading: the PC hung or was being fixed (a driver or display problem), and it was forced off by hand over and over. The paging errors are on D:, but the page file is on C:, so they are D:'s own read errors.
  - No crash since 2026-10-18 23:56.
  - Server adds that a graphics driver install and a heavy AI model build ran that evening. The model build is the INS-005 incident, where memory ran out. This supports the hang reading. The question about that evening is with the Admin.
  - Rank: **medium**. Each forced power-off risks unsaved saves and D:'s data. Steps for the Admin: say what happened that evening; if it happens again, run Reliability Monitor (perfmon /rel) and save the dump. Fast startup could be turned off (the Admin's choice).
- Findings: **HIGH**: no service returns after a power cut without someone signing in (sent to Server). **Medium**: the tasks have no restart-on-failure, and 7420 has no task.

### INS-016 (NET-P1, Network's protocol) Listening ports
- The TCP ports on all cards match the known list exactly.
- Changes from the known list: 139 now listens on 172.18.224.1 (the Hyper-V switch), not the Tailscale address. New local-only ports: 49374 (opencode, 127.0.0.1) and 42050 (OneDrive, ::1).
- UDP on all cards (the protocol has no known list for these): 53 and 5050 (svchost), 24454 (java, Minecraft), 3389 (Remote Desktop), 5353 and 60807 (Chrome), plus Tailscale, cloudflared and Windows discovery.
- Finding: **low**: UDP 53 (a DNS server, probably Hyper-V's network sharing) and UDP 24454 need a NET-P2 rule check. Sent to the lead for Network.
- The protocol worked as written. It should add a known UDP list.

## 2026-10-20 Round 2: SEC-RES-R2 survival map (GO from Security · Lead)
Free memory 1.7 GB. Read-only, local files only, nothing restarted. No key files were opened; only names and sizes.

### 5a Oak World game
- Must survive: the code, the saves (58 MB, 892 files, guests' included, newest 10-18), oak-config.json and access.json (keys and codes), the art and sound packs, and the live worktree with its links.
- Copies:
  - code: GitHub plus C: (two places);
  - saves: only on C: (oak-world\saves), with local backups on the same disk that are 21 days old;
  - configs: only on C:, plus their old backup copies on C:.
- Starts and restarts: task "Startup - Oak World Game", Logon only (W-22, FIX-5), then start-live.bat loops node. deploy.ps1 rolls back. "Oak World Sweep" runs on a timer.
- Gap: saves and configs have no copy off this disk. **Medium** (BACKUP-1).

### 5b Work program (as it is today)
- Must survive: its data and local git (56 files, 1 MB).
- Copies: only C:, and the git has no remote.
- Starts: task "Startup - Oak World Work", Logon only (FIX-5).
- Gap: one copy. **Medium**: fixed if WP-1/WP-2 move it into the ai-workspace-app repo, or by BACKUP-1.

### 5c AI Workspace
- Copies: notes and app on GitHub (both repos clean, nothing unpushed). app-build 0.7 GB and trash 1.1 GB sit on C:. D:\ai-workspace (4.5 GB: models, builds, npm cache) is on the failing D:. The Ollama models (12.8 GB, in the user profile on C:) can be downloaded again. pg-keys.json is local only; that is fine, because keys can be issued again.
- Starts: task "Startup - Ollama", Logon only (FIX-5). The Prompt generator (7420) has no task: **medium**.
- Gap: nothing important is lost if D: dies. **Low**.

### 5d Playbook and C:\server\security
- Both live only on C:, in a local git with no remote. Nothing starts them.
- Gap: the whole library and the security tools exist in one copy. **Medium**. Fix: BACKUP-1 copies C:\server, or a private remote (the Admin decides).

### 5e IRL stream (C:\irl-stream, from IRLToolkit's files, nothing touched)
- 76 files, 1 MB, including private\, private-musta\, data\ and recordings-musta\.
- **There is no git here at all**, although C:\server\CLAUDE.md says it goes on GitHub as irl-stream. So everything exists only on C:.
- Starts: tasks "Startup - IRL Stream", "Startup - IRL Musta" and "Startup - IRL Musta OBS", all Logon only and not part of FIX-5.
- Gaps: one copy of code and configs (**medium**, for IRLToolkit); no return after a power cut (**medium**, the owner's choice).

### 5f Arcade SMP (Desktop\Arcade SMP, read only)
- Must survive: world (48.4 GB), plugins and configs. There is no git.
- Copies: the DriveBackupV2 plugin backs up every 180 minutes (keeping 24) to D:/SERVER BACKUPS/backups only. Every cloud target is disabled. The manual copies (10-07, 10-19) are also on D:.
- **HIGH (adds to W-3)**: every Minecraft backup, automatic and manual, goes only to the failing D:. If C: or D: fails, a 48 GB world exists in at most one place.
- Starts: task "Startup - Arcade SMP", Logon only, not part of FIX-5: **medium**, for SMP Main.
- Also: 9 JVM crash files (hs_err) from 2026-07-29/30, none since. **Low**.

### 5g musta.no / MustaHub
- Nothing local, by the rules; it is edited elsewhere. I checked nothing online.
- Questions for the Admin (through Security):
  1. Where is the GitHub repo, and is there a second copy besides GitHub and the PC it is edited on?
  2. Where is it hosted, and does the host keep backups?
  3. Is there a database or uploaded files outside git?
  4. Who could restore it?

### 6 Redundancy table (3-2-1: three copies, two kinds of media, one off-site)
| Thing | Copies and places | Tested restore | Gap | Rank |
|---|---|---|---|---|
| Game code | GitHub, C: | yes (git) | none | - |
| Game saves (guests' too) | C: and old copies on C: | 1 file (round 1) | one disk, none off the PC | medium |
| oak-config.json, access.json | C: | no | one disk | medium |
| Work program | C: | no | one copy, no remote | medium |
| AI Workspace notes and app | GitHub, C: | yes (git) | none | - |
| Ollama models | C: | n/a | can be downloaded again | low |
| Playbook | C: | no | one copy, no remote | medium |
| Security tools | C: | no | one copy, no remote | medium |
| IRL stream code and configs | C: | no | one copy, no git | medium |
| Minecraft world | C:, and backups on failing D: | no | backups only on the failing disk | **high** |
| SERVER BACKUPS and EDITING | D: only | no | failing disk (W-3) | **high** |
| musta.no | GitHub plus where it is edited (not checked) | unknown | questions above | unknown |

One copy of C:\server off the PC (BACKUP-1) would close five medium rows at once.

### 7 Protocol
The "Survival map of a project" protocol has been submitted to the Playbook inbox.

## 2026-10-20 Round 3: R-4, R-5, R-6 (GO from Security · Lead)
Free memory 1.1 GB, so only small read-only commands ran.

### R-4 Windows Update
- Newest installed update: KB5126256, from 2026-09-09. The October update (Patch Tuesday, 10-13) is **not installed**, 41 days after the last one.
- In the last 45 days: 10 install failures (event 20), all of them the Store app "OpenAI.Codex" (0x80073D02, the app was in use). There were no Windows failures.
- No pause and no update policy set. Active hours 08:00 to 17:00, so an update restart can land at night while guests play. No restart pending. The update service is Manual and Stopped, which is Windows' normal state (it starts on demand).
- Findings:
  - **medium**: the October security update is missing. Steps for the Admin: Settings, Windows Update, "Check for updates", at a quiet time. FIX-5 means the services come back after its restart.
  - **low**: active hours 08-17 do not match when the game is used; widen them to the evening.
  - **low**: the Codex Store app keeps failing to update.

### R-5 Disk space and growth
- C: 128 GB free (28%). D: 3,072 GB free (66%).
- Growth over 7 days:
  - D:\SERVER BACKUPS\backups: +269 GB, but local-keep-count 24 rotates it. There are 25 world zips, the oldest from 2026-09-11, so it stays at about 820 GB.
  - Game saves, logs and backups, and the SMP and IRL logs: under 0.1 GB each.
- Neither disk fills up at this rate. Finding: none. Watch C: if SEC-RES-8's option B ever puts backups there.

### R-6 Down warning
- Oak World Sweep (every 15 minutes, last result 0) only closes leftover test browsers; it watches no service.
- SMP_main\monitor.ps1 records PC and server state once a minute, for after a crash. It warns no one.
- Nothing checks ports 3000, 3001, 3004, 11434, 3002, 3003 or 25565, and nothing tells the Admin when one stops.
- Finding: **medium**: an outage is noticed only when someone tries to use the service. Fix (a PLAN for Server, not built): one small read-only health check every 5 minutes that posts "down" to the Work desk once per outage, and "back" when it returns.

## 2026-11-06 Job from Server via Security · Lead: C: space loss and two Minecraft closes
Read-only. Free memory was 2.1 GB at the start. No elevation (vssadmin refused, so shadow copies are unread).

### a) C: free space, from SMP_main\monitor (c_free_gb per minute)
- It fell from 135.5 GB (11-05 01:59) to 105.8 GB (11-06 13:35), about 30 GB.
- Steps of 1 GB or more:
  - 11-05 02:00: -3.3
  - 11-05 09:24: -1.5
  - 11-05 10:33-10:34: -2.3
  - 11-05 11:25: -1.1
  - 11-06 03:40: -2.6, then +2.2 at 03:47
  - 11-06 13:10-13:26: -11.1
- What grew (written since 11-05):
  - **Server's own scratchpad** (Temp\claude\...\65ec44a5..., the dawn-lab footage): 9.9 GB of downloaded videos, among them video.f302.webm (6.4 GB) and video.mp4 (1.0 GB), plus a 0.56 GB task output. These match the 11-05 10:33-11:25 steps.
  - **CoreProtect database** (Arcade SMP, plugins\CoreProtect\database.db): 10.25 GB. It is Minecraft's block-history log, growing since 2026-08-08 and still written now (13:39).
  - **Claude desktop app VM** (Local\Claude-Data\...\claudevm.bundle): rootfs.vhdx 7.5 GB and sessiondata.vhdx 0.5 GB, written at 13:16 and 13:31 today. This most likely explains the 11-06 13:10-13:26 drop.
  - **Ollama self-update** (Local\Ollama\updates_v2\...\OllamaSetup.exe): 1.57 GB, downloaded 11-06 03:40, which matches 03:40. The +2.2 GB at 03:47 is the installer's unpacked files being removed.
  - 11-05 02:00 and 09:24 are not identified, since the files have been rewritten since. One candidate is a System Restore or shadow copy at 02:00, which can't be read without admin rights.
- Not the cause: SoftwareDistribution 0.1 GB, Windows Defender 0.6 GB, the Ollama models 12.8 GB (unchanged), the C:\server repos (17.2 GB, nothing big written since 11-05), and ai-workspace trash 2.6 GB (older).
- Risk: **medium**. C: has 105.8 GB free of 464, which is 23%, close to the 20% line (93 GB). Today's rate crosses it within days.
  - The big, steady grower is CoreProtect.
  - The fastest single source is chats' video downloads into their scratchpads.
- Fixes (none done):
  1. Server clears its own dawn-lab footage once it is used: about 10 GB. Deleting is the Admin's call.
  2. SMP Main sets a CoreProtect purge (for example `co purge t:90d`, run in the server console). It deletes old block history, so it is the Admin's decision.
  3. OllamaSetup.exe in updates_v2 can go after the update.
  4. The Admin runs `vssadmin list shadowstorage` elevated to check shadow-copy use.

### b) Minecraft window and java closing together
- **11-03 07:22.** The monitor shows java 26124 (up 11.3 days) present at 07:21 and "server gone" at 07:22.
  - Its last log line was at 23:02 the night before. That is most likely just idle, because Paper logs little with nobody on.
  - No crash file, no WER/Application Error/Hang for java, and no Kernel-Power, Winlogon logoff, session change or Windows Update restart.
  - Memory was tight but not exhausted: commit 29.0/35.9 GB, 1.2-2.6 GB available, and no Resource-Exhaustion event in 30 days.
  - restarts.log has no stop line; the next start was 10:47:58 by hand.
- **10-22 18:56.** There is no monitor file for that day.
  - At 18:57:16-17 the TerminalServices log shows a session arbitration: session 3 disconnected, session 2 disconnected with reason 5 (replaced by another connection), and a Remote Desktop reconnect. DWM then re-registered.
  - No crash, logoff or update events.
- Reading: in both cases cmd and java ended together with no error. That fits the console window being closed, by a click on X or by something ending cmd/conhost, rather than a crash. On 10-22 it lines up with a Remote Desktop session takeover. A reconnect alone should not close windows, but a session being replaced or logged off would.
- Context: Windows flagged memory leaks (RADAR_PRE_LEAK) in java.exe on 11-01, in vmms.exe on 11-03 at 03:38, and in claude.exe, node.exe, ollama app.exe, obs64.exe and whisper-server.exe.
- To catch it next time:
  - SMP Main has the monitor also log conhost/cmd state and who ended them.
  - The Admin step: turn on "Audit Process Termination" (Security log event 4689), which records which process ended java and cmd.
