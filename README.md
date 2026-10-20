# Security tools (C:\server\security)

The security team's tools for this PC (the Admin, 2026-10-20: "plug and play when I'm ready to fix permissions"). Kept by Security (the lead); the tracker is `C:\server\SECURITY-TRACKER.md` (SEC-INFRA and SEC-FIX rows).

## Rules
- Security chats may write code here, and only here.
- Nothing here installs itself, starts with Windows, or keeps elevated access. Everything elevated runs only when the Admin starts it, each time.
- No script takes free arguments or runs a command it is handed.
- Reports never hold a key, password, token or code; every report must pass `node C:\server\playbook\tools\check.js <report folder>`.
- A script that runs elevated is reviewed by Security, then Server, before its pack is marked ready.
- Commit by path only (Playbook INS-004).

## Layout
- `probe\` read-only audit. `probe.ps1` (normal level, any security chat may run it) and the deep level the Admin starts elevated. Writes `reports\<yyyy-mm-dd>\` as text and JSON.
- `fixes\FIX-<n>-<short-name>\` one folder per fix:
  - `README.md`: what, why, finding ID (tracker), risk, which Windows permission it needs, and `Status: draft | reviewed-security | ready` (ready only after Server's review);
  - `fix.ps1` with `-DryRun`, `-Apply` and `-Undo` (no other parameters);
  - `check.ps1`: proves it worked; read-only.
- `fixes\APPROVED.sha256`: the fingerprints of every file allowed to run elevated. **Only Server writes it, after its review**; the console refuses anything not listed with a matching hash (console\README.md).
  Cloudflare and Tailscale items are packs with exact click steps or ready-to-paste policy text, and no scripts.
- `console\Security fixes.cmd` the one launcher the Admin runs by hand: lists ready packs, shows each README, runs the dry run, asks yes or no for each, applies the yes ones in one elevated session (one Windows prompt), runs check.ps1, logs the results; can start the deep probe in the same session; never runs a pack that is not ready; leaves nothing running.
- `reports\` probe output and console logs (not in git).
- `PRESENTATION.md` plain-English summary for the Admin, kept current.
