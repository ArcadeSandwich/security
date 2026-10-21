# Security on cadeyserver: what we found and how to fix it

For the Admin, in plain English. Kept current by Security (the lead). The full list, with every test and commit, is `C:\server\SECURITY-TRACKER.md`.
Last updated: 2026-10-20, night (round 2 finished, round 3 and the patches under way).

## Done while you slept
- **Every project on the server was checked**, in two rounds by five security specialists: the PC itself, Oak World and arcadesandwich.com, Work, the Workplace and the factory, the AI Workspace, the Playbook, the IRL stream, Minecraft, and MustaHub with musta.no.
- **A security tracker** (`C:\server\SECURITY-TRACKER.md`) lists every check, weakness, fix and recheck. Every fix is rechecked by a different specialist than the one who found the problem, and a row only closes after that recheck.
- **Fixed by the chats that own the code, and rechecked:**
  - the game's front door no longer trusts a forged forwarding header, its code check is timing-safe, and every page sends safety headers;
  - a test of the front door now runs with the game's tests;
  - the Work page, the Workplace and the old Work page are behind the front door, for you only;
  - the Workplace's port clash is fixed (Workplace 3001, old Work 3004);
  - the Workplace's pages now send the full set of safety headers, and the AI Workspace app's Workplace panel can reach only the Workplace page and adds your Lab code only there;
  - Finn Scout's new routes for the laptop need your key and keep their logs clean;
  - the Playbook's download tools can't be pointed back at this PC, and videos come only from YouTube and Instagram;
  - the game refuses requests that change things when they come from another site;
  - a feature is approved only by a decision you record on the Workplace, tied to the exact build text; text like "Approved: owner" no longer counts anywhere, and the old job runner never builds features;
  - players' bug reports now wait for an approval before the job runner builds them, approvals come only through the protected Workplace page, and every request is logged;
  - the job runner pushes only the exact version it checked, and refuses merge commits;
  - the background OpenCode service stops itself after 15 quiet minutes;
  - the Control chat and the Plan boxes can only read and list files, can't read your key files, and their old chats are retired;
  - the down warning in the Workplace is live (a red line on your desk screen);
  - the AI Workspace app has Electron's safety switches on (checked again on its next release).
- **Three fixes for the Dungeon Master's prompts** are ready for the DM chat: the lore and the story summary it writes itself are now fenced as data, so a planted line can't act as a rule (161 tests pass).
- **The git history of every repository was scanned: no keys anywhere.** All four GitHub repositories are private.
- **The security tool folder `C:\server\security` is built and approved by Server:** a read-only probe of the PC, seven fix packs and one launcher. Everything that needs administrator rights waits for your one Windows prompt.
  - It was hardened after two reviews: the launcher runs only files whose fingerprints Server approved, from a protected copy; undo records sit where only administrators can change them; and no script can be tricked into loading a fake PowerShell module or program (tested by planting fakes).
