# One capture pass: isolated Studio runs the rig plugin, then copy the new captures out with their labels.
param([string]$Name, [int]$Wait = 330)
$o = 'D:\agent-work\ringer3d\2026-10-28-studio-shots'
$out = Join-Path $o $Name
New-Item -ItemType Directory -Force $out | Out-Null
$start = Get-Date
& 'D:\gha-runners\headless-tools\Start-IsolatedProcess.ps1' -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentString "-NoProfile -ExecutionPolicy Bypass -File $o\probe.ps1 -Place $o\shots.rbxlx -Out $o -Wait $Wait -Shots 0 -Resize" -WorkingDirectory $o -CpuPercent 80
$f = Get-ChildItem "$env:LOCALAPPDATA\Roblox\logs\*Studio*.log" | Where-Object { $_.LastWriteTime -gt $start -and (Select-String -Path $_.FullName -Pattern 'shotrig\] viewport' -Quiet) } | Select-Object -First 1
$labels = @(Select-String -Path $f.FullName -Pattern '\[shotrig\] capture (\S+)' | ForEach-Object { $_.Matches[0].Groups[1].Value })
$files = @(Get-ChildItem "$env:LOCALAPPDATA\Roblox\tmp-capture-storage" | Where-Object { $_.LastWriteTime -gt $start } | Sort-Object LastWriteTime)
"labels $($labels.Count) files $($files.Count)"
for ($i = 0; $i -lt [Math]::Min($labels.Count, $files.Count); $i++) { Copy-Item $files[$i].FullName (Join-Path $out ("{0:d2}-{1}.png" -f $i, $labels[$i])) }
Select-String -Path $f.FullName -Pattern '\[shotrig\] (viewport|table|run end|done)' | ForEach-Object { $_.Line -replace '^.*\[shotrig\]', '' }
