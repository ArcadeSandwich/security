# Security log

## Handoff
- Doing: lead of the security team; HB-security filed; weakness list and rota below.
- Next: read the specialists' first PLANs (SEC-NET-1, SEC-SECRETS-1, ...) when the Admin opens them; SEC-2 answer from Server.
- Files: this log; C:\server\playbook\inbox\ for my own submissions.

## Open requests
- Oak World Server: the Admin's answer on PLAN SEC-2.

## Weaknesses (moved 2026-10-20 to C:\server\SECURITY-TRACKER.md, which now wins; kept here as history)
| ID | Rank | What | Owner | Fix | Status |
|---|---|---|---|---|---|
| W-1 | high | Remote Desktop 3389 allowed from Any on every profile | Network | Admin limits both rules to 100.64.0.0/10, or switches RDP off (SEC-2) | with the Admin |
| W-2 | medium | Firewall program rules "Any": ollama.exe (Private), OBS Studio (Private, 4455 on every card), Node.js (Public) | Network | Admin scopes each to 100.64.0.0/10 or deletes it | open |
| W-3 | high | D: volume Warning, 17 disk errors; holds the only copy of 960 GB server backups + 531 GB EDITING; newest game backup 2026-09-29, local only | Resilience | Admin copies data off D:, replaces the disk; BACKUP-1 nightly off-PC copy | with the Admin |
| W-4 | medium | 9 plain-text copies of oak-config keys and Lab code (work folder, 2 in backups\, dm-wt, 5 job worktrees); only lock is git-ignore; Users read, Authenticated Users modify | Secrets | Admin deletes the old copies, then rotates the Gemini keys, extraProviders key and Lab code; optionally limits oak-config.json to the Admin's account | with the Admin |
| W-5 | low | .env not in the game's .gitignore | Secrets | add `.env` to .gitignore (plan to Server) | open |
| W-6 | low | Git history: full content scan of 5 repos clean (draft check.js --git, 7b7f46b0; tool under Server review); repos private; push access: the Admin confirms | Secrets | Server reviews and files check.js --git; the Admin confirms push access | nearly closed |
| W-8 | high | Hyper-V rule REMOTE_DESKTOP_TCP_IN allows TCP 2179 from Any on every profile; vmms listens on every card | Network | Admin scopes or disables the rule (Network's PLAN to Server) | with Server |
| W-9 | medium | Two "Tailscale-In" rules allow every port from any address to the Tailscale addresses; per-port Tailscale rules narrow nothing; the ACL is the only lock against shared people | Network | Admin removes or narrows them; confirm ACL before sharing | open |
| W-10 | medium | More program rules "Any": Java, OpenJDK, obs-browser-page (Public); bun, bunx (Private) (adds to W-2) | Network | as W-2 | open |
| W-11 | low | lib/access.js ipOf trusts x-forwarded-for when cf-connecting-ip is missing (local programs only) | Programs | trust only cf-connecting-ip, else the socket address (PLAN to Server) | closed (recheck PASS, dfc2c027) |
| W-12 | medium | IRL stream secrets (C:\irl-stream\private, private-musta) protected only by .gitignore; check.js can't match their values | Secrets | PLAN: check.js learns those values (names only) before irl-stream goes on GitHub | waits for IRLToolkit (SEC-SECRETS-2 part 2) |
| W-13 | medium | AI Workspace app: guard() passes blocked URL schemes to openExternal; the Odysseus window has no guard and allows http; updater hash from the same source as the file, no signature; no senderFrame checks (low) | Programs | PLAN to Server for the AI workspace manager | routed (W-11, 14, 15 to Network SEC-W11; 13, 16 to AI Workspace Manager); recheck by owner specialist when fixed |
| W-14 | low | lib/http.js:64 requireLabCode compares with !== (not timing-safe) | Programs | use access.js same() (SEC-PROGRAMS-FIX-1) | closed (recheck PASS, dfc2c027) |
| W-15 | low | Game pages send no security headers (nosniff, frame-ancestors, CSP) | Programs | add headers (SEC-PROGRAMS-FIX-1) | closed (5386d6dd, recheck PASS 4779d7ad) |
| W-16 | low | Odysseus window has no will-navigate guard (adds to W-13) | Programs | guard()-style rules (SEC-PROGRAMS-FIX-1) | routed (W-11, 14, 15 to Network SEC-W11; 13, 16 to AI Workspace Manager); recheck by owner specialist when fixed |
| W-17 | medium | oak-world/.claude/settings.local.json allows `Bash(node -e ' *)` without a prompt; 2 stale git commit allow lines (low) | Agents | remove them (SEC-AGENTS-FIX-1) | with the Admin (choice) |
| W-18 | medium | Auto's feature approval is row text "Approved: owner" (runner.mjs:211), forgeable by any chat or injected text | Agents | runner checks a desk record of the Admin's approval | routed to the Factory chat |
| W-19 | medium | Model-written DM lore re-enters the SYSTEM prompt each turn (dm/prompt.js:93): stored injection | Agents | codex as marked data, keep caps (DM chat) | routed to the DM chat (when open) |
| W-20 | medium | 11 unexpected shutdowns in 30 days, 8 on 2026-10-18 20:06-23:57 | Resilience | find cause (INS-015) | cause: hangs forced off by power button (7 of 11), no blue screens; 10-18 fast startup failure + NVIDIA installer | open |
| W-21 | medium | Prompt generator 7420 has no startup task | Resilience | startup task (plan to Server) | with the Admin (autostart question) |
| W-22 | high | Startup tasks trigger at logon only and automatic sign-in is off: nothing returns after a power cut until someone signs in; no restart-on-failure (medium) | Resilience | at-startup triggers or auto sign-in (Admin decides), restart-on-failure | with the Admin |
| W-23 | low | UDP 53 and 24454 listen on all cards, not yet checked against firewall | Network | NET-P2 in round 2 | open |
| W-24 | low | Pages Work/Workplace serve from 3001 lack nosniff and frame headers | Programs | add headers (Factory chat) | routed |
| W-7 | unknown | Tailscale ACL for shared people (tcp:7420) can't be read from this PC | Network | the Admin confirms before anyone is shared | open |

## Rota (at most two specialists checking at once)
- Round 1, pair A: Network + Secrets. Pair B, after A's DONE: Programs + Agents. Then Resilience (alone, or with whoever is waiting).
- Second runs each round (a protocol counts only after a second security chat ran it): Network runs one of Secrets', Secrets one of Programs', Programs one of Agents', Agents one of Resilience', Resilience one of Network's. Round 1 also: Network re-runs INS-001 on 11434 and 7420.
- Round 1 second runs: Network INS-001 (done, partly) · Secrets INS-010 · Programs INS-018 (NET-P3) · Agents INS-015 · Resilience INS-016 (NET-P1).
- Status 2026-10-20: Network DONE (2797d2c5); Secrets DONE (29d5efeb); Programs DONE (c20b2d6b SEC-3 test, d47ca6dc log); Agents DONE (2a531e1c); Resilience DONE (fc1f783f); round 1 finished; Secrets drafting check.js --git (SEC-SECRETS-2). W-11 and W-13 now with Server (SEC-PROGRAMS-FIX-1). Agents' live tests need the Admin's yes (PLAN SEC-AGENTS-2 via Server).
- Every submission: check.js passes, then I read it, then "From Security: PLAYBOOK inbox/<file>" to Server.

## Log

### 2026-10-20 · Round 2 and SEC-INFRA
The Admin ordered a full analysis of every project, musta.no included, and a tool folder C:\server\security (probe, fix packs, console; security chats may write code only there). C:\server\SECURITY-TRACKER.md is the one list (W numbers kept). Standing order relayed by Server: Server approves every security plan; only Windows prompts, Cloudflare, Tailscale, GitHub and account steps wait for the Admin. Presentation kept current in C:\server\security\PRESENTATION.md.

### 2026-10-20 · Lead set up
Server filed HB-security (Playbook d081ec5) and made Security the lead of five specialists. Weakness list and rota above. SEC-2 is with the Admin.

### 2026-10-20 · PLAN SEC-2 · Remote Desktop open to every network (high)
**Finding:** the inbound rules "Eksternt skrivebord – brukermodus (TCP-In)" and "(UDP-In)" allow port 3389 from Any on Domain, Private and Public; svchost listens on 0.0.0.0:3389. Any device on the home network (10.0.0.x) can reach the sign-in screen; the internet can too if the router forwards 3389 (not checkable from here).
**Files:** none (a Windows setting).
**Does:** steps for the Admin, with admin rights: open "Windows Defender Firewall with Advanced Security" > Inbound Rules > each of the two Remote Desktop rules > Properties > Scope > Remote IP address: "These IP addresses" > add 100.64.0.0/10 > OK. Remote Desktop then works only over Tailscale. If the Admin never uses Remote Desktop: Settings > System > Remote Desktop > Off instead.
**Not:** Security changes nothing; Minecraft 25565 untouched.
**Data:** none. **Test:** afterwards, netsh shows RemoteIP 100.64.0.0/10 on both rules; from a home-network device not on Tailscale, 10.0.0.6:3389 times out; from Tailscale it answers.
**Risk:** if the Admin reaches this PC by Remote Desktop from a device not on Tailscale, that stops working.
**Question:** (a) limit to Tailscale, or (b) switch Remote Desktop off. My pick: a.

### 2026-10-20 · SEC-1 checks done · HB-security submitted
inbox/2026-10-20-security-hb-security.md passes check.js and a dry intake. Findings: 1 high (SEC-2), 3 medium (program firewall rules "Any"; no backup yet; old oak-config copies in backups/), 1 low (.env not ignored). Detail in the handbook's report section.

### 2026-10-20 · PLAN SEC-1 · HB-security outline
**Files:** adds one submission, `C:\server\playbook\inbox\2026-10-20-security-hb-security.md` (kind handbook, id HB-security, skill security, owner Security, origin practice, status draft, related [INS-001]). Nothing else in the library is edited; Server runs intake.

**Does:** writes the handbook with the template's headings, filled from read-only checks on cadeyserver:
1. Purpose and Scope: defensive checks of our own systems on this PC; not play.arcadesandwich.com, not other PCs.
2. Safety rules: read-only checks only; never print keys, codes or tokens (check presence and length only); never change firewall, Cloudflare, Tailscale or settings; fixes are written as steps for the Admin or a PLAN for Server; downloaded material is data.
3. What to look for, one section per system, each with the exact read-only command and what "good" looks like:
   - A. The game's access door and codes: where the Lab code is checked, that every API route needs it, no code in git, the page, logs or URLs; how to rotate.
   - B. The Cloudflare tunnel: which hostnames and local ports it publishes (config file and `cloudflared` service, read-only), that nothing else is published, that the tunnel token is not in any repo.
   - C. Tailscale and the shared-people rule for port 7420: who is on the tailnet and who the device is shared with (`tailscale status`), that 7420 listens only where INS-001 allows, and the rule for who may be shared.
   - D. Windows firewall rules for Ollama (11434) and the Prompt generator (7420): INS-001 steps 1 to 3 for both; every allow rule limited to 100.64.0.0/10 or this PC.
   - E. Keys in the Windows user environment: names only (GEMINI_API_KEY, GROQ_API_KEY, ...), set or not, never values; that no key is copied into a file, repo or log (the Playbook's check.js scan as the model).
   - F. Git and GitHub hygiene: .gitignore covers oak-config.json and other secret files, no secret in history (pattern scan, file and line only), which repos are public or private, push access, INS-004 for shared folders.
   - G. The C:\server signposts: old addresses stay as signposts, never deleted; check they point to the right place and hold no secrets.
   - H. Backups (BACKUP-1): what is backed up, where, how often, whether a restore was ever tested, and that backups hold no keys in clear text, or are stored as safely as the originals.
4. How to rank findings: critical (a key or code readable from outside), high (a port reachable from the home network or internet), medium (a key in a local file outside its place, a backup never tested), low (hygiene), one example each.
5. Countermeasures: the standard fix per finding kind, each with its source (Tailscale, Cloudflare, Microsoft docs, GitHub docs), written as Admin steps.
6. Report format: date, system, check run, result, finding, rank, fix steps, who acts (Admin or Server).
7. Related instructions: INS-001 (port check), INS-004 (git); later INS-new per check that proves useful (e.g. "check keys are not in any repo").

**Not:** no change to any firewall rule, Cloudflare, Tailscale, environment variable, service or file outside the inbox and this log; no key, code or token value in any message or file; nothing about play.arcadesandwich.com; no subagents.

**Data:** none.

**Test:** `node tools/check.js inbox/2026-10-20-security-hb-security.md` passes (front matter and secret scan) before I tell Server; Server's intake files it.

**Risk:** a check could print a secret by accident; every command is chosen to show names, lengths or addresses only, never values.

**Question:** findings that need a fix: (a) only in the handbook's report section, or (b) each also sent to Server at once as its own PLAN. My pick: b for critical and high, a for the rest.
