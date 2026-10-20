# SEC-RES-11 check, read-only. Run in C:\irl-stream after the steps.
Set-Location C:\irl-stream
"git: " + (Test-Path .git)
"remote: " + ((git remote -v | select -First 1) -replace '//[^@/]+@', '//')
"unpushed: " + (git rev-list --count '@{u}..HEAD' 2>$null)
"private folders tracked (must be 0): " + ((git ls-files private private-musta data data-musta recordings-musta logs .claude) | measure).Count
"secret scan: run node C:\server\playbook\tools\check.js C:\irl-stream (must print check: OK)"