- **Fixes prepared for chats that are offline**, ready to apply in minutes when they return (`C:\server\security\patches\`), for IRLToolkit, the Dungeon Master, SMP Main and MustaHub. Nothing was applied to their files.

## Weaknesses and their fixes
Ranks: **high** means someone could get in or something important could be lost; **medium** means one more mistake away; **low** means tidy-up.

### Waiting for your Windows prompt (fix packs ready)
| Rank | What it means | Fix |
|---|---|---|
| High | **Remote Desktop is open to every device on your home network, and possibly to the internet over IPv6** (the PC has public IPv6 addresses; it depends on whether your router filters them). | FIX-1 limits it to your Tailscale devices; your router's IPv6 firewall is the second lock |
| High | **Hyper-V's remote console port (2179) and a Hyper-V management rule are open to the home network.** | FIX-2 switches 2179 off and limits the management port to Tailscale |
| High | **After a power cut, nothing comes back until someone signs in.** | FIX-5: the game, the Workplace and Ollama start at boot under your account and restart themselves 3 times. Ollama then runs in the background, so its tray icon goes |
| Medium | Several firewall rules let a program accept anyone; safe today only because of how things happen to be set. Windows' container DNS answers the home network. | FIX-4 limits them to Tailscale or the virtual switches |
| Medium | Two Tailscale rules let every Tailscale device reach every port, including file sharing. | FIX-3 blocks the ports the tailnet doesn't need (it also stops OBS remote control over Tailscale, so say no if you use that) |
| Medium | The settings files with your keys and codes can be changed by any account on the PC. | FIX-8 limits them to your account (it can't protect them from the chats, which run as you; replacing the keys can) |
| Medium | The IRL stream dashboards also wait for a sign-in after a power cut. | FIX-9 (approved, run with FIX-5) |
| Low | File sharing doesn't require signing. | FIX-10 (being built) |

### Being fixed by the chats that own the code
| Rank | What it means | Status |
|---|---|---|
| High | **The Control chat could change any file and push to GitHub, and the Plan boxes had full tools while reading players' text.** | **Fixed and rechecked for both** (everything blocked except reading and listing, key files blocked, old chat retired). Logging is also hardening the secret check on Control's tracker rows (it missed encoded or key-shaped text) |
| High (less likely) | The MAIN and Absurdity boxes on the Work page keep full tools. | **Your choice** (desk question Q-AG17-BOXES) |
| Medium | The game's buttons that change things (saves, photos, voice) trusted your login cookie alone; another page on an arcadesandwich.com subdomain could have pressed them for you. | **Fixed and rechecked**: the game now refuses such requests from other sites |
| Low | The AI Workspace app has Electron's safety switches ("fuses") off. | **Fixed** (checked again on its next release) |
| Medium | The Playbook's download tools could be tricked into fetching from this PC itself (for example Ollama) and saving the answer: by an unusual way of writing an address, or by a video link that redirects. | **Fixed and rechecked**: every address form is checked and pinned, and videos come only from YouTube and Instagram |
| Medium | The AI Workspace app's link handling and update check have gaps. | With the AI Workspace Manager |
| Medium | The game's voice package uses an image library with known holes; no fixed version exists yet, and visitors can't reach it. | Audio upgrades it when a fix comes out |

### Prepared for chats that are offline
| Rank | What it means | Patch |
|---|---|---|
| High | **MustaHub's code lets anyone who reaches it make themselves an admin or change the stream overlay.** If musta.no runs this code, only the Cloudflare login stops it. | **Ready:** every admin and overlay function now checks the login and the admin role (19 tests pass); you hand it over |
| High | **The IRL stream's git settings would publish MustaHub's passwords and keys** the first time the folder goes on GitHub. Nothing has leaked. | One-line patch for IRLToolkit, to apply before any git setup |
| High | **Every Minecraft backup goes only to the failing D: drive.** | Patch: a second backup target on the main PC over Tailscale (you set up the login there) |
| Medium | The stream machine's SRT management page opens for anyone on the home network (its controls still need a key). | Ready: one line makes it local-only |
| Medium | The IRL stream has no git at all, so nothing to restore from. | Ready: the steps after the git-settings patch |
| Low | The IRL dashboard trusts a forwarding header. | **Ready** for IRLToolkit (148 tests pass) |

| Medium | Lore the Dungeon Master writes itself is fed back into its rules. | **Ready:** the lore becomes a fenced data block (tested) |

| Medium | Nothing tells you when a service (the game, the Workplace, Ollama, the stream, Minecraft) goes down. | **Live** inside the Workplace (recheck queued): it posts "down" and "back" to your desk. Its limit: if the whole PC is down, nothing on it can tell you (that would need the main PC or a phone service later) |
| Medium | The October Windows updates are not installed. | Your step (Windows Update) |

### Clean in round 3
- Windows remote management is off (no WinRM, no remote registry, no SSH server; UAC on).

### Accepted, with the reason
- **Every chat runs as your Windows account,** so no file permission can hide a key from a chat. The protection is the rules, the logs and replacing keys if one ever leaks.
- **The OBS remote key travels in the web address**, because phone apps like Moblin can only connect that way. OBS's own password is the real lock, and IRLToolkit changes the key monthly.
- **Ollama answers your own Tailscale devices without a login**, on purpose (this PC and Tailscale only). The Tailscale access rule (FIX-7) keeps anyone you share with away from it.
- **Minecraft and Musta's OBS come back only after a sign-in**, because they need a desktop or console window. Automatic sign-in would close this, but it stores your password in the registry, so we recommend leaving it.

## Your part, in order (logins and permissions only)
0. **Most urgent: run FIX-1 and FIX-2 first** (step 2 below). Round 3 found that the home network card has **public IPv6 addresses**, and Remote Desktop and two Hyper-V ports accept anyone. If your router doesn't block incoming IPv6, they can be reached **from the internet**, not only from the Wi-Fi. Also, in your router's settings, turn on "block unsolicited inbound IPv6" (often called the IPv6 firewall). Optional check from outside: ask Network for this PC's IPv6 address in chat (it is never written in a file) and test port 3389 from a phone on mobile data.
1. **Copy the important data off the D: drive** (it is failing): the 960 GB of server backups and the 531 GB EDITING folder. Then replace the disk.
2. **Run `C:\server\security\console\Security fixes.cmd`.** Check first that its first lines show the approved-list fingerprint **F526B00D…** (the same as the desk card Q-SEC-RUN); ignore the commit number. If the fingerprint differs, stop and tell Server.
   - **Run 1:** yes only to FIX-0-example (a harmless test). No to the rest.
   - **Run 2:** yes to FIX-1 and FIX-2 first (not while you're connected over Remote Desktop from the home network), then FIX-4, FIX-8, FIX-10 and the deep probe. FIX-3 only if you don't control OBS over Tailscale.
   - **Later, at a quiet time:** FIX-5 and FIX-9 together (the game, the Workplace, Ollama and the two IRL dashboards start at boot). Windows asks for your password in its own box. Straight after, do the restart test in its README; if anything fails, run it again and choose Undo.
3. **Replace the keys** (steps in FIX-8's README): new key, swap it in, check the game, revoke the old one. Then delete the five old copies FIX-8 lists.
4. **Main PC, for the Minecraft backups:** turn on OpenSSH Server and a backup user, with port 22 open only to this PC's Tailscale address (steps in `patches\SEC-RES-8`). Space: each backup is about 34 GB, twice a day, and the plugin keeps 20 copies there, so mika-pc needs about **680 GB free**. If it has less, tell us how many copies to keep; nothing existing is deleted.
5. **musta.no's DMARC record: done** (SEC-NET-14 closed 2026-10-21). It is set to quarantine, with reports going to the booking address. Read the first reports: if real musta.no mail fails them, that mail lands in spam. Later, once the reports show that only Cloudflare sends as musta.no, the next step is SPF `-all` or DMARC `p=reject`.
6. **Tailscale:** paste the access rule from FIX-7's README (shared people reach only port 7420), after backing up the current one.
7. **GitHub**, for oak-world, ai-workspace and ai-workspace-app: Settings → Branches (or Rules → Rulesets) → add a rule for `main` → tick **Block force pushes** and **Restrict deletions** → Save. On a free account this may need GitHub Pro; if so, tell Server, and the check on this PC stays the lock.
8. **Windows Update:** the October updates are not installed (newest is from 9 September). Run "Check for updates" at a quiet time, after FIX-5, FIX-9 and their restart test, so the services come back by themselves after the update restart. Consider moving active hours to cover the evening, when the game is used.
9. **Delivery Optimization:** Settings → Windows Update → Advanced options → Delivery Optimization → "Allow downloads from other PCs" off (the part of FIX-10 that needs no script).
10. **MustaHub (arcade-server, which does not run musta.no):** deploy the branch `security/admin-checks` from ArcadeSandwich/Website-security on your local-network server, then merge it into main (SEC-PROG-19). For SEC-PROG-25, add the server's address as a redirect URL in the Twitch developer console (a login step). **For musta.no itself:** the Workers review is done and every fix has passed its recheck (SEC-PROG-39 to 46). Before Chief deploys the order store (store/legal b4848e7), set two Worker secrets on bok-ordre in Cloudflare: RATE_SALT (long and random) and ADMIN_PASSWORD (long and random). Then check that the admin page opens. Keep the Cloudflare Access login on musta.no until that deploy is live. Also yours: two-step sign-in on Cloudflare, GitHub and the domain registrar, and the registrar transfer lock (SEC-RES-18).
11. **When IRLToolkit is back:** create the private GitHub repository ArcadeSandwich/irl-stream (a login step) after its git-settings patch.

## For your information: unused sign-ins
Some apps you may not use still hold saved sign-ins on this PC: Codex, the Ollama app and Office. If you don't use them, sign out of them. Nothing found them in any repository or backup.

## For your information: memory
Free memory on cadeyserver fell to about 0.6 GB of 16 GB overnight. The chats (about 29 Claude processes, about 6.2 GB together, most of them 330 to 380 MB each) plus Minecraft (about 2.8 GB, normal) use most of it. Nothing is leaking or running away. Security paused every live test below the 1 GB safety line; code reading and patches went on. In the morning you can close the chats that have finished their work, which frees the most memory.

## Questions for you
- **Is anything on your Tailscale network besides your own devices?** (Ollama answers every Tailscale device.)
- **Where does arcade-server (MustaHub) run, and is it what serves musta.no?** (Q-ARCADE-DEPLOYED)
- **The MAIN and Absurdity boxes:** limit their commands to an allowed list (our pick), have them ask you before each command, or accept the risk? (Q-AG17-BOXES)
- **The Dungeon Master and hidden-message tests:** may Agents run them, and which chat and when?
- **musta.no:** where is it hosted, where is its code kept besides GitHub, is there a database or uploads outside git, and who can restore it?
- **Which permission mode** do Server, the game chats and the Control chat run in?
- **Four unnamed accounts** have permissions on C:\server and the key files. Are they yours, from an older install or another PC?
