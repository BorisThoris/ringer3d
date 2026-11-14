param([Parameter(Mandatory = $true)][string]$OutDir, [string[]]$Scenes = @())
# Runs render.mjs in a private, non-interactive window station (never on the desktop), and waits.
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$node = (Get-Command node).Source
$log = Join-Path $OutDir 'render.log'
$cmd = "/d /c `"`"$node`" `"$repo\roblox\scripts\preview\render.mjs`" `"$OutDir`" $($Scenes -join ' ') > `"$log`" 2>&1`""
& 'D:\gha-runners\headless-tools\Start-IsolatedProcess.ps1' -FilePath $env:ComSpec -ArgumentString $cmd -WorkingDirectory $repo -CpuPercent 50
Get-Content $log
