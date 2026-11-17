# One play-mode check: mark the live build, install the rig, run Studio in the private station,
# then copy the captures out under their labels and print the [playmode] lines.
param([string]$Name = 'run1', [int]$Wait = 150)
$o = 'D:\agent-work\ringer3d\playmode' # outputs (bulky)
$rig = $PSScriptRoot # plugin + hook sources
New-Item -ItemType Directory -Force $o | Out-Null
$out = Join-Path $o $Name
New-Item -ItemType Directory -Force $out | Out-Null
$src = 'D:\agent-work\ringer3d\play-store\roblox\build\ringer.rbxlx'
$place = Join-Path $o 'playmode.rbxlx'
$s = [IO.File]::ReadAllText($src)
$re = '(<Item class="ReplicatedStorage" referent="[^"]+"><Properties><string name="Name">ReplicatedStorage</string></Properties>)'
if ($s -notmatch $re) { 'ReplicatedStorage not found'; exit 1 }
$s = [regex]::Replace($s, $re, '$1<Item class="Folder" referent="RBXPLAYMODE"><Properties><string name="Name">PlayMode</string></Properties></Item>', 1)
# The server half: a real Script in ServerScriptService (it shares the game's modules).
$hook = [IO.File]::ReadAllText((Join-Path $rig 'hook.server.lua'))
$sss = '(?s)(<Item class="ServerScriptService" referent="[^"]+">\s*<Properties>.*?</Properties>)'
if ($s -notmatch $sss) { 'ServerScriptService not found'; exit 1 }
$item = '<Item class="Script" referent="RBXPMHOOK"><Properties><string name="Name">PlayModeHook</string><ProtectedString name="Source"><![CDATA[' + $hook + ']]></ProtectedString></Properties></Item>'
$s = [regex]::Replace($s, $sss, { param($m) $m.Groups[1].Value + $item }, 1)
[IO.File]::WriteAllText($place, $s, (New-Object Text.UTF8Encoding $false))
$plugins = Join-Path $env:LOCALAPPDATA 'Roblox\Plugins'
Copy-Item (Join-Path $rig 'RingerPlayMode.lua') (Join-Path $plugins 'RingerPlayMode.lua') -Force
$start = Get-Date
& 'D:\gha-runners\headless-tools\Start-IsolatedProcess.ps1' -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentString "-NoProfile -ExecutionPolicy Bypass -File D:\agent-work\ringer3d\2026-10-28-studio-shots\probe.ps1 -Place $place -Out $out -Wait $Wait -Shots 0 -Resize" -WorkingDirectory $o -CpuPercent 80
Remove-Item (Join-Path $plugins 'RingerPlayMode.lua') -Force -ErrorAction SilentlyContinue
$logs = @(Get-ChildItem "$env:LOCALAPPDATA\Roblox\logs\*.log" | Where-Object { $_.LastWriteTime -gt $start -and (Select-String -Path $_.FullName -Pattern '\[playmode\]' -Quiet) })
"logs with playmode lines: $($logs.Count)"
$lines = $logs | ForEach-Object { Select-String -Path $_.FullName -Pattern '\[playmode\]' } | ForEach-Object { $_.Line -replace '^.*\[playmode\]', '' }
$lines
$labels = @($lines | Where-Object { $_ -match '^ capture (\S+)' } | ForEach-Object { ($_ -split ' ')[2] })
$files = @(Get-ChildItem "$env:LOCALAPPDATA\Roblox\tmp-capture-storage" -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -gt $start } | Sort-Object LastWriteTime)
"labels $($labels.Count) files $($files.Count)"
for ($i = 0; $i -lt $files.Count; $i++) { $l = if ($i -lt $labels.Count) { $labels[$i] } else { "extra$i" }; Copy-Item $files[$i].FullName (Join-Path $out ("{0:d2}-{1}.png" -f $i, $l)) }
$logs | ForEach-Object { Select-String -Path $_.FullName -Pattern 'Error|error' | Where-Object { $_.Line -notmatch 'Redundant Flag|Mimalloc|FLog::Error\] Redundant' } | Select-Object -First 12 | ForEach-Object { 'ERR ' + $_.Line.Substring(0, [Math]::Min(220, $_.Line.Length)) } }
