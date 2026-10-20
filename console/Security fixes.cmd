@echo off
rem SEC-INFRA-5: the one launcher the Admin runs by hand (double-click). It lists the ready fix packs, shows each one,
rem runs its dry run, asks yes or no, then applies the yes ones in ONE elevated window (one Windows prompt).
rem It takes no arguments and starts nothing that keeps running.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0console.ps1"
echo.
pause
