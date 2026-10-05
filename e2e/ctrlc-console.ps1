# Ctrl+C in a real console, for e2e/cli-packed.spec.ts.
#
# Started by the spec in a NEW console (Start-Process gives every console
# program its own). It runs the installed-layout cmd shim on a long job with
# the output on the console, as in a terminal, waits until the job has written
# part of its output, then puts a Ctrl+C key press into the console input (the
# same record a real key press makes). It records the exit code and the console
# text in a JSON file for the spec to check.
param(
  [Parameter(Mandatory)] [string] $Shim,
  [Parameter(Mandatory)] [string] $WorkDir,
  [Parameter(Mandatory)] [string] $Video,
  [Parameter(Mandatory)] [string] $Result
)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class Con {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct KEY_EVENT_RECORD {
    public int bKeyDown; public ushort wRepeatCount; public ushort wVirtualKeyCode;
    public ushort wVirtualScanCode; public char UnicodeChar; public uint dwControlKeyState;
  }
  [StructLayout(LayoutKind.Explicit, CharSet = CharSet.Unicode)]
  struct INPUT_RECORD { [FieldOffset(0)] public ushort EventType; [FieldOffset(4)] public KEY_EVENT_RECORD Key; }
  [StructLayout(LayoutKind.Sequential)] struct COORD { public short X; public short Y; }
  [StructLayout(LayoutKind.Sequential)]
  struct CSBI { public COORD Size; public COORD Cursor; public ushort Attr; public short L, T, R, B; public COORD Max; }
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern IntPtr CreateFileW(string n, uint a, uint s, IntPtr sa, uint c, uint f, IntPtr t);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
  static extern bool WriteConsoleInputW(IntPtr h, INPUT_RECORD[] r, uint n, out uint w);
  [DllImport("kernel32.dll")] static extern bool GetConsoleScreenBufferInfo(IntPtr h, out CSBI i);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
  static extern bool ReadConsoleOutputCharacterW(IntPtr h, StringBuilder b, uint n, COORD at, out uint read);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  const uint RW = 0xC0000000, SHARE = 3, OPEN = 3;
  public static bool PressCtrlC() {
    IntPtr h = CreateFileW("CONIN$", RW, SHARE, IntPtr.Zero, OPEN, 0, IntPtr.Zero);
    var recs = new INPUT_RECORD[2];
    for (int i = 0; i < 2; i++) {
      recs[i].EventType = 1;
      recs[i].Key.bKeyDown = i == 0 ? 1 : 0; recs[i].Key.wRepeatCount = 1;
      recs[i].Key.wVirtualKeyCode = 0x43; recs[i].Key.wVirtualScanCode = 0x2e;
      recs[i].Key.UnicodeChar = (char)3; recs[i].Key.dwControlKeyState = 0x0008;
    }
    uint written; bool ok = WriteConsoleInputW(h, recs, 2, out written);
    CloseHandle(h); return ok && written == 2;
  }
  public static string Screen() {
    IntPtr h = CreateFileW("CONOUT$", RW, SHARE, IntPtr.Zero, OPEN, 0, IntPtr.Zero);
    CSBI info; GetConsoleScreenBufferInfo(h, out info);
    var sb = new StringBuilder();
    for (short y = 0; y <= info.Cursor.Y; y++) {
      var line = new StringBuilder(info.Size.X); uint read;
      var at = new COORD(); at.X = 0; at.Y = y;
      ReadConsoleOutputCharacterW(h, line, (uint)info.Size.X, at, out read);
      sb.AppendLine(line.ToString(0, (int)read).TrimEnd());
    }
    CloseHandle(h); return sb.ToString();
  }
}
'@

$out = [ordered]@{ pressed = $false; exitCode = $null; screen = ''; error = '' }
try {
  $part = Join-Path $WorkDir ([IO.Path]::GetFileNameWithoutExtension($Video) + ' (compressed).filesmith-part.mp4')
  $p = Start-Process -FilePath cmd.exe -ArgumentList '/d', '/c', "`"`"$Shim`" compress `"$Video`" --codec h265`"" `
    -WorkingDirectory $WorkDir -NoNewWindow -PassThru
  $null = $p.Handle # keeps the exit code readable after exit
  $deadline = (Get-Date).AddSeconds(60)
  while (-not $p.HasExited -and (Get-Date) -lt $deadline) {
    if ((Test-Path -LiteralPath $part) -and (Get-Item -LiteralPath $part).Length -gt 0) { break }
    Start-Sleep -Milliseconds 200
  }
  Start-Sleep -Seconds 1
  $out.partSeen = (Test-Path -LiteralPath $part)
  $out.pressed = [Con]::PressCtrlC()
  if (-not $p.WaitForExit(60000)) { $p.Kill(); $out.error = 'did not exit within 60 s' }
  $out.exitCode = $p.ExitCode
  $out.screen = [Con]::Screen()
} catch {
  $out.error = $_.ToString()
}
$out | ConvertTo-Json | Set-Content -LiteralPath $Result -Encoding utf8
