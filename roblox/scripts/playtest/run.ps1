# One playtest pass: mark the place, install the rig plugin, run Studio in the private station,
# then read the [playrig] lines from the Studio log and take the plugin back out.
param([int]$Wait = 900)
$o = 'D:\agent-work\ringer3d\2026-10-31-roblox\playtest'
$place = 'D:\agent-work\ringer3d\play-store\roblox\build\ringer.rbxlx'
$marked = Join-Path $o 'playtest.rbxlx'
node (Join-Path $o 'mark.cjs') $place $marked
$plugins = Join-Path $env:LOCALAPPDATA 'Roblox\Plugins'
New-Item -ItemType Directory -Force $plugins | Out-Null
Copy-Item (Join-Path $o 'RingerPlayRig.lua') (Join-Path $plugins 'RingerPlayRig.lua') -Force
$start = Get-Date
& 'D:\gha-runners\headless-tools\Start-IsolatedProcess.ps1' -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentString "-NoProfile -ExecutionPolicy Bypass -File D:\agent-work\ringer3d\2026-10-28-studio-shots\probe.ps1 -Place $marked -Out $o -Wait $Wait -Shots 0 -Resize" -WorkingDirectory $o -CpuPercent 80
Remove-Item (Join-Path $plugins 'RingerPlayRig.lua') -Force -ErrorAction SilentlyContinue
$f = Get-ChildItem "$env:LOCALAPPDATA\Roblox\logs\*Studio*.log" | Where-Object { $_.LastWriteTime -gt $start -and (Select-String -Path $_.FullName -Pattern '\[playrig\]' -Quiet) } | Select-Object -First 1
if (-not $f) { 'no playrig log found'; exit 1 }
$lines = Select-String -Path $f.FullName -Pattern '\[playrig\]' | ForEach-Object { $_.Line -replace '^.*\[playrig\]', '' }
$lines | Out-File (Join-Path $o 'result.txt') -Encoding utf8
$errs = Select-String -Path $f.FullName -Pattern 'Error|error:' | Select-Object -First 15 | ForEach-Object { $_.Line }
$errs | Out-File (Join-Path $o 'errors.txt') -Encoding utf8
$caps = @(Get-ChildItem "$env:LOCALAPPDATA\Roblox\tmp-capture-storage" -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -gt $start } | Sort-Object LastWriteTime)
$i = 0; foreach ($c in $caps) { Copy-Item $c.FullName (Join-Path $o ("cap-{0:d2}.png" -f $i)); $i++ }
$lines
