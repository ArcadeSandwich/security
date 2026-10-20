# Probe (SEC-INFRA-2, SEC-INFRA-3)

- `probe.ps1`: the normal level, read-only, no admin rights. Any security chat may run it.
- `probe.ps1 -Deep`: the deep level. Only the Admin starts it, in an elevated window; it refuses without admin rights.
- It takes no other arguments and runs no command it is handed.
- It writes `..\reports\<yyyy-mm-dd>\probe-<level>-<time>.json` and `.txt`.
- It never reads service command lines, task arguments or environment values (names and lengths only). Every string passes `Remove-Secrets`.
- Check each report folder with `node C:\server\playbook\tools\check.js <folder>`.
- Hooks: `parts\disk.ps1` and `parts\recovery.ps1` (Security · Resilience), loaded by these fixed names only.
- **Reports never leave this PC.** They hold the network map: internal addresses (the stream VM's included), ports, firewall rules and account names. They stay in `reports\` (not in git). Never paste them into a chat outside the security team, a GitHub issue or the Playbook. Quote only the lines a finding needs.
