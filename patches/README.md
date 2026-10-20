# Prepared patches for owners who are offline (C:\server\security\patches)

The Admin, 2026-10-20: "patch as much of it as possible and leaving only logins and permissions for later". When the chat that owns a file is offline (IRLToolkit, DM, Audio, SMP Main, the Main PC chats) or outside the network (MustaHub), the security team prepares the fix here instead of letting it wait. **Nothing here is ever applied to the owner's files by a security chat.** The owner applies it when it returns (minutes); for MustaHub the Admin hands the folder over.

## One folder per tracker ID: `patches\<SEC-ID>\`
- `README.md`: the finding (tracker ID, rank), what the patch changes and why, the exact steps to apply it (which repo, which command), how to check it worked, how to undo it, and anything that needs a login or a permission (those wait for the Admin).
- `fix.diff`: a unified diff made against the owner's current files (`git diff` format, paths relative to the owner's repository root). Name the commit or file date it was made against; if the owner's file has changed since, the owner re-checks before applying.
- `test\`: the test that proves it (a test file for the owner's own test runner, or exact commands). Tests run on a scratch copy only.
- Config changes (docker-compose, plugin configs) are diffs too, never a whole replaced file with secrets in it.

## Rules
- Diffs and READMEs hold no key, password, token or code; `node C:\server\playbook\tools\check.js C:\server\security\patches` must pass.
- Make the diff from a scratch copy of the owner's files; never edit the owner's folder.
- Security (the lead) reviews each patch before it is marked `Status: ready-for-owner` in its README.
- Anything that needs administrator rights is not a patch: it becomes a fix pack under `fixes\` and the console rules.
