# One page-art pass: mark the live build, install the rig, run Studio in the private station,
# then copy the new captures out under their labels and take the plugin back out.
param([string]$Name = 'pass1', [int]$Wait = 420, [string]$Rig = 'RingerKeyArt.lua')
$o = 'D:\agent-work\ringer3d\2026-11-17-keyart'
$out = Join-Path $o $Name
New-Item -ItemType Directory -Force $out | Out-Null
$src = 'D:\agent-work\ringer3d\play-store\roblox\build\ringer.rbxlx'
$place = Join-Path $o 'shots.rbxlx'
node 'D:\agent-work\ringer3d\2026-11-16-page-shots\mark.cjs' $src $place
if ($LASTEXITCODE -ne 0) { exit 1 }
$plugins = Join-Path $env:LOCALAPPDATA 'Roblox\Plugins'
New-Item -ItemType Directory -Force $plugins | Out-Null
Copy-Item (Join-Path $o $Rig) (Join-Path $plugins 'RingerPageShots.lua') -Force
$start = Get-Date
& 'D:\gha-runners\headless-tools\Start-IsolatedProcess.ps1' -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentString "-NoProfile -ExecutionPolicy Bypass -File D:\agent-work\ringer3d\2026-10-28-studio-shots\probe.ps1 -Place $place -Out $out -Wait $Wait -Shots 0 -Resize" -WorkingDirectory $o -CpuPercent 80
Remove-Item (Join-Path $plugins 'RingerPageShots.lua') -Force -ErrorAction SilentlyContinue
$f = Get-ChildItem "$env:LOCALAPPDATA\Roblox\logs\*Studio*.log" | Where-Object { $_.LastWriteTime -gt $start -and (Select-String -Path $_.FullName -Pattern 'keyart\] viewport' -Quiet) } | Select-Object -First 1
if (-not $f) { 'no pageshots log found'; exit 1 }
$labels = @(Select-String -Path $f.FullName -Pattern '\[keyart\] capture (?!timeout )(\S+)' | ForEach-Object { $_.Matches[0].Groups[1].Value })
$files = @(Get-ChildItem "$env:LOCALAPPDATA\Roblox\tmp-capture-storage" | Where-Object { $_.LastWriteTime -gt $start } | Sort-Object LastWriteTime)
"labels $($labels.Count) files $($files.Count)"
for ($i = 0; $i -lt [Math]::Min($labels.Count, $files.Count); $i++) { Copy-Item $files[$i].FullName (Join-Path $out ("{0:d2}-{1}.png" -f $i, $labels[$i])) }
Select-String -Path $f.FullName -Pattern '\[keyart\] (viewport|section|table|race ticks|done|pose|capture timeout)' | ForEach-Object { $_.Line -replace '^.*\[keyart\]', '' }
Select-String -Path $f.FullName -Pattern 'RingerPageShots' | Select-Object -First 8 | ForEach-Object { $_.Line }
