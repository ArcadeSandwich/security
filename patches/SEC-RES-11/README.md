# SEC-RES-11 Put the IRL stream under git with a private GitHub copy

Status: draft (for Security's review, then ready-for-owner)
Finding: SEC-RES-11, **medium**. C:\irl-stream has no git at all, although C:\server\CLAUDE.md says it goes on GitHub as irl-stream. The code (dashboard, tools, vm, docs, the start .bat files: about 1 MB) exists in one copy only, on C:.
Owner: IRLToolkit (offline). Made against the folder as it was on 2026-10-20; the .gitignore holds only `private/`.
**Do this only after SEC-SECRETS-8 is done**, so no key is ever in the first commit.

## What it changes
- A local git repository in C:\irl-stream.
- A wider .gitignore (gitignore.diff): the private and data folders, recordings, logs, .claude and node_modules stay out of git.
  - private/ and private-musta/ hold settings and stream keys;
  - data/ and data-musta/ hold state;
  - recordings and logs are large or personal.
- A private GitHub repo, ArcadeSandwich/irl-stream (code only, as CLAUDE.md says).

## Steps
IRLToolkit runs these in C:\irl-stream; the steps marked "Admin" are the Admin's.
1. Check that SEC-SECRETS-8 is marked done on C:\server\SECURITY-TRACKER.md.
2. Apply gitignore.diff to .gitignore (8 added lines).
3. Run `node C:\server\playbook\tools\check.js C:\irl-stream`. It must print `check: OK` for every file that will be committed. If it finds anything, stop and tell Security.
4. `git init -b main`
5. `git config user.name ArcadeSandwich` and `git config user.email 26695111+ArcadeSandwich@users.noreply.github.com`. Never the Admin's real email.
6. `git add .gitignore CLAUDE.md start-stream.bat start-musta.bat start-musta-obs.bat dashboard docs tools vm`: by path only, never `git add -A` (INS-004).
7. `git status`, then check that nothing from private*, data*, recordings*, logs or .claude is staged.
8. `git commit -m "IRL stream: first commit (code only)"`
9. **Admin:** on github.com, create a **private**, empty repository ArcadeSandwich/irl-stream (this is a login step).
10. `git remote add origin https://github.com/ArcadeSandwich/irl-stream.git`, then `git push -u origin main`. If git asks for a GitHub sign-in, that is the Admin's step.

## Check it worked
Run `powershell -File test\check.ps1`. You should see: git True, the remote set, 0 unpushed commits, 0 private files tracked, and check.js OK. On github.com the repository must show "Private".

## Undo
The local git can be left in place, since it changes no file. To undo fully, the Admin deletes the GitHub repo, and IRLToolkit removes the .git folder by hand. Never with a recursive delete run from a chat; deleting is the Admin's job.

## Backups
Git covers the code. private/ and data/ (settings and state, a few KB) still exist only on C:, and BACKUP-1's copy of C:\irl-stream covers them. Ask Network to include C:\irl-stream, which is outside C:\server.
