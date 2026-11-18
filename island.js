// The floating island: a small always-on-top window pinned to the top of
// the screen that shows whatever matters right now (a running focus timer,
// the current or next class, what's playing, new important mail) and
// expands on hover for controls.
//
// Three parties talk here:
//   main window  --'island-state'-->  this module  -->  island window
//       The app's renderer owns the data (timer, classes, mail, quote) and
//       pushes a snapshot whenever it changes.
//   island window  --'island-action'-->  this module  -->  main window
//       Button presses in the island (pause timer, open inbox...).
//   media helper (PowerShell)  <-->  this module  -->  island window
//       Windows only exposes "now playing" through its Windows Runtime API,
//       which this kind of app can't call directly. media-helper.ps1 runs
//       hidden, prints a JSON line when playback changes, and accepts
//       toggle / next / prev on its standard input.

const { app, BrowserWindow, ipcMain, screen, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');

const WINDOW_WIDTH = 420;   // wider and taller than the pill, so it has room to expand;
const WINDOW_HEIGHT = 520;  // the unused area is transparent and lets clicks through
const EDGE_GAP = 6;

const NUDGE_SHOWN_MS = 3 * 60 * 1000;   // how long a break nudge stays up if ignored
const IDLE_RESET_SECONDS = 5 * 60;      // this long away from the keyboard counts as a break taken

module.exports = function registerIsland({ logEvent, getMainWindow, showMainWindow, onUpdateAction, onSnoozeChange }) {
  let win = null;
  let helper = null;
  // hide: 'never' | 'fullscreen' (a window covering the whole screen) |
  //       'shrink' (hide for full screen; a small handle over maximised windows) |
  //       'maximized' (hide for both)
  // breaks: gently suggest a break after breakMinutes of continuous use
  // visualizer: 'off' | 'bars' | 'wave' | 'ring' | 'nebula' | 'orbit' | 'album': the desktop music visualiser
  let config = { enabled: false, media: true, position: 'center', hide: 'fullscreen', breaks: true, breakMinutes: 90, visualizer: 'off' };
  let viz = null;            // the visualiser window, while the feature is on
  let vizShown = false;
  let lastUpdate = null;     // latest app-update status, shown as a row on the island
  let nudge = null;          // a break suggestion currently showing, or null
  let activeMinutes = 0;     // minutes of use since the last real pause
  let lastState = null;
  let mini = false;          // shown as a small handle, so it doesn't cover another app's tabs
  let appFocused = false;    // PCC's own window has the keyboard
  let snoozeUntil = 0;       // hidden by hand until this time (ms), or 0
  let snoozeTimer = null;
  let lastMedia = { status: 'none', title: '', artist: '', app: '', front: 'normal' };
  let lastCover = '';        // the playing track's cover (data: URL) or ''

  const alive = () => win && !win.isDestroyed();
  const send = (channel, payload) => { if (alive()) win.webContents.send(channel, payload); };

  function place() {
    if (!alive()) return;
    const area = screen.getPrimaryDisplay().workArea;
    const x = config.position === 'left' ? area.x + EDGE_GAP
      : config.position === 'right' ? area.x + area.width - WINDOW_WIDTH - EDGE_GAP
      : area.x + Math.round((area.width - WINDOW_WIDTH) / 2);
    win.setBounds({ x, y: area.y + EDGE_GAP, width: WINDOW_WIDTH, height: WINDOW_HEIGHT });
    send('island-position', config.position);
  }

  // Hidden while the kind of window the user chose is in front (see config.hide).
  function applyVisibility() {
    if (!alive()) return;
    const front = lastMedia.front;
    const snoozed = snoozeUntil > Date.now();
    const hide = snoozed
      || ((config.hide === 'fullscreen' || config.hide === 'shrink') && front === 'fullscreen')
      || (config.hide === 'maximized' && (front === 'fullscreen' || front === 'maximized'));
    // Over PCC itself it's always just a handle: everything it shows is in the app
    // anyway, and a full island would sit on top of PCC's own buttons and dialogs
    // (choosing a background image, for one).
    const overSelf = appFocused || front === 'self';
    const nextMini = overSelf || (config.hide === 'shrink' && front === 'maximized');
    if (nextMini !== mini) { mini = nextMini; send('island-mini', mini); }
    if (hide && win.isVisible()) win.hide();
    else if (!hide && !win.isVisible()) win.showInactive();
  }

  function createWindow() {
    win = new BrowserWindow({
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      focusable: false,      // never takes keyboard focus away from what you're doing
      hasShadow: false,
      alwaysOnTop: true,
      webPreferences: {
        preload: path.join(__dirname, 'island-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    // Clicks pass through the transparent area; the page turns this off
    // while the pointer is over the island itself (see 'island-hover').
    win.setIgnoreMouseEvents(true, { forward: true });
    win.loadFile(path.join(__dirname, 'renderer', 'island', 'index.html'));
    win.webContents.once('did-finish-load', () => {
      place();
      if (lastState) send('island-state', lastState);
      send('island-media', config.media ? lastMedia : { ...lastMedia, status: 'none' });
      send('island-update', lastUpdate);
      send('island-cover', config.media ? lastCover : '');
      send('island-nudge', nudge);
      send('island-mini', mini);
      applyVisibility();
    });
    win.on('closed', () => { win = null; });
  }

  function destroyWindow() {
    if (alive()) win.destroy();
    win = null;
  }

  // --- Hiding for a while ---

  function snooze(minutes) {
    clearTimeout(snoozeTimer);
    snoozeUntil = minutes > 0 ? Date.now() + minutes * 60 * 1000 : 0;
    if (snoozeUntil) {
      snoozeTimer = setTimeout(() => { snoozeUntil = 0; applyVisibility(); if (onSnoozeChange) onSnoozeChange(false); }, minutes * 60 * 1000);
      logEvent('info', `Island hidden for ${minutes} minutes`);
    }
    applyVisibility();
    if (onSnoozeChange) onSnoozeChange(!!snoozeUntil);
  }

  // --- Media helper ---

  function startHelper() {
    if (helper || process.platform !== 'win32') return;
    let script;
    try {
      script = fs.readFileSync(path.join(__dirname, 'media-helper.ps1'), 'utf-8');
    } catch (e) {
      logEvent('warn', 'Island: media helper script is missing', String(e));
      return;
    }
    // The helper needs to know which windows are PCC's own.
    script = script.replace('__APP_PID__', String(process.pid));
    // Passed inline (base64 UTF-16, as PowerShell expects) so it also works
    // from inside the packaged app, where the script isn't a file on disk.
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    try {
      helper = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true });
    } catch (e) {
      logEvent('warn', 'Island: could not start the media helper', String(e));
      helper = null;
      return;
    }
    let buffer = '';
    helper.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf-8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim().startsWith('{')) continue;
        try {
          const parsed = JSON.parse(line);
          if ('cover' in parsed) { lastCover = String(parsed.cover || ''); vizSend('viz-cover', lastCover); send('island-cover', config.media ? lastCover : ''); continue; }
          lastMedia = parsed;
          send('island-media', config.media ? lastMedia : { ...lastMedia, status: 'none' });
          applyVisibility();
          applyVisualizer();
        } catch (e) { /* a partial line; the next one replaces it */ }
      }
    });
    helper.stderr.on('data', () => {}); // PowerShell writes progress noise here
    helper.on('error', (e) => { logEvent('warn', 'Island: media helper error', String(e)); helper = null; });
    helper.on('exit', () => { helper = null; });
    logEvent('info', 'Island: media helper started');
  }

  function stopHelper() {
    if (!helper) return;
    try { helper.stdin.end(); } catch (e) {} // it exits when its input closes
    const proc = helper;
    setTimeout(() => { try { proc.kill(); } catch (e) {} }, 1500);
    helper = null;
  }

  function mediaCommand(command) {
    if (helper && ['toggle', 'next', 'prev'].includes(command)) {
      try { helper.stdin.write(command + '\n'); } catch (e) {}
    }
  }

  // --- Desktop music visualiser ---
  // A transparent window the size of the screen that wallpaper-helper.ps1
  // slots into the desktop's wallpaper layer: above the wallpaper, below
  // the icons, so the icons stay on top and clickable and other windows
  // simply cover it. It never takes clicks.
  //   listening (audio): from when music starts until a few seconds after it stops,
  //     so pausing between songs or switching windows doesn't restart it
  //   drawing: only while music plays and some desktop can be seen, i.e. not
  //     while a maximised or full-screen window covers it
  // If Windows won't let it into the wallpaper layer, it falls back to
  // floating over the desktop only while the desktop itself is in front.

  let vizEmbedded = false;
  let vizListening = false;
  let vizStopTimer = null;
  const vizAlive = () => viz && !viz.isDestroyed();
  const vizSend = (channel, payload) => { if (vizAlive()) viz.webContents.send(channel, payload); };

  function createVisualizer() {
    const display = screen.getPrimaryDisplay();
    vizEmbedded = false; vizListening = false; vizShown = false;
    viz = new BrowserWindow({
      ...display.bounds,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      webPreferences: { preload: path.join(__dirname, 'visualizer-preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    });
    viz.setIgnoreMouseEvents(true);
    viz.loadFile(path.join(__dirname, 'renderer', 'visualizer', 'index.html'));
    viz.webContents.once('did-finish-load', () => {
      sendVizConfig();
      vizSend('viz-media', lastMedia);
      vizSend('viz-cover', lastCover);
      // Nothing is drawn yet, so showing it before it moves into the wallpaper layer is invisible.
      viz.showInactive();
      embedVisualizer(display);
    });
    viz.on('closed', () => { viz = null; vizShown = false; vizEmbedded = false; vizListening = false; });
  }

  function embedVisualizer(display) {
    if (process.platform !== 'win32') { viz.hide(); applyVisualizer(); return; }
    let script;
    try { script = fs.readFileSync(path.join(__dirname, 'wallpaper-helper.ps1'), 'utf-8'); }
    catch (e) { logEvent('warn', 'Visualiser: helper script missing', String(e)); viz.hide(); applyVisualizer(); return; }
    const scale = display.scaleFactor;
    const b = display.bounds;
    const hwnd = viz.getNativeWindowHandle().readBigUInt64LE(0).toString();
    script = script.replace('__HWND__', hwnd).replace('__X__', Math.round(b.x * scale)).replace('__Y__', Math.round(b.y * scale))
      .replace('__W__', Math.round(b.width * scale)).replace('__H__', Math.round(b.height * scale));
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true, timeout: 20000 }, (err, stdout, stderr) => {
      if (!vizAlive()) return;
      // Only the first line of a failure, never the (long) encoded command.
      const firstLine = String(stderr || '').split(/\r?\n/).find(l => l.trim() && !l.startsWith('#<')) || 'helper failed';
      let result = { ok: false, reason: err ? firstLine.replace(/<[^>]+>/g, '').slice(0, 160) : 'no answer' };
      try { result = JSON.parse(String(stdout).trim().split(/\r?\n/).pop()); } catch (e) {}
      vizEmbedded = !!result.ok;
      logEvent(vizEmbedded ? 'info' : 'warn', vizEmbedded ? `Visualiser: on the wallpaper (${result.layout} desktop)` : `Visualiser: couldn't join the wallpaper, floating instead (${result.reason})`);
      if (!vizEmbedded) viz.hide();
      applyVisualizer();
    });
  }

  function sendVizConfig() {
    const display = screen.getPrimaryDisplay();
    // How far the taskbar reaches into the screen, so the shapes sit above it.
    const bottomInset = display.bounds.y + display.bounds.height - (display.workArea.y + display.workArea.height);
    vizSend('viz-config', { style: config.visualizer, accent: lastState && lastState.accent, bottomInset });
  }

  function applyVisualizer() {
    if (!vizAlive()) return;
    vizSend('viz-media', lastMedia);
    const on = config.visualizer !== 'off';
    const playing = on && lastMedia.status === 'playing';
    const front = lastMedia.front;
    const seen = vizEmbedded ? !['maximized', 'fullscreen'].includes(front) : front === 'desktop';

    // Listening: start with the music, stop a little after it ends.
    if (playing) { clearTimeout(vizStopTimer); vizStopTimer = null; if (!vizListening) { vizListening = true; vizSend('viz-listen', true); } }
    else if (vizListening && !vizStopTimer) vizStopTimer = setTimeout(() => { vizStopTimer = null; vizListening = false; vizSend('viz-listen', false); }, 8000);

    // Floating fallback: only on screen while the desktop is in front.
    const show = playing && seen;
    if (!vizEmbedded && show !== vizShown) { if (show) { viz.setBounds(screen.getPrimaryDisplay().bounds); viz.showInactive(); } else viz.hide(); }
    if (show !== vizShown) { vizShown = show; vizSend('viz-active', show); }
  }

  function configureVisualizer() {
    if (config.visualizer === 'off') { if (vizAlive()) viz.destroy(); viz = null; vizShown = false; return; }
    if (!vizAlive()) createVisualizer(); else { sendVizConfig(); applyVisualizer(); }
  }

  // --- IPC ---

  // From the main window: settings (Settings > Layout > Floating island).
  ipcMain.handle('island-configure', (event, next) => {
    config = { ...config, ...next };
    configureVisualizer();
    if (!config.enabled && config.visualizer !== 'off') {
      // No island, but the visualiser still needs to know what's playing and what's in front.
      destroyWindow();
      startHelper();
    } else if (config.enabled) {
      if (!alive()) createWindow(); else { place(); send('island-media', config.media ? lastMedia : { ...lastMedia, status: 'none' }); applyVisibility(); }
      // The helper also reports which window is in front (another app's full-screen
      // window, or PCC's own), so it runs whenever the island is on.
      startHelper();
      if (!helper) lastMedia.front = 'normal';
      applyVisibility();
    } else {
      destroyWindow();
      stopHelper();
    }
    if (onSnoozeChange) onSnoozeChange(snoozeUntil > Date.now()); // the tray menu offers hiding only while the island is on
    return { ok: true };
  });

  // From the main window: the latest snapshot of timer, classes, mail, quote.
  ipcMain.on('island-state', (event, state) => {
    const accentChanged = !lastState || lastState.accent !== state.accent;
    lastState = state;
    if (accentChanged) sendVizConfig();
    send('island-state', state);
  });

  // From the island: pointer is over (or has left) the island itself.
  ipcMain.on('island-hover', (event, inside) => {
    if (alive()) win.setIgnoreMouseEvents(!inside, { forward: true });
  });

  // From the island: a button was pressed.
  ipcMain.on('island-action', (event, action) => {
    if (!action || typeof action.type !== 'string') return;
    if (action.type === 'media') return mediaCommand(action.command);
    if (action.type === 'update-download' || action.type === 'update-install') return onUpdateAction(action.type);
    if (action.type === 'dismiss-nudge') { nudge = null; return send('island-nudge', null); }
    if (action.type === 'snooze') return snooze(Number(action.minutes) || 60);
    if (action.type === 'open') showMainWindow();
    // Everything else (timer, quick notes, messages, workspaces) is the app's to carry out.
    const main = getMainWindow();
    if (main && !main.isDestroyed()) main.webContents.send('island-action', action);
  });

  // From the island: its text box wants the keyboard (or is done with it).
  // The window normally refuses focus so it never interrupts typing elsewhere.
  ipcMain.on('island-focus', (event, wanted) => {
    if (!alive()) return;
    win.setFocusable(!!wanted);
    if (wanted) win.focus(); else win.blur();
  });

  // --- Break nudge ---
  // Once a minute: count it as "in use" if the keyboard or mouse moved within
  // the last minute, start over after a real pause, and when the count
  // reaches the limit, ask the island to pulse for a while.
  function trackActivity() {
    if (!config.enabled || !config.breaks) { activeMinutes = 0; return; }
    const idle = powerMonitor.getSystemIdleTime();
    if (idle >= IDLE_RESET_SECONDS) activeMinutes = 0;
    else if (idle < 60) activeMinutes++;
    if (nudge && Date.now() > nudge.until) { nudge = null; send('island-nudge', null); }
    if (activeMinutes >= config.breakMinutes) {
      activeMinutes = 0;
      nudge = { type: 'break', minutes: config.breakMinutes, until: Date.now() + NUDGE_SHOWN_MS };
      send('island-nudge', nudge);
    }
  }
  app.whenReady().then(() => setInterval(trackActivity, 60 * 1000));

  // Keep it in place when the screen resolution or taskbar changes. The
  // screen module can only be used once the app is ready.
  app.whenReady().then(() => screen.on('display-metrics-changed', place));

  return {
    stop: () => { stopHelper(); destroyWindow(); if (vizAlive()) viz.destroy(); },
    snooze,
    isSnoozed: () => snoozeUntil > Date.now(),
    isEnabled: () => !!config.enabled,
    // PCC's main window gained or lost the keyboard.
    setAppFocused: (focused) => { appFocused = !!focused; applyVisibility(); },
    // Called by the updater so an available update shows on the island too.
    setUpdate: (status) => { lastUpdate = status; send('island-update', status); },
  };
};
