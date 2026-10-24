# Run one of the headless scripts in the isolated window station (never on
# the interactive desktop). Launch hidden for long runs:
#   Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-File','scripts\run-isolated.ps1','online-e2e','D:\agent-work\ringer3d\<date>-online'
param(
  [Parameter(Mandatory = $true)][string]$Script,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [string]$Extra = '',
  [int]$CpuPercent = 80
)
$repo = Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Force $OutDir | Out-Null
$node = (Get-Command node).Source
& 'D:\gha-runners\headless-tools\Start-IsolatedProcess.ps1' -FilePath $node -ArgumentString "`"scripts/$Script.mjs`" `"$OutDir`" $Extra" -WorkingDirectory $repo -CpuPercent $CpuPercent *> (Join-Path $OutDir 'runner.log')
"exit $LASTEXITCODE" | Out-File -Append (Join-Path $OutDir 'runner.log')
