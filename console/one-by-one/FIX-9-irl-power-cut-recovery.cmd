@echo off
rem SEC-INFRA-8: one fix pack, FIX-9-irl-power-cut-recovery, in its own window (the Admin's choice, 2026-10-21). The same checks as "Security fixes.cmd".
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\console.ps1" -Only FIX-9-irl-power-cut-recovery
echo.
pause
