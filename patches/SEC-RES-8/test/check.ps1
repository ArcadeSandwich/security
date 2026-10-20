# SEC-RES-8 check, read-only: after SMP Main's next backup, a new world zip is on the main PC as well as on D:.
# Run on cadeyserver. It reads file names, sizes and dates only.
$cfg = "$env:USERPROFILE\Desktop\Arcade SMP\plugins\DriveBackupV2\config.yml"
$t = Get-Content $cfg
"sftp target enabled: " + [bool]($t -match '^\s{2}sftp: true')
"keep-count: " + (($t | ? { $_ -match '^keep-count:' }) -replace 'keep-count:\s*', '')
$d = Get-ChildItem 'D:\SERVER BACKUPS\backups\world' -File | sort LastWriteTime -Desc | select -First 1
"newest on D:: $($d.Name) $($d.LastWriteTime)"
"Now on the main PC: the same file name must be in the backup user's 'backups' folder with the same size ($($d.Length) bytes)."
"Plugin log: Desktop\Arcade SMP\logs\latest.log should show the FTP/SFTP upload finished with no error."
