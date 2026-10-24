# Cut a square app icon out of a marble close-up and write every size the
# web manifest and the Android launcher need.
#   powershell -File scripts/make-icons.ps1 <source.png> [centerX] [centerY] [radius]
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [int]$CenterX = -1,
  [int]$CenterY = -1,
  [int]$Radius = -1
)
Add-Type -AssemblyName System.Drawing
$repo = Split-Path -Parent $PSScriptRoot
$src = [System.Drawing.Image]::FromFile((Resolve-Path $Source).Path)
if ($CenterX -lt 0) { $CenterX = [int]($src.Width / 2) }
if ($CenterY -lt 0) { $CenterY = [int]($src.Height * 0.44) }
if ($Radius -lt 0) { $Radius = [int]([Math]::Min($src.Width, $src.Height) * 0.47) }
$crop = New-Object System.Drawing.Rectangle ($CenterX - $Radius), ($CenterY - $Radius), (2 * $Radius), (2 * $Radius)

function Write-Icon([int]$size, [string]$path, [double]$inset = 0.0) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.Clear([System.Drawing.Color]::FromArgb(255, 12, 17, 32))
  $pad = [int]($size * $inset)
  $dest = New-Object System.Drawing.Rectangle $pad, $pad, ($size - 2 * $pad), ($size - 2 * $pad)
  $g.DrawImage($src, $dest, $crop, [System.Drawing.GraphicsUnit]::Pixel)
  New-Item -ItemType Directory -Force (Split-Path -Parent $path) | Out-Null
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

Write-Icon 512 "$repo\public\icons\icon-512.png"
Write-Icon 192 "$repo\public\icons\icon-192.png"
Write-Icon 512 "$repo\public\icons\maskable-512.png" 0.12
Write-Icon 180 "$repo\public\icons\apple-touch-icon.png"

$res = "$repo\android\app\src\main\res"
if (Test-Path $res) {
  $launcher = @{ 'mdpi' = 48; 'hdpi' = 72; 'xhdpi' = 96; 'xxhdpi' = 144; 'xxxhdpi' = 192 }
  $fore = @{ 'mdpi' = 108; 'hdpi' = 162; 'xhdpi' = 216; 'xxhdpi' = 324; 'xxxhdpi' = 432 }
  foreach ($d in $launcher.Keys) {
    Write-Icon $launcher[$d] "$res\mipmap-$d\ic_launcher.png"
    Write-Icon $launcher[$d] "$res\mipmap-$d\ic_launcher_round.png"
    # Adaptive icons crop to the middle ~66%: keep the marble inside that.
    Write-Icon $fore[$d] "$res\mipmap-$d\ic_launcher_foreground.png" 0.2
  }
}
$src.Dispose()
"icons written"
