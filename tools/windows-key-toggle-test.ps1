param(
  [string]$ExePath = (Join-Path $PSScriptRoot "..\src-tauri\target\debug\hyperact.exe"),
  [ValidateRange(2, 100)] [int]$Taps = 12
)

$ErrorActionPreference = "Stop"
$ExePath = [IO.Path]::GetFullPath($ExePath)
if (-not (Test-Path -LiteralPath $ExePath)) {
  throw "Hyperact executable not found: $ExePath (run cargo build first)"
}

Add-Type @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class HyperactWinKeyTest {
    delegate bool EnumProc(IntPtr window, IntPtr state);
    [StructLayout(LayoutKind.Sequential)] struct MSG {
        public IntPtr window;
        public uint message;
        public UIntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public int x, y;
        public uint privateData;
    }

    static readonly ManualResetEvent NeutralReady = new ManualResetEvent(false);
    static IntPtr neutralWindow;

    [DllImport("user32.dll")] static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr state);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateWindowEx(uint exStyle, string className, string title, uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] static extern int GetMessage(out MSG message, IntPtr window, uint min, uint max);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr window, uint message, UIntPtr wParam, IntPtr lParam);

    public static IntPtr StartNeutralWindow() {
        var thread = new Thread(() => {
            neutralWindow = CreateWindowEx(0, "STATIC", "Hyperact Win-key test", 0x00cf0000, 40, 40, 420, 160, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
            ShowWindow(neutralWindow, 5);
            NeutralReady.Set();
            MSG message;
            while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0) { }
        });
        thread.IsBackground = true;
        thread.Start();
        if (!NeutralReady.WaitOne(3000)) return IntPtr.Zero;
        return neutralWindow;
    }

    public static void StopNeutralWindow() {
        if (neutralWindow != IntPtr.Zero) PostMessage(neutralWindow, 0x10, UIntPtr.Zero, IntPtr.Zero);
    }

    public static void Tap(byte key) {
        keybd_event(key, 0, 0, (UIntPtr)0x48595045);
        Thread.Sleep(70);
        keybd_event(key, 0, 2, (UIntPtr)0x48595045);
    }

    public static void PressEscape() {
        keybd_event(0x1b, 0, 0, UIntPtr.Zero);
        keybd_event(0x1b, 0, 2, UIntPtr.Zero);
    }

    public static string ForegroundProcess() {
        uint processId;
        GetWindowThreadProcessId(GetForegroundWindow(), out processId);
        try { return Process.GetProcessById((int)processId).ProcessName; }
        catch { return "pid:" + processId; }
    }

    public static bool LauncherVisible(uint processId) {
        bool visible = false;
        EnumWindows((window, state) => {
            uint owner;
            GetWindowThreadProcessId(window, out owner);
            if (owner != processId || !IsWindowVisible(window)) return true;
            var title = new StringBuilder(256);
            GetWindowText(window, title, title.Capacity);
            if (title.ToString() == "Hyperact") visible = true;
            return true;
        }, IntPtr.Zero);
        return visible;
    }

    public static bool Focus(IntPtr window) {
        // An Alt transition lets this test process request foreground focus.
        keybd_event(0x12, 0, 0, UIntPtr.Zero);
        keybd_event(0x12, 0, 2, UIntPtr.Zero);
        return SetForegroundWindow(window);
    }
}
"@

$hyperact = $null
$neutral = [IntPtr]::Zero
try {
  Get-Process hyperact -ErrorAction SilentlyContinue | Stop-Process -Force

  # Establish a neutral foreground before injecting any keys, so running this
  # test from a terminal cannot send Escape or Win into that terminal.
  $neutral = [HyperactWinKeyTest]::StartNeutralWindow()
  if ($neutral -eq [IntPtr]::Zero -or -not [HyperactWinKeyTest]::Focus($neutral)) {
    throw "Could not establish the neutral foreground window"
  }
  Start-Sleep -Milliseconds 300
  [HyperactWinKeyTest]::PressEscape()
  Start-Sleep -Milliseconds 300

  $foreground = [HyperactWinKeyTest]::ForegroundProcess()
  if ($foreground -in @("SearchHost", "StartMenuExperienceHost")) {
    throw "Start was still open before the test (foreground=$foreground)"
  }

  $hyperact = Start-Process -FilePath $ExePath -PassThru
  Start-Sleep -Seconds 2
  if ([HyperactWinKeyTest]::LauncherVisible([uint32]$hyperact.Id)) {
    throw "Hyperact did not start hidden"
  }

  for ($tap = 1; $tap -le $Taps; $tap++) {
    $key = if (($tap % 2) -eq 1) { [byte]0x5b } else { [byte]0x5c }
    [HyperactWinKeyTest]::Tap($key)
    Start-Sleep -Milliseconds 500

    $visible = [HyperactWinKeyTest]::LauncherVisible([uint32]$hyperact.Id)
    $expected = ($tap % 2) -eq 1
    $foreground = [HyperactWinKeyTest]::ForegroundProcess()
    Write-Host ("{0}: key={1} visible={2} foreground={3}" -f $tap, $(if ($key -eq 0x5b) { "LWin" } else { "RWin" }), $visible, $foreground)

    if ($foreground -in @("SearchHost", "StartMenuExperienceHost")) {
      throw "Start opened after tap $tap"
    }
    if ($visible -ne $expected) {
      throw "Visibility did not alternate after tap $tap (expected=$expected, actual=$visible)"
    }
    if ($expected -and $foreground -ne "hyperact") {
      throw "Hyperact was visible but not foreground after tap $tap (foreground=$foreground)"
    }
  }

  Write-Host "PASS: $Taps alternating left/right Windows-key taps; Start never became foreground."
}
finally {
  if ($hyperact -and -not $hyperact.HasExited) { $hyperact.Kill() }
  [HyperactWinKeyTest]::StopNeutralWindow()
}
