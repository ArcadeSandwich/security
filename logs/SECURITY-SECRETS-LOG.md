# Security · Secrets log

Notes of the Security · Secrets chat (secrets and data). No values ever: names, counts, kinds only.

## 2026-10-20, round 1 (SEC-SECRETS-1; turn from Security, paired with Network)
Free memory at start: 2.7 GB of 16 GB (INS-005: the checks are light).

### P1 inventory
- User environment: GEMINI_API_KEY (53), GROQ_API_KEY (56) set; OAK_ACCESS_OFF not set.
- Ignored and untracked: oak-config.json, access.json, saves, backups, logs (game); pg-keys.json (ai-workspace); Desktop\arcade-server\.env (also never committed).
- engine/settings/access.json is tracked but holds limits only (_help, maxGuests, idleMinutes, cookieDays, wrongTries, wrongWindowMinutes).
- W-5 still open (low): `.env` not in the game's .gitignore (none exists).
- Commit authors: noreply in all four repos.
- C:\irl-stream: no git yet; private\ (9 files) and private-musta\ (5) hold passwords and keys; `private/` is in .gitignore.

### P2 leftover copies (W-4)
- check.js: game logs and live logs clean.
- 9 plain-text copies of the live oak-config keys and Lab code (labCode, geminiApiKeys[0-4], extraProviders[0].apiKey):
  - the work folder's oak-config.json;
  - backups\oak-config.before-2026-09-27-fix.json and backups\oak-config.before-queue-lock-2026-09-29.json (live\backups is a junction to the same folder);
  - dm-wt\oak-config.json;
  - jobs\_main, jobs\UI-OR329a-10081925, jobs\UI-OR330a-10081942, jobs\Characters-OR333a-10081932 (all git-ignored);
  - jobs\Network-OR70-09300332 (no git; file system only).
- Protection: git-ignored only. icacls: BUILTIN\Users read and Authenticated Users modify, so any local account can read the keys. Rank medium (one protection; keys still live).
- Fix for the Admin: delete the 2 backups and the dm-wt and jobs copies when those folders are done with; then rotate the Gemini keys, the extra provider key and the Lab code, because old copies existed. Optional: restrict oak-config.json to the Admin's account.

### P3 git history (W-6, part)
- Names ever committed, 5 repos (oak-world 3647 commits, ai-workspace 11, app 21, work 24, arcade-server 19): no secret file. False positives: game assets; flagged: arcade-server .env.sample x4, packages/twitch/src/token.ts, engine/test/mp2-27d-tokens.test.js.
- 15 old versions exported to my scratch folder, check.js OK, folder deleted.
- Gap: full content history isn't scanned (check.js has no git mode). Visibility and push access: question for the Admin through Security.

### Second-chat run: INS-010 (Programs, Electron)
- Worked. Gaps: guard() sends any blocked URL scheme to openExternal (medium); Odysseus window unguarded, http allowed (medium); no senderFrame checks (low); updater hash comes from the same source as the file, with no signature (medium, already known).

### Defense in depth: secrets with only one protection
1. oak-config keys and Lab code (9 copies, git-ignore only, all local users can read).
2. IRL stream private\ secrets (gitignore only; check.js can't match their values).

## 2026-10-20, SEC-SECRETS-2 part 1 (check.js --git draft; Server's yes, slot from Security · Lead)
- W-6 visibility closed (Security · Lead): oak-world, ai-workspace, ai-workspace-app and arcade-server are private (404 to anonymous); only the Admin can push.
- Drafted `check.js --git <repo...>` with lib/githistory.js, in my scratch folder only (patch and test there for Server to review). Every blob reachable from any ref is read with git cat-file --batch, in memory, and reported by path, first commit and kind. Binaries and blobs over 1 MB are skipped.
- Test: 3 of 3 pass (a fake key in an old commit is found with its commit and never printed; a clean repo is OK; a non-repo fails cleanly).
- Full content-history scan with the draft, free memory 1.9 GB before and after: all OK. oak-world 11367 blobs (3738 binary, 1 over 1 MB skipped) in 8 s; ai-workspace 27; ai-workspace-app 134; oak-world-work 85; arcade-server 252. W-6 content gap closed for these repos.
- Part 2 (IRL stream values) waits for IRLToolkit.

## 2026-10-20, round 2: SEC-SECRETS-5a to 5i (GO from Security · Lead; free memory 1.9 GB)
- Correction to round 1 W-4: 6 files hold the live oak-config values, not 9. They are oak-config.json, oak-config.json.bak (missed in round 1; ignored by *.bak), the 2 backups\ copies, dm-wt and jobs\_main. The other 4 job configs have no live or key-shaped values (round 1 read truncated output).
- HIGH (PLAN SEC-SECRETS-8 to Server): C:\irl-stream\.gitignore `private/` doesn't cover `private-musta/` (5 secret files). The first commit of the planned repo would include them. Fix for IRLToolkit: `private*/` before git init. No .git yet.
- check.js on working files: clean in Oak World (3839 files, apart from the copies above), live (1341), Work (56), app (64), AI Workspace (62), Playbook (129), arcade-server (130), irl-stream outside private*\ (62), and Arcade SMP (992; no git).
- check.js --git: all OK. oak-world 11388, work 85, app 149, ai-workspace 28, playbook 204, arcade-server 252 blobs.
- Low: ai-workspace logs\ is tracked in git (clean today). Gap: check.js doesn't know the arcade-server .env or IRL values (SEC-SECRETS-2 part 2).
- musta.no: no local MustaHub clone; only private-musta\ and start-musta*.bat on this PC.

## 2026-10-20, round 2: SEC-FIX-8 and SEC-INFRA-4
- SEC-FIX-8 (C:\server\security\fixes\FIX-8-oak-config-permissions) limits oak-config.json and access.json to CadeyServer, SYSTEM and Administrators. The grant comes before any removal, because the tasks run Limited. Each file's ACL is saved to the admin-only state folder, and Undo validates both saves before restoring. Status: reviewed-security (5ebcd15); Server sets ready. Not applied (it needs the Admin's elevated session).
- Rotation steps and the two-locks table went to the Playbook as an HB-security-secrets update.
- SEC-INFRA-4: probe.ps1 ran once at the normal level (1.76 GB free, 14 s, 13 sections). check.js OK on reports\2026-10-20 (4 files). By-eye pass: the long strings are firewall group GUIDs and app package names; user environment shows names and lengths only; the tunnel shows routes only; there are no password, token or cookie values.

