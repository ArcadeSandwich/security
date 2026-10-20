# SEC-SECRETS-10: check.js learns the IRL stream's and arcade-server's secret values

- **Finding:** SEC-SECRETS-10, medium, found by Security · Secrets on 2026-10-20. check.js knows the game's live values (oak-config.json, access.json, two environment keys). It does not know the secrets in `C:\irl-stream\private*\` or `Desktop\arcade-server\.env`. So a leak of those into a log, a note or the coming irl-stream repo would not be caught.
- **Owner of the file:** Server (the Playbook's `tools\check.js`). **Owner of the values:** IRLToolkit (the IRL part) and arcade-server. **IRLToolkit's yes is needed before the IRL part is applied.** To apply only the arcade-server part, delete the `irl` line from `EXTRA_SECRET_SOURCES`.
- **The patch** (`fix.diff`, made against tools\check.js at Playbook commit 32b1605, 2026-10-20) adds `EXTRA_SECRET_SOURCES` and `loadExtraSecrets()`, which loads, in memory only:
  - every file in each `C:\irl-stream\private*\` folder: every string in a .json file, every line of any other file;
  - every `KEY=value` in arcade-server's `.env`;
  - only whole values of 8 or more characters. Numbers, true, false, null and plain addresses (no user, password or query, at most one path segment, e.g. `rtmp://127.0.0.1:1935/live`) are skipped, to avoid false hits in code. Stream URLs with a key in the path are kept.

  The values join the live list, and the summary's "N live values" grows by their count. Hits print as `live secret: irl private-musta keys.json: <key path>` or `arcade-server .env: <KEY>`: names only, never a value. An unreadable or unparsable file gives a warning naming only the file. A missing folder (another PC) is skipped quietly.
- **Not changed:** the fixed patterns, the scan, `--git`, and the output format.

Status: draft

## Apply (Server)
1. In C:\server\playbook: `git apply C:\server\security\patches\SEC-SECRETS-10\fix.diff`. Verified on 2026-10-20 with `git apply --check` on a scratch copy.
2. Copy `test\check-extra-secrets.test.js` to `C:\server\playbook\test\`, then commit both files by path.

## Check it worked
- `node --test test/check-extra-secrets.test.js` must give 2 pass. It uses fake fixture files only: values in private\ and private-musta\ are loaded, the .env values are loaded, and ports, booleans, short strings, plain URLs, comments and a public folder are not. No name holds a value, a broken JSON file gives one note, and a missing folder gives nothing. Ran 2/2 on a patched scratch copy, with `CHECK_JS` set to that copy.
- `node --test test/check-git.test.js` still gives 3 pass (ran on the same patched copy).
- `node tools\check.js` prints a higher "live values" count than before (17 on 2026-10-20) and still `check: OK` on the Playbook. If a hit appears, it is a real leak or a false hit: name the key path to Security · Secrets, never the value.
- Not done by Security · Secrets: running the patched check.js against the real IRL files, which waits for IRLToolkit's yes.

## Undo
`git revert` the commit, or `git apply -R fix.diff`.

## Needs a login or permission
None. IRLToolkit's yes for the IRL part.
