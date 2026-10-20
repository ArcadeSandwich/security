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
- Built the read-only probe of the PC and seven fix packs (Remote Desktop, Hyper-V, Tailscale blocks, program rules, the Tailscale access rule, power-cut recovery, key-file permissions), plus the one launcher.
- Hardened them after two reviews: every pack keeps its undo record where only administrators can change it; the launcher runs only files whose fingerprints Server approved, from a protected copy; and no script can be tricked into loading a fake PowerShell module or a fake program (tested by planting fakes). Waiting for Server's final approval.
- Closed and rechecked: the Workplace's port switch, the old Work page now behind the front door, and the first half of the two job-runner fixes.

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
| High | **The Control chat can change any file and push it to GitHub;** only a written rule keeps it to the tracker files. | Agents | First fix rechecked and failed (it could be bypassed); now being rebuilt by Logging: Control gets no command line and no editing, and Work writes and pushes its tracker rows itself |
| High | **The Work page's Plan boxes have full command-line and git access** in the game folder and read job rows that can contain players' text; only a written "plan only" rule holds them back. | Agents | Logging made them read-only; the recheck found they can still read your key file and fetch web pages (so a hidden order could send keys out). Now: block everything except reading, and block reading the key files. The live Control chat also still runs on its old rules until it is swapped |
| High (less likely) | The Work page's MAIN and Absurdity boxes also keep full tools; their input is you, but MAIN reads files players can influence. | Agents | **Your choice**: limit their commands to an allowed list (Security's pick), have them ask you before each command, or accept the risk as your own tool |
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
1. **Copy the important data off the D: drive** (it is failing): the 960 GB of server backups and the 531 GB EDITING folder. Then replace the disk.
2. **Give Minecraft a second backup place** (SEC-RES-8), with SMP Main: DriveBackupV2 saves only to D:. Turn on a cloud target in its config, or copy to the main PC.
3. **Answer: where does arcade-server (MustaHub) run, and is it what serves musta.no?** (SEC-PROG-19, desk question Q-ARCADE-DEPLOYED). If yes, pass the fix to the MustaHub chats: every admin and overlay function must check the session and the admin role. Until then, keep the Cloudflare login on musta.no.
4. **Run `C:\server\security\console\Security fixes.cmd`** (the packs are approved and ready). First check that the console's first lines show the approved-list fingerprint **54010EF8…** (the same as the desk card Q-SEC-RUN). If it differs, stop and tell Server. (The commit it also shows changes whenever this presentation is updated, so the fingerprint is the one that counts.)
   - **Run 1:** answer yes only to FIX-0-example (a harmless test that proves the protected copy works). No to the rest.
   - **Run 2:** yes to FIX-1 (Remote Desktop to Tailscale only; don't do this while connected over Remote Desktop from the home network), FIX-2 (Hyper-V), FIX-4 (program rules) and FIX-8 (key-file permissions), and yes to the deep probe. FIX-3 (Tailscale blocks) only if you don't control OBS from a phone or laptop over Tailscale.
   - **Later, at a quiet time:** FIX-5 (power-cut recovery). Windows asks for your password in its own box. Straight after, do the restart test in its README; if anything fails, run it again and choose Undo.
5. **Replace the keys** (steps in FIX-8's README and HB-security-secrets): new key, swap it in, check the game, revoke the old one. Then delete the five old copies FIX-8 lists.
6. **Cloudflare DNS for musta.no** (SEC-NET-14): add a TXT record.
   - Name: `_dmarc`
   - Content, to start with (only reports, nothing blocked): `v=DMARC1; p=none; rua=mailto:<an address you read>`
   - After two weeks with no surprises, change `p=none` to `p=quarantine`.
7. **Tailscale**: paste the access rule from FIX-7's README (shared people reach only port 7420), after backing up the current one as the README says.
8. **musta.no questions** (SEC-RES-13): where is it hosted, where is its code kept besides GitHub, is there a database or uploads outside git, and who can restore it?
9. **GitHub branch protection on main** (the server-side stop that no chat can skip). On github.com, signed in as ArcadeSandwich, for each repository (oak-world, ai-workspace, ai-workspace-app):
   1. Open the repository, then **Settings**, then **Branches** (or **Rules → Rulesets**).
   2. **Add branch ruleset** (or "Add rule"), name it `main`, target branch `main`.
   3. Tick **Block force pushes** and **Restrict deletions**.
   4. Save.
   Two honest limits: every chat pushes with your account, so GitHub can't tell the Control chat from the others; this protects main from being rewritten or deleted, not from a normal push (the hook on this PC handles that). And on a free account, rules on private repositories may need GitHub Pro; if the page says so, tell Server and we keep the hook as the lock.
10. **Questions from the agents check**: which permission mode do Server, the game chats and the Control chat run in? Is GitHub's branch protection on? What are the four unnamed accounts with permissions on C:\server?
