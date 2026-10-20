# Logs the foreground app every 15 s while you are active (input within 5 min, screen unlocked).
# Output: %USERPROFILE%\.claude\timetrack\pc\YYYY-MM-DD.log, one "HH:mm:ss<TAB>process" line per sample.
$ErrorActionPreference = 'SilentlyContinue'
$mutex = New-Object System.Threading.Mutex($false, 'Local\ClaudeTimetrackTracker')
if (-not $mutex.WaitOne(0)) { exit }  # already running

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class TtWin {
  [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO p);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public static uint IdleSeconds() {
    var i = new LASTINPUTINFO(); i.cbSize = (uint)Marshal.SizeOf(i);
    GetLastInputInfo(ref i);
    return ((uint)Environment.TickCount - i.dwTime) / 1000;
  }
}
'@

$dir = Join-Path $env:USERPROFILE '.claude\timetrack\pc'
New-Item -ItemType Directory -Force $dir | Out-Null
$idleLimit = 300

while ($true) {
  $proc = $null
  if ([TtWin]::IdleSeconds() -lt $idleLimit) {
    $pid2 = 0
    [void][TtWin]::GetWindowThreadProcessId([TtWin]::GetForegroundWindow(), [ref]$pid2)
    if ($pid2 -ne 0) { $proc = (Get-Process -Id $pid2).ProcessName }
  }
  # LockApp is the lock screen: not active time
  if ($proc -and $proc -ne 'LockApp' -and $proc -ne 'Idle') {
    $now = Get-Date
    Add-Content -Path (Join-Path $dir ($now.ToString('yyyy-MM-dd') + '.log')) -Value ($now.ToString('HH:mm:ss') + "`t" + $proc)
  }
  Set-Content -Path (Join-Path (Split-Path $dir) "heartbeat") -Value (Get-Date -Format o)
  Start-Sleep -Seconds 15
}
