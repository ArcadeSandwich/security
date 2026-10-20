# Security on cadeyserver: what we found and how to fix it

For the Admin, in plain English. Kept current by Security (the lead). The full list is `C:\server\SECURITY-TRACKER.md`.
Last updated: 2026-10-20 (round 2 under way).

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
| Medium | **Nine plain-text copies of your AI keys and Lab code** sit in old folders. | Secrets' scan | Your steps: delete the old copies, then replace the keys; pack SEC-FIX-8 helps |
| Medium | Some firewall rules let a program accept anyone; today safe only because of how the programs or the network are set. | Network | Fix pack SEC-FIX-4 |
| Medium | Two Tailscale rules let every Tailscale device reach every port. | Network | Fix pack SEC-FIX-3 |
| Medium | The stream's virtual machine sits directly on the home network, outside the Windows firewall. | Network (round 2) | Being checked (SEC-NET-8) |
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
