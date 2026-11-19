# Puts one of PCC's windows into the desktop's wallpaper layer: above the
# wallpaper picture, below the desktop icons. That's how the music
# visualiser draws "on" the wallpaper while the icons stay on top and
# clickable. Run once per window by wallpaper.js, which fills in the window's handle and
# position below; prints one JSON line saying what happened.
#
# Several PCC windows can share the layer (the visualiser and Desktop mode).
# The last number says where this one goes among them: 1 = just below the icons,
# 0 = just above the wallpaper picture. The picture itself is always sent to
# the very bottom, so joining never hides a window that joined earlier.
#
# Windows keeps the wallpaper and the icons in windows that belong to
# Explorer. Sending the "Progman" window message 0x052C asks Explorer to
# split them, so there's a gap to slot into. Where that gap is depends on
# the Windows version:
#   newer Windows 11 (24H2 and later): icons (SHELLDLL_DefView) and the
#     wallpaper (WorkerW) are both inside Progman; the window goes between them.
#   older Windows 10 / 11: the icons sit in a top-level WorkerW and the
#     wallpaper in the WorkerW right after it; the window goes inside that one.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class PccWallpaper {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowW(string c, string n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowExW(IntPtr p, IntPtr after, string c, string n);
  [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
  [DllImport("user32.dll")] static extern IntPtr SetParent(IntPtr child, IntPtr parent);
  [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr h, int i, int v);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);

  const uint NOACTIVATE = 0x0010, SHOW = 0x0040, NOMOVE = 0x0002, NOSIZE = 0x0001;

  static readonly IntPtr BOTTOM = new IntPtr(1);

  public static string Run(long hwnd, int x, int y, int w, int h, int onTop) {
    // Work in real screen pixels, like PCC does; otherwise Windows scales every number on a 125% or 150% screen.
    SetProcessDPIAware();
    IntPtr win = new IntPtr(hwnd), r;
    IntPtr progman = FindWindowW("Progman", null);
    if (progman == IntPtr.Zero) return "{\"ok\":false,\"reason\":\"no desktop window (Explorer not running?)\"}";
    SendMessageTimeout(progman, 0x052C, new IntPtr(0xD), new IntPtr(1), 0, 1000, out r);
    SendMessageTimeout(progman, 0x052C, IntPtr.Zero, IntPtr.Zero, 0, 1000, out r);

    // A child window, not a free-standing one.
    int style = GetWindowLong(win, -16);
    SetWindowLong(win, -16, (int)(((uint)style & ~0x80000000u) | 0x40000000u));
    // Child windows are placed relative to their parent, which spans all screens from the top-left one.
    int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77);

    IntPtr icons = FindWindowExW(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
    if (icons != IntPtr.Zero) {
      IntPtr wallpaper = FindWindowExW(progman, IntPtr.Zero, "WorkerW", null);
      SetParent(win, progman);
      SetWindowPos(win, onTop == 1 ? icons : BOTTOM, x - vx, y - vy, w, h, NOACTIVATE | SHOW);   // just below the icons, or lowest
      if (wallpaper != IntPtr.Zero) SetWindowPos(wallpaper, BOTTOM, 0, 0, 0, 0, NOACTIVATE | NOMOVE | NOSIZE); // the picture under everything
      return GetParent(win) == progman ? "{\"ok\":true,\"layout\":\"raised\"}" : "{\"ok\":false,\"reason\":\"could not join the desktop\"}";
    }

    IntPtr target = IntPtr.Zero;
    EnumWindows((top, l) => {
      if (FindWindowExW(top, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero) target = FindWindowExW(IntPtr.Zero, top, "WorkerW", null);
      return true;
    }, IntPtr.Zero);
    if (target == IntPtr.Zero) return "{\"ok\":false,\"reason\":\"no wallpaper layer found\"}";
    SetParent(win, target);
    SetWindowPos(win, onTop == 1 ? IntPtr.Zero : BOTTOM, x - vx, y - vy, w, h, NOACTIVATE | SHOW);   // IntPtr.Zero: the top of the layer
    return GetParent(win) == target ? "{\"ok\":true,\"layout\":\"classic\"}" : "{\"ok\":false,\"reason\":\"could not join the desktop\"}";
  }
}
"@
[PccWallpaper]::Run(__HWND__, __X__, __Y__, __W__, __H__, __ONTOP__)
