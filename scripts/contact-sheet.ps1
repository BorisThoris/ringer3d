# Tile screenshots into one image for review.
#   powershell -File scripts/contact-sheet.ps1 <dir> <glob> <out.png> [columns] [cellWidth]
param(
  [Parameter(Mandatory = $true)][string]$Dir,
  [Parameter(Mandatory = $true)][string]$Glob,
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$Columns = 4,
  [int]$CellWidth = 0
)
Add-Type -AssemblyName System.Drawing
$files = Get-ChildItem -Path $Dir -Filter $Glob | Sort-Object Name
if (-not $files) { throw "no files match $Glob in $Dir" }
$imgs = $files | ForEach-Object { [System.Drawing.Image]::FromFile($_.FullName) }
$w = if ($CellWidth -gt 0) { $CellWidth } else { $imgs[0].Width }
$h = [int]($imgs[0].Height * $w / $imgs[0].Width)
$rows = [Math]::Ceiling($imgs.Count / $Columns)
$sheet = New-Object System.Drawing.Bitmap ($w * [Math]::Min($Columns, $imgs.Count)), ($h * $rows)
$g = [System.Drawing.Graphics]::FromImage($sheet)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
for ($i = 0; $i -lt $imgs.Count; $i++) {
  $g.DrawImage($imgs[$i], ($i % $Columns) * $w, [Math]::Floor($i / $Columns) * $h, $w, $h)
}
$sheet.Save($Out)
$g.Dispose()
$imgs | ForEach-Object { $_.Dispose() }
"$($imgs.Count) images -> $Out"