## 2026-10-20, round 3: SEC-SECRETS-11, 12, 13 (GO from Security · Lead)
- Free memory: 865 MB at the start of 11 (below INS-005's 1 GB line; java/Minecraft 2.8 GB), then 1.0 to 1.1 GB. Only light metadata reads were run, with memory checked between steps.
- Patches: SEC-SECRETS-8 is ready-for-owner (2051dee). SEC-SECRETS-10 is now the IRL part only, per Server (b1fde5d).
- 11, browser stores (Get-ChildItem metadata only; nothing opened or copied): 59 files named Login Data, Cookies, Web Data or Network Persistent State, in Chrome, Edge, Claude, AI Workspace, Codex, OpenCode, the Ollama app, OBS's browser, Office and Windows Search. The Claude and AI Workspace stores appear twice (Roaming and the MSIX Packages\Claude_…\LocalCache copy). None are in C:\server, any git repo or BACKUP-1's scope. Profile roots allow only CadeyServer, SYSTEM and Administrators, plus the Claude app's AppContainer SID on AppData\Roaming and \Local (Chrome's User Data excludes it). Low: signed-in stores in apps possibly unused (Codex, Ollama app, Office); sign out of what isn't used. BACKUP-1 must never include %APPDATA% or %LOCALAPPDATA%.
- 12, Credential Manager: 4 entries, all Generic (no names recorded). No project code (game, Work, AI Workspace, security, Playbook, IRL) calls cmdkey, CredWrite, Get-StoredCredential, PasswordVault or keytar.
- 13, Workplace: workplace/data and factory/data are ignored; check.js OK (33 files); the one log (approve-fix-requests.log) is ignored and holds time, device, project, row, fixHash and status, never the Lab code (fix-approvals.js). The Lab code check is timing-safe. pg-service logs who, route and status only. Low: tools/pg-add-person.js prints a new key to the console by design, so only the Admin runs it, never a chat (the key would land in the transcript). Low: workplace/logs and factory/logs aren't ignored (they don't exist yet).

## 2026-10-20, SEC-AG-20 recheck: code reading only (live tests paused below 1.5 GB free, by Server)
- Read control-tracker.mjs at 19ba3a7 (still the newest), plus its test. parseBlock runs liveSecretIn on the whole block body before any op.
- Holds: key shapes are refused even when not live (Anthropic, OpenAI, Google, Groq, GitHub, private key, long mixed tokens; 32-40 character hex passes, as accepted). Live values are checked plain, with zero-width characters removed, with whitespace squeezed, reversed, base64-decoded (tokens of 16+ characters) and joined across every pair of cells. Long values (24+ characters) are also caught by any 12-character piece. Fails closed without check.js. Errors name the kind only.
- Gaps (all need a deliberate hider; none is a leak path by accident):
  1. Short live values (whole-word: the Lab code, 6-7 characters) are checked only in the first 4 forms: no base64 and no cell join. A Lab code split across two cells passes.
  2. A value of 8-23 characters is matched only whole: split into 3+ cells, or with other characters between its parts, it passes. Base64 of a value under 12 characters is shorter than 16, so it isn't decoded.
  3. Cell pairs are capped at 240 cells, so padding a block with 240 cells first hides a split value after them. The cap on block length is MAX*20.
  4. Not covered: hex, URL-encoding or HTML-entity encodings of a value, case changes, and key shapes with spaces between their characters (only live values are squeezed).
- Verdict: PASS for the scope set in SEC-AG-16b/20. Gaps 1 to 3 are low, for Logging's choice: check the whole-word values in all forms, join cells in sliding windows of up to 4, and refuse a block over the 240-cell cap instead of skipping. The live test run is still to do, once memory allows.

