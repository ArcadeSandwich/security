# SEC-SECRETS-10: check.js learns the IRL stream's secret values

- **Finding:** SEC-SECRETS-10, medium, found by Security · Secrets on 2026-10-20. check.js knows the game's live values (oak-config.json, access.json, two environment keys). It does not know the secrets in `C:\irl-stream\private*\`. So a leak of those into a log, a note or the coming irl-stream repo would not be caught.
- **Owner of the file:** Server (the Playbook's `tools\check.js`). **Owner of the values:** IRLToolkit. **IRLToolkit's yes is needed before it is applied.** Server's decision (2026-10-20): arcade-server's .env is NOT loaded, because MustaHub is outside the network and we don't load another project's secret values, even in memory.
- **IRLToolkit said yes (2026-10-21).** Part 2, the folder permissions, is in `ACL.md`.
- **The patch** (`fix.diff`, made against tools\check.js at Playbook commit 32b1605, still the current one on 2026-10-21) adds `EXTRA_SECRET_SOURCES` and `loadExtraSecrets()`, which loads, in memory only:
  - every file in each `C:\irl-stream\private*\` folder: every string in a .json file; from any other file, only key-like words (letters AND digits, or 20+ characters mixing capitals and small letters; a URL gives its decoded path pieces and query values, where stream keys sit; never a plain or capitalised word, a host name or a file path), because those folders also hold notes such as MUSTA-SETUP.txt;
  - only whole values of 8 or more characters. Numbers, true, false, null, plain lowercase words (a user name), addresses and ports (127.0.0.1:4455), labels ending in ":", and plain addresses (no user, password or query, at most one path segment, e.g. `rtmp://127.0.0.1:1935/live`) are skipped, to avoid false hits in code. Stream URLs with a key in the path are kept.

  The values join the live list, and the summary's "N live values" grows by their count. Hits print as `live secret: irl private-musta keys.json: <key path>`: names only, never a value. An unreadable or unparsable file gives a warning naming only the file. A missing folder (another PC) is skipped quietly.
- **Not changed:** the fixed patterns, the scan, `--git`, and the output format.

Status: draft

## Apply (Server)
1. In C:\server\playbook: `git apply C:\server\security\patches\SEC-SECRETS-10\fix.diff`. Verified on 2026-10-20 with `git apply --check` on a scratch copy.
2. Copy `test\check-extra-secrets.test.js` to `C:\server\playbook\test\`, then commit both files by path.

## Check it worked
- `node --test test/check-extra-secrets.test.js` must give 2 pass. It uses fake fixture files only. Values in JSON, a password file, a "Password: value" line and a stream key in a URL path are loaded. A user name, an address, a port, a boolean, a short string, a heading, a label, a notes file of prose, a public folder and a .env outside private* are not. No name holds a value, a broken JSON file gives one note, and a missing folder gives nothing. Ran 2/2 on a patched scratch copy, with `CHECK_JS` set to that copy.
- `node --test test/check-git.test.js` still gives 3 pass (ran on the same patched copy).
- `node tools\check.js` prints a higher "live values" count than before (17 on 2026-10-20) and still `check: OK` on the Playbook. If a hit appears, it is a real leak or a false hit: name the key path to Security · Secrets, never the value.
- **First real run (2026-10-21, after IRLToolkit's yes).** The first version flagged ordinary words, 289 then 364 false hits: a user name, an address line, headings, and the MUSTA-SETUP.txt notes. The rules above fix that. Now 17 IRL values are loaded (34 live values in all, 17 before), with values from every secret file that has one: dashboard-password, keys, mediamtx, multistream, obs-websocket, obsremote, stream-urls and twitch-app in private\, and the same plus obs-remote-address and MUSTA-SETUP in private-musta\. No secret-named JSON field is left out (checked by name). With the patch: IRL working files OK (69), the Playbook including this test OK, C:\server\security OK (126), and the game's docs OK (54).

## Undo
`git revert` the commit, or `git apply -R fix.diff`.

## Needs a login or permission
None. IRLToolkit's yes for the IRL part.
