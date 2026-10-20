# Security on cadeyserver: what we found and how to fix it

For the Admin, in plain English. Kept current by Security (the lead). The full list is `C:\server\SECURITY-TRACKER.md`.
Last updated: 2026-10-20 (round 2 under way).

## Done while you slept
- Built a security tracker (`C:\server\SECURITY-TRACKER.md`) that lists every check, weakness, fix and recheck, for every project.
- Mapped every open port and every program on the server (12 programs).
- Mapped every AI agent and bot and what each may change. Two new medium gaps, both in how bug reports flow to the job runner, were sent to the Logging chat.
- musta.no is entirely behind a Cloudflare Access login, which is good.
- Started the security tool folder (`C:\server\security`). The fix launcher is written and under review: it will apply only fixes whose files match what Server approved.
- Approved the design for recovery after a power cut. You will type your Windows password once, in Windows' own window. **One side effect:** Ollama will start as a background service at boot, so its tray icon will no longer appear.
- Built the read-only probe of the PC, and fix packs for Remote Desktop, Hyper-V's port 2179 and power-cut recovery. All are under review: every pack keeps its undo record where only administrators can change it, so no chat can tamper with an undo.

## 1. What was checked
| Project | Checked so far | Still to check |
|---|---|---|
| The PC itself (Windows, firewall, Tailscale) | open ports, firewall rules, Remote Desktop, Tailscale peers, startup after a restart, shutdowns, the D: drive | file sharing (SMB), Tailscale details, the deep check that needs your Windows permission |
| Oak World and arcadesandwich.com | the front door, the tunnel, routes, safety headers, keys and their copies, git history, the Dungeon Master's prompts | the routes added since round 1, the packages again |
| Work, the Workplace and the factory | the Work page's code check, the job runner's approval | lanes, merges, what jobs may write |
| AI Workspace (app, Prompt generator, Finn Scout) | the app's link handling and updater | the Prompt generator's key check, Finn Scout |
| The Playbook | its secret scanner (now also scans git history) | its tools' handling of file names |
| IRL stream | where its secrets live | its dashboards, OBS's remote control, the stream's virtual machine |
| Minecraft (Arcade SMP) | its port is open on purpose | its settings files (reading only) |
| MustaHub and musta.no | not yet | how musta.no is served, its public pages, its code on the Desktop |

