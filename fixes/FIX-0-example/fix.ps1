# FIX-0-example: changes nothing; only prints which mode ran (the console logs it).
param([switch]$DryRun, [switch]$Apply, [switch]$Undo)
if ($DryRun) { 'DryRun: would write one example line to the log'; exit 0 }
if ($Apply) { 'Apply: example line written'; exit 0 }
if ($Undo) { 'Undo: nothing to undo'; exit 0 }
'Use -DryRun, -Apply or -Undo'; exit 1
