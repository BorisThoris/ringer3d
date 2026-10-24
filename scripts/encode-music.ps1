# Turn rendered WAVs into loop-ready MP3s in public/music: trim the
# generator's trailing silence, short fade in/out at the seam, 128 kbps.
#   powershell -File scripts/encode-music.ps1 D:\agent-work\ringer3d\music\out
param([Parameter(Mandatory = $true)][string]$RenderDir)
# Decimal points, not commas: a comma inside an ffmpeg filter starts a new filter.
[System.Threading.Thread]::CurrentThread.CurrentCulture = [System.Globalization.CultureInfo]::InvariantCulture
$repo = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $repo 'public\music'
New-Item -ItemType Directory -Force $dest | Out-Null
foreach ($id in 'menu', 'match', 'boss') {
  $wav = Get-ChildItem (Join-Path $RenderDir $id) -Filter *.wav -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $wav) { "skip $id (no render)"; continue }
  $info = ffmpeg -hide_banner -i $wav.FullName -af 'silencedetect=noise=-45dB:d=0.8' -f null NUL 2>&1 | Out-String
  $dur = [double](ffprobe -v error -show_entries format=duration -of csv=p=0 $wav.FullName)
  # The last silence that runs to the end of the file is the tail to cut.
  $end = $dur
  foreach ($s in [regex]::Matches($info, 'silence_start: ([\d.]+)')) {
    $start = [double]$s.Groups[1].Value
    if ($start -gt $dur * 0.6) { $end = $start + 0.15; break }
  }
  $fadeOut = [Math]::Max(0, $end - 1.2)
  $out = Join-Path $dest "$id.mp3"
  ffmpeg -hide_banner -loglevel error -y -i $wav.FullName -t $end -af "afade=t=in:d=0.25,afade=t=out:st=${fadeOut}:d=1.2" -ac 2 -b:a 128k $out
  "{0}: {1:N1}s -> {2:N1}s, {3:N0} KB" -f $id, $dur, $end, ((Get-Item $out).Length / 1KB)
}