## 2. Weaknesses, most serious first
| Rank | What it means in everyday words | How it was found | Fix |
|---|---|---|---|
| High | **Remote Desktop is open to every device on your home network.** Anyone on the Wi-Fi can reach this PC's sign-in screen. | Firewall rules read by Security and Network | Fix pack being prepared (SEC-FIX-1): one yes in the Windows prompt |
| High | **Hyper-V's remote console port (2179) is open to the home network the same way.** | Network's port check | Fix pack being prepared (SEC-FIX-2) |
| High | **The D: drive is failing and holds the only copy of 960 GB of server backups and 531 GB of editing files.** The newest game backup is from 29 September. | Resilience's disk check (warning, 17 disk errors) | Your step: copy the data off and replace the disk; then the nightly backup (BACKUP-1) |
| High | **After a power cut nothing comes back until someone signs in to Windows.** | Resilience's restart check | Fix pack being prepared (SEC-FIX-5) |
| High | **The Control chat can change any file and push it to GitHub;** only a written rule keeps it to the tracker files. | Agents | Sent to the Logging chat (Work checks Control's changes before they are pushed) |
| High | **The IRL stream's git settings would publish MustaHub's passwords and keys** the first time that folder is put on GitHub (`private-musta` is not excluded). Nothing has leaked; there is no git there yet. | Secrets | Sent to the IRLToolkit chat: one line in .gitignore before any git setup |
| Medium | **Six plain-text copies of your AI keys and Lab code** (the live one, a .bak, two in backups, two in old work folders). | Secrets' scan (corrected from nine) | Your steps: delete the five old copies, then replace the keys; pack SEC-FIX-8 helps |
| Medium | A guest's bug report can become a job the job runner builds without anyone reading it. | Agents | Sent to the Logging chat |
| High | **Every Minecraft backup goes only to the failing D: drive** (every 3 hours, 48 GB, cloud copies switched off). | Resilience | SMP Main and you: add a second backup target off D: |
| Medium | **Several projects exist in only one place:** the game's saves (no copy off C:), the Work program, the Playbook, the security tools, and the IRL stream (no git at all). | Resilience | One nightly copy of C:\server to the main PC (BACKUP-1) closes most of these |
| Medium | The Minecraft and IRL stream startup tasks also wait for someone to sign in. | Resilience | Your step, after the power-cut fix |
| Unknown | Where musta.no is hosted and how it is backed up is not visible from this PC. | Resilience, Agents | Four questions for you |
| Medium | Some firewall rules let a program accept anyone; today safe only because of how the programs or the network are set. | Network | Fix pack SEC-FIX-4 |
| Medium | Two Tailscale rules let every Tailscale device reach every port. | Network | Fix pack SEC-FIX-3 |
| High | **The stream's virtual machine shows its SRT management page to anyone on your home network, with no login** (port 8123). The machine sits on the home network and has no firewall of its own. | Network (round 2) | Sent to the IRLToolkit chat: make that page local-only, or switch on the machine's firewall |
| High | **MustaHub's code (arcade-server) lets anyone who reaches it make themselves an admin or change the stream overlay.** Its admin and overlay functions check nobody. If musta.no runs this code, only the Cloudflare login stops it. | Programs (code reading) | Sent to the MustaHub chats; your answer needed: where does arcade-server run? |
| Medium | The game's voice package uses an image library (sharp) with known holes; no fixed version exists yet, and visitors can't reach it. | Programs | Sent to the Audio chat: upgrade when the fix comes out |
| Medium | musta.no's email settings have no DMARC record, so others can more easily send email that pretends to come from musta.no. The website itself is well protected (Cloudflare login on everything). | Network | Your step: one DNS record in Cloudflare |
| Medium | Windows' container DNS and a Hyper-V management rule accept anyone on the home network. | Network | Added to the firewall fix packs |
| Medium | The job runner's "approved" mark is plain text anyone could write. | Agents | Sent to the Factory chat |
| Medium | Lore the Dungeon Master writes itself is fed back into its rules. | Agents | Sent to the Dungeon Master chat |
| Medium | The AI Workspace app's link handling and update check have gaps. | Programs, Secrets | Sent to the AI Workspace Manager |
| Medium | 11 unexpected shutdowns in 30 days, mostly the power button held after a hang. | Agents, Resilience | Being watched |
| Low | Several small code fixes in the game (forwarding header, timing-safe check, safety headers). | Programs | **Done and rechecked** |

## 3. Fixed and rechecked
- The front door no longer trusts a forged forwarding header (rechecked).
- The Lab code check is timing-safe (rechecked).
- The game's pages, including the code page, send safety headers (rechecked).
- The Work page and the Workplace now sit behind the front door, for you only (rechecked).
- A test of the front door now runs with the game's tests.
- The git history of all repositories has been scanned: no keys.

## 4. Still open, and why
- Anything that needs Windows administrator rights waits for you: the fix packs run with one Windows prompt from `console\Security fixes.cmd`.
- Cloudflare, Tailscale and GitHub steps need you to sign in; they will be written as click steps.
- The Dungeon Master and hidden-message tests wait for your yes.

## 5. Your part, in order
1. Copy the important data off the D: drive (it is failing).
2. Run `Security fixes.cmd` once and answer yes or no per fix (Remote Desktop, Hyper-V, power-cut recovery first).
3. Delete the old key copies, then replace the keys (steps in SEC-FIX-8).
4. Tailscale and Cloudflare click steps.
