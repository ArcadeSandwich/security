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
  - players' bug reports now wait for an approval before the job runner builds them, approvals come only through the protected Workplace page, and every request is logged;
  - the job runner pushes only the exact version it checked, and refuses merge commits;
  - the background OpenCode service stops itself after 15 quiet minutes.
- **The git history of every repository was scanned: no keys anywhere.** All four GitHub repositories are private.
- **The security tool folder `C:\server\security` is built and approved by Server:** a read-only probe of the PC, seven fix packs and one launcher. Everything that needs administrator rights waits for your one Windows prompt.
  - It was hardened after two reviews: the launcher runs only files whose fingerprints Server approved, from a protected copy; undo records sit where only administrators can change them; and no script can be tricked into loading a fake PowerShell module or program (tested by planting fakes).
- **Fixes prepared for chats that are offline**, ready to apply in minutes when they return (`C:\server\security\patches\`), for IRLToolkit, the Dungeon Master, SMP Main and MustaHub. Nothing was applied to their files.

## Weaknesses and their fixes
Ranks: **high** means someone could get in or something important could be lost; **medium** means one more mistake away; **low** means tidy-up.

### Waiting for your Windows prompt (fix packs ready)
| Rank | What it means | Fix |
|---|---|---|
| High | **Remote Desktop is open to every device on your home network.** | FIX-1 limits it to your Tailscale devices |
| High | **Hyper-V's remote console port (2179) and a Hyper-V management rule are open to the home network.** | FIX-2 switches 2179 off and limits the management port to Tailscale |
| High | **After a power cut, nothing comes back until someone signs in.** | FIX-5: the game, the Workplace and Ollama start at boot under your account and restart themselves 3 times. Ollama then runs in the background, so its tray icon goes |
| Medium | Several firewall rules let a program accept anyone; safe today only because of how things happen to be set. Windows' container DNS answers the home network. | FIX-4 limits them to Tailscale or the virtual switches |
| Medium | Two Tailscale rules let every Tailscale device reach every port, including file sharing. | FIX-3 blocks the ports the tailnet doesn't need (it also stops OBS remote control over Tailscale, so say no if you use that) |
| Medium | The settings files with your keys and codes can be changed by any account on the PC. | FIX-8 limits them to your account (it can't protect them from the chats, which run as you; replacing the keys can) |
| Medium | The IRL stream dashboards also wait for a sign-in after a power cut. | FIX-9 (being built) |
| Low | File sharing doesn't require signing. | FIX-10 (being built) |

### Being fixed by the chats that own the code
| Rank | What it means | Status |
|---|---|---|
| High | **The Control chat could change any file and push to GitHub, and the Plan boxes had full tools while reading players' text.** | Both are now read-only. The recheck found they can still read your key file and fetch web pages, so a hidden order could send keys out, and the live Control chat still runs on its old rules. Logging is switching them to "block everything except reading" |
| High (less likely) | The MAIN and Absurdity boxes on the Work page keep full tools. | **Your choice** (desk question Q-AG17-BOXES) |
| Medium | MAIN's start-prompt tool sends text into any chat that has the right title. | With Logging |
| Medium | The AI Workspace app's link handling and update check have gaps. | With the AI Workspace Manager |
| Medium | The game's voice package uses an image library with known holes; no fixed version exists yet, and visitors can't reach it. | Audio upgrades it when a fix comes out |

### Prepared for chats that are offline
| Rank | What it means | Patch |
|---|---|---|
| High | **MustaHub's code lets anyone who reaches it make themselves an admin or change the stream overlay.** If musta.no runs this code, only the Cloudflare login stops it. | Patch being prepared for the MustaHub chats (you hand it over) |
| High | **The IRL stream's git settings would publish MustaHub's passwords and keys** the first time the folder goes on GitHub. Nothing has leaked. | One-line patch for IRLToolkit, to apply before any git setup |
| High | **Every Minecraft backup goes only to the failing D: drive.** | Patch: a second backup target on the main PC over Tailscale (you set up the login there) |
| Medium | The stream machine's SRT management page opens for anyone on the home network (its controls still need a key). | Ready: one line makes it local-only |
| Medium | Lore the Dungeon Master writes itself is fed back into its rules. | Patch being prepared for the DM chat |
| Medium | The IRL stream has no git at all, so nothing to restore from. | Ready: the steps after the git-settings patch |
| Low | The IRL dashboard trusts a forwarding header; the OBS remote key travels in the web address. | Patches being prepared for IRLToolkit |

### Accepted, with the reason
- **Every chat runs as your Windows account,** so no file permission can hide a key from a chat. The protection is the rules, the logs and replacing keys if one ever leaks.
- **Minecraft and Musta's OBS come back only after a sign-in**, because they need a desktop or console window. Automatic sign-in would close this, but it stores your password in the registry, so we recommend leaving it.

## Your part, in order (logins and permissions only)
1. **Copy the important data off the D: drive** (it is failing): the 960 GB of server backups and the 531 GB EDITING folder. Then replace the disk.
2. **Run `C:\server\security\console\Security fixes.cmd`.** Check first that its first lines show the approved-list fingerprint **54010EF8…** (the same as the desk card Q-SEC-RUN); ignore the commit number. If the fingerprint differs, stop and tell Server.
   - **Run 1:** yes only to FIX-0-example (a harmless test). No to the rest.
   - **Run 2:** yes to FIX-1 (not while you're connected over Remote Desktop from the home network), FIX-2, FIX-4, FIX-8 and the deep probe. FIX-3 only if you don't control OBS over Tailscale.
   - **Later, at a quiet time:** FIX-5. Windows asks for your password in its own box. Straight after, do the restart test in its README; if anything fails, run it again and choose Undo.
3. **Replace the keys** (steps in FIX-8's README): new key, swap it in, check the game, revoke the old one. Then delete the five old copies FIX-8 lists.
4. **Main PC, for the Minecraft backups:** turn on OpenSSH Server and a backup user, with port 22 open only to this PC's Tailscale address (steps in `patches\SEC-RES-8`). Space: each backup is about 34 GB, twice a day, and the plugin keeps 20 copies there, so mika-pc needs about **680 GB free**. If it has less, tell us how many copies to keep; nothing existing is deleted.
5. **Cloudflare DNS for musta.no:** add a TXT record named `_dmarc` with the content `v=DMARC1; p=none; rua=mailto:<an address you read>`. After two weeks with no surprises, change `p=none` to `p=quarantine`.
6. **Tailscale:** paste the access rule from FIX-7's README (shared people reach only port 7420), after backing up the current one.
7. **GitHub**, for oak-world, ai-workspace and ai-workspace-app: Settings → Branches (or Rules → Rulesets) → add a rule for `main` → tick **Block force pushes** and **Restrict deletions** → Save. On a free account this may need GitHub Pro; if so, tell Server, and the check on this PC stays the lock.
8. **When IRLToolkit is back:** create the private GitHub repository ArcadeSandwich/irl-stream (a login step) after its git-settings patch.

## Questions for you
- **Where does arcade-server (MustaHub) run, and is it what serves musta.no?** (Q-ARCADE-DEPLOYED)
- **The MAIN and Absurdity boxes:** limit their commands to an allowed list (our pick), have them ask you before each command, or accept the risk? (Q-AG17-BOXES)
- **The Dungeon Master and hidden-message tests:** may Agents run them, and which chat and when?
- **musta.no:** where is it hosted, where is its code kept besides GitHub, is there a database or uploads outside git, and who can restore it?
- **Which permission mode** do Server, the game chats and the Control chat run in?
- **Four unnamed accounts** have permissions on C:\server and the key files. Are they yours, from an older install or another PC?
