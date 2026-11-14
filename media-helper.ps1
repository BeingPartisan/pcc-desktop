# Helper for the floating island (started by island.js, which passes this
# script inline). Prints one JSON line whenever any of this changes:
#   - what Windows says is playing (status, title, artist, app)
#   - what kind of window is in front ("front"):
#       self       one of PCC's own windows
#       desktop    the desktop or taskbar
#       fullscreen a window covering the whole screen (games, video, slides)
#       maximized  a maximised window of another app
#       normal     anything else
# Reads one-word commands (toggle / next / prev) from standard input, and
# exits when that input closes, i.e. when the app goes away.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -AssemblyName System.Windows.Forms

$appPid = __APP_PID__   # filled in by island.js

# Windows Runtime calls return IAsyncOperation; this turns one into a finished result.
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
function Await($operation, $resultType) {
  $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
  $task.Wait(-1) | Out-Null
  $task.Result
}

$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
$manager = Await ($managerType::RequestAsync()) $managerType

# Looking at the front window directly. (Windows' own "user is busy" state
# was tried first, but it also reports the bare desktop as full-screen.)
$windowReady = $true
try {
  Add-Type -Namespace Pcc -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool GetWindowRect(System.IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern bool IsZoomed(System.IntPtr h);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(System.IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint pid);
public struct RECT { public int Left, Top, Right, Bottom; }
'@
} catch { $windowReady = $false }
$desktopClasses = @('Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd')

function Get-Front {
  if (-not $windowReady) { return 'normal' }
  $h = [Pcc.Win]::GetForegroundWindow()
  if ($h -eq [System.IntPtr]::Zero) { return 'desktop' }
  $owner = 0
  [Pcc.Win]::GetWindowThreadProcessId($h, [ref]$owner) | Out-Null
  if ($owner -eq $appPid) { return 'self' }
  $class = New-Object System.Text.StringBuilder 256
  [Pcc.Win]::GetClassName($h, $class, 256) | Out-Null
  if ($desktopClasses -contains $class.ToString()) { return 'desktop' }
  $r = New-Object Pcc.Win+RECT
  [Pcc.Win]::GetWindowRect($h, [ref]$r) | Out-Null
  $b = [System.Windows.Forms.Screen]::FromHandle($h).Bounds
  if ($r.Left -le $b.Left -and $r.Top -le $b.Top -and $r.Right -ge $b.Right -and $r.Bottom -ge $b.Bottom) { return 'fullscreen' }
  if ([Pcc.Win]::IsZoomed($h)) { return 'maximized' }
  return 'normal'
}

$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
$pending = $stdin.ReadLineAsync()
$media = @{ status = 'none'; title = ''; artist = ''; app = '' }
$last = ''
$tick = 0

while ($true) {
  # Commands
  if ($pending.IsCompleted) {
    $command = $pending.Result
    if ($null -eq $command) { break }   # the app closed our input: stop
    $session = $manager.GetCurrentSession()
    if ($session) {
      try {
        if ($command -eq 'toggle') { Await ($session.TryTogglePlayPauseAsync()) ([bool]) | Out-Null }
        elseif ($command -eq 'next') { Await ($session.TrySkipNextAsync()) ([bool]) | Out-Null }
        elseif ($command -eq 'prev') { Await ($session.TrySkipPreviousAsync()) ([bool]) | Out-Null }
      } catch { }
    }
    $pending = $stdin.ReadLineAsync()
    $tick = 0   # report the new state straight away
  }

  # Playback is checked every two seconds; the front window every half second,
  # so the island reacts quickly when you switch apps.
  if ($tick % 4 -eq 0) {
    $media = @{ status = 'none'; title = ''; artist = ''; app = '' }
    try {
      $session = $manager.GetCurrentSession()
      if ($session) {
        $props = Await ($session.TryGetMediaPropertiesAsync()) $propsType
        $playback = $session.GetPlaybackInfo().PlaybackStatus.ToString()
        $media.status = if ($playback -eq 'Playing') { 'playing' } elseif ($playback -eq 'Paused') { 'paused' } else { 'none' }
        $media.title = [string]$props.Title
        $media.artist = [string]$props.Artist
        $media.app = [string]$session.SourceAppUserModelId
      }
    } catch { }
  }

  $state = @{ status = $media.status; title = $media.title; artist = $media.artist; app = $media.app; front = 'normal' }
  try { $state.front = Get-Front } catch { }
  $json = $state | ConvertTo-Json -Compress
  if ($json -ne $last) { $last = $json; [Console]::Out.WriteLine($json); [Console]::Out.Flush() }

  $tick++
  Start-Sleep -Milliseconds 500
}
