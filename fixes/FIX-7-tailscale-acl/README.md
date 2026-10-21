# SEC-FIX-7: Tailscale access rule (ACL) for people shared in

Status: draft

- **Finding:** W-7. People outside the Admin's account will get cadeyserver shared to them for the Prompt generator (port 7420). Without an access rule, a shared person reaches every port that Tailscale-In allows (W-9).
- **What it does:** a policy that lets the Admin's own devices reach everything, as today, and lets people shared in reach only `cadeyserver` on TCP 7420.
- **This pack has no script.** The Tailscale admin console is the Admin's (CLAUDE.md), so these are click steps and text to paste.
- **Risk:** low if pasted as one whole policy. Tailscale checks the policy before saving it, and a broken policy is refused, not half-applied.

## Steps for the Admin
1. Open https://login.tailscale.com/admin/acls/file and sign in.
2. Copy the current policy into a text file on the PC as a backup (the undo).
3. Replace the whole policy with the text below. If the current policy has `tagOwners`, `ssh` or `nodeAttrs` blocks, keep those blocks and replace only `acls`.
4. Before you save, open the "Preview rules" tab and check two things. Your own user must show `*:*`. `autogroup:shared` must show only `cadeyserver:7420`.
5. Click Save.
6. Check: from a shared person's device, the Prompt generator works and Remote Desktop (3389) does not. Or ask Security · Network to rerun NET-P4.

```json
{
  "acls": [
    // The Admin's own devices: everything, as before.
    { "action": "accept", "src": ["autogroup:member"], "dst": ["*:*"] },
    // People cadeyserver is shared with: the Prompt generator only.
    { "action": "accept", "src": ["autogroup:shared"], "dst": ["cadeyserver:7420"] }
  ],
  "hosts": {}
}
```

Notes:
- `cadeyserver` in `dst` is the machine's name on the tailnet (MagicDNS). If the admin console calls it something else, use that name, or the address `100.107.176.17`.
- **Tests, once someone is shared in:** a "tests" entry can't use `autogroup:shared` as its source. Tailscale's tests take a specific user, group, tag or host. So add one test per shared person, using that person's Tailscale login (their email), in a `"tests": [ ... ]` block after `"hosts"`:
  `{ "src": "<their login>", "accept": ["cadeyserver:7420"], "deny": ["cadeyserver:443", "cadeyserver:3389", "cadeyserver:445", "cadeyserver:11434", "mika-pc:11434"] }`
  Tailscale then refuses to save the policy if that person could reach LISTEN (443, through `tailscale serve`), Remote Desktop, file sharing, or Ollama on either PC. Until anyone is shared in, no test is needed. The "Preview rules" check in step 4 does the same job by eye.
- **Apply FIX-7 before turning on `tailscale serve` for LISTEN (LISTEN-2), if anyone is shared in by then.** Serve publishes https on port 443 to every device the policy allows.
- Undo: paste the backup from step 2 and save.

Source: Tailscale, "Manage permissions using ACLs" (https://tailscale.com/kb/1018/acls) and "Sharing your nodes" (https://tailscale.com/kb/1084/sharing): shared users appear as `autogroup:shared`.
