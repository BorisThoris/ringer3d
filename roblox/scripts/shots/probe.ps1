# Runs inside the private station: start Studio on the place, wait, PrintWindow its windows.
param([string]$Place, [string]$Out, [int]$Wait = 90, [int]$Shots = 1, [int]$Every = 10, [switch]$Resize)
$ErrorActionPreference = 'Continue'
$log = Join-Path $Out 'probe.log'
"start $(Get-Date -f s)" | Out-File $log -Encoding utf8
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System; using System.Text; using System.Drawing; using System.Drawing.Imaging;
using System.Runtime.InteropServices; using System.Collections.Generic;
public static class Cap {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct R { public int l,t,r,b; }
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h,int c);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
  public static void Show(long h){ ShowWindow(new IntPtr(h),5); }
  public static void Close(long h){ PostMessage(new IntPtr(h),0x10,IntPtr.Zero,IntPtr.Zero); }
  [DllImport("user32.dll")] static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hh, bool rp);
  public static List<string> List(uint pid) {
    var o = new List<string>();
    EnumWindows((h,l)=>{ uint p; GetWindowThreadProcessId(h,out p); if (p==pid){ var s=new StringBuilder(256); GetWindowText(h,s,256); R r; GetWindowRect(h,out r);
      o.Add(h.ToInt64()+"|"+IsWindowVisible(h)+"|"+s+"|"+(r.r-r.l)+"x"+(r.b-r.t)); } return true; }, IntPtr.Zero);
    return o;
  }
  public static void Size(long h, int w, int hh) { MoveWindow(new IntPtr(h),0,0,w,hh,true); }
  public static string Shot(long hw, string path) {
    var h = new IntPtr(hw); R r; GetWindowRect(h,out r); int w=r.r-r.l, hh=r.b-r.t;
    if (w<=0||hh<=0) return "empty rect";
    using (var bmp = new Bitmap(w,hh)) { using (var g = Graphics.FromImage(bmp)) { var dc=g.GetHdc(); bool ok=PrintWindow(h,dc,2); g.ReleaseHdc(dc);
      bmp.Save(path, ImageFormat.Png);
      long sum=0; int n=0; var seen=new HashSet<int>(); for(int y=0;y<hh;y+=17) for(int x=0;x<w;x+=17){ var c=bmp.GetPixel(x,y); sum+=c.R+c.G+c.B; n++; seen.Add(c.ToArgb()); }
      return "ok="+ok+" "+w+"x"+hh+" mean="+(sum/(3*Math.Max(n,1)))+" colours="+seen.Count; } }
  }
}
'@
$exe = (Get-ChildItem "$env:LOCALAPPDATA\Roblox\Versions\*\RobloxStudioBeta.exe" | Select-Object -First 1).FullName
$p = Start-Process -FilePath $exe -ArgumentList @('-task','EditFile','-localPlaceFile',"`"$Place`"") -PassThru
"studio pid $($p.Id)" | Out-File $log -Append -Encoding utf8
if ($Resize) {
  for ($k = 0; $k -lt 60; $k++) {
    $m = [Cap]::List([uint32]$p.Id) | Where-Object { $_ -match ' - Roblox Studio\|' } | Select-Object -First 1
    if ($m) { $h=[long](($m -split '\|')[0]); Start-Sleep 5; [Cap]::Show($h); [Cap]::Size($h, 2600, 1640); "resized $m" | Out-File $log -Append -Encoding utf8; break }
    Start-Sleep 2
  }
}
Start-Sleep -Seconds $Wait
for ($i = 0; $i -lt $Shots; $i++) {
  $wins = [Cap]::List([uint32]$p.Id)
  $wins | ForEach-Object { "win $_" } | Out-File $log -Append -Encoding utf8
  foreach ($d in ($wins | Where-Object { $_ -match 'Migration' })) { $dh=[long](($d -split '\|')[0]); [Cap]::Show($dh); Start-Sleep 2; "dialog $([Cap]::Shot($dh, (Join-Path $Out "dialog-$i.png")))" | Out-File $log -Append -Encoding utf8; [Cap]::Close($dh) }
  $main = $wins | Where-Object { $_ -match 'rbxlx - Roblox Studio' } | Select-Object -First 1
  if ($main) { [Cap]::Show([long](($main -split '\|')[0])); Start-Sleep 3 }
  if ($main) {
    $h = [long](($main -split '\|')[0])
    if ($i -eq 0) { [Cap]::Size($h, 1920, 1080); Start-Sleep -Seconds 5 }
    "shot $i $([Cap]::Shot($h, (Join-Path $Out "shot-$i.png")))" | Out-File $log -Append -Encoding utf8
  } else { "no visible window" | Out-File $log -Append -Encoding utf8 }
  if ($i -lt $Shots - 1) { Start-Sleep -Seconds $Every }
}
Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
"end $(Get-Date -f s)" | Out-File $log -Append -Encoding utf8