## 2026-10-20, LISTEN-2 data recheck (code reading; app 0851eb1 + bc681f7; not live)
- Free memory 1.57 GB. Only check.js was run; no services were started.
- Ignored and never committed: listen/data/ (keys.json, audio, transcripts) and listen/bin/. git log --all shows no listen/data path. The data folder doesn't exist yet.
- check.js: app working files OK (108 text files); --git OK (304 blobs).
- Keys: keys.js keeps only the SHA-256 of each phone key. tools/listen-add-key.js prints the new key once, with a note that the Admin runs it in their own terminal, never a chat.
- Logs: every log line holds ids, counts, status codes, methods and paths cut to 40 characters, and fixed messages. Error messages are fixed texts or HTTP statuses. The sorter's JSON.parse of the model answer is caught, so no parse error quoting model text is logged. Whisper's output is kept in memory (the last 8000 characters) and never logged. PASS.
- Retention: deleteAfterDays is null (off; Keep marks exist). deleteAudioAfterTranscript is a setting and is TRUE, set from "the Admin's answer, 2026-10-20: yes" (bc681f7), not OFF as the recheck brief said. Security · Lead to confirm the answer with the Admin.
- Finding (low, personal data): listen/settings.json is tracked and pushed (private repo) with "adminLogin" set to the Admin's real email, for the Tailscale login check. Fix for the AI workspace manager: read it from an ignored local file or the user environment, then keep it out of the file in git (it stays in history; the repo is private).
- Backup scope: BACKUP-1 (not built) plans a nightly copy of C:\server to the main PC, which would include listen/data (recordings and transcripts). The Admin decides whether it's included; if it is, it must be encrypted at rest on the main PC.

## 2026-10-21, SEC-AG-16b/20/20b live run (GO from Security · Lead; 2.8 GB free)
- Ran on a throwaway clone of oak-world-work (HEAD c343f97; control-tracker.mjs at 658e7ba), deleted afterwards: node --test test/work-sec-ag-16b.test.js test/work-sec-ag-20b.test.js gave 6 of 6 pass. 16b: live secret refused, name only; 16b: fails closed without check.js; 20: key shapes and disguised values; 20b: short value split or reversed, mid value over 3-4 cells, 240-cell cap. Fake values and the test's own dummy only. PASS.

## 2026-10-22, SEC-SECRETS-11b: the new irl-stream GitHub repo (GO from Security · Lead; 2.3 GB free)
- A fresh mirror clone from GitHub went into scratch, with hooks off and the push URL disabled. One ref: main at 4b9a7e6, 2 commits (dde9c2f, 4b9a7e6). The clone was deleted afterwards.
- check.js --git: OK (83 blobs, 34 live values, so the IRL values are known).
- No path under private*, data*, logs, recordings*, factory, .claude or node_modules, and no *.env, *.key, *.pem or *.bak, in any commit (76 distinct paths). dde9c2f never tracked anything under factory/ (no factory or board.json path in either commit), so 4b9a7e6's ignore rule hides nothing in the history.
- Private: the anonymous GitHub API answers 404. gh isn't signed in, so visibility wasn't read through gh.
- .gitignore covers private*/, data*/, logs/, recordings*/, .claude/, node_modules/, *.log, *.tmp, *.bak, *.env, .apikey, *secret*, *password*.txt, *.key, *.pem and factory/. All 14 secret files on disk are in private*\ and are ignored. The working folder has nothing untracked outside the ignored folders.
- Suggestion (low, a second lock): add the secret file names themselves (keys.json, sessions.json, obsremote.json, twitch-app.json, streamkeys.json, stream-urls.txt, obs-websocket.txt, obs-remote-address.txt, mediamtx.json, dashboard-password.txt), so a copy outside private* is ignored too. `*password*.txt` doesn't cover a .json.

## 2026-11-06, two more old oak-config copies (JOB from Server via Security · Lead; 1.15 GB free)
- (1) Recycle Bin: $I5QUGT4 points to C:\server\oak-world\jobs\Network-OR70-09300332 (the whole folder was deleted). Its $R5QUGT4\oak-config.json was scanned in place with check.js (nothing restored or moved): OK, no live value (40 live values known). This matches round 2: that job config never held keys.
- (2) C:\server\oak-world\archive\snapshot-2026-09-28\oak-world(-audio_tts).zip holds two config files. Only those two entries were extracted to my scratchpad; the copies were scanned with check.js, then deleted.
  - oak-world/backups/oak-config.before-2026-09-27-fix.json: live labCode, geminiApiKeys[0-3].
  - oak-world/oak-config.json: live labCode, extraProvidersOff[0].apiKey, plus an openai/anthropic-shaped key.
  - LIVE keys: yes. The zip is in no git repo, and every local account can read it (Users RX, Authenticated Users M, inherited from C:\server). Medium, the same as W-4. Admin steps: delete the zip (or the two entries), or rotate per FIX-8's README; deleting is the Admin's.
