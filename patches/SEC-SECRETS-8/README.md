# SEC-SECRETS-8: the IRL stream's .gitignore misses private-musta\ (high)

- **Finding:** SEC-SECRETS-8, rank **high**, owner IRLToolkit. Found by Security · Secrets, 2026-10-20.
- **What is wrong:** `C:\irl-stream\.gitignore` has one line, `private/`. That covers the `private\` folder only. `private-musta\` holds MustaHub's dashboard-password.txt, keys.json, mediamtx.json, obs-websocket.txt and sessions.json, and nothing ignores it. The first `git add` of the planned irl-stream repository would commit all five, and the first push would publish them.
- **Nothing has leaked yet:** C:\irl-stream has no .git folder.
- **The patch:** `private/` becomes `private*/`, which covers `private\`, `private-musta\` and any later `private-<name>\` folder. `fix.diff` was made against C:\irl-stream\.gitignore as of 2026-10-20 (10 bytes, one line).

**Apply BEFORE any `git init` or `git add` in C:\irl-stream.**

Status: draft

## Apply (IRLToolkit)
1. In C:\irl-stream: `git apply --unsafe-paths --directory=. C:\server\security\patches\SEC-SECRETS-8\fix.diff`. Or, since there is no repo yet, edit `.gitignore` by hand: change the line `private/` to `private*/`.
2. If the file is no longer the one-line version, re-check by hand that every `private*` folder is covered.

## Check it worked
- Before git init: `powershell -NoProfile -File C:\server\security\patches\SEC-SECRETS-8\test\check-ignore.ps1` must print `check: OK`. The test copies only .gitignore into a temp folder, makes empty files with the same names as the private files (names only), and asks git check-ignore about each one. It then deletes the temp folder.
- Tested 2026-10-20 on scratch copies: the current file gives `check: FAILED (6)` (5 private-musta files not ignored, and `git add -A` would stage them); the patched file gives `check: OK` (all 14 private files ignored).
- After git init: `git ls-files | Select-String private` must print nothing.
- Before the first push: `node C:\server\playbook\tools\check.js --git C:\irl-stream`. Note that check.js only recognises these values once SEC-SECRETS-10 is in.

## Undo
Change `private*/` back to `private/`. Don't do that once a repo exists.

## Needs a login or permission
None.
