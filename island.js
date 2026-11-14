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

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const WINDOW_WIDTH = 420;   // wider and taller than the pill, so it has room to expand;
const WINDOW_HEIGHT = 330;  // the unused area is transparent and lets clicks through
const EDGE_GAP = 6;

module.exports = function registerIsland({ logEvent, getMainWindow, showMainWindow }) {
  let win = null;
  let helper = null;
  // hide: 'never' | 'fullscreen' (a window covering the whole screen) |
  //       'maximized' (also when another app's maximised window is in front)
  let config = { enabled: false, media: true, position: 'center', hide: 'fullscreen' };
  let lastState = null;
  let lastMedia = { status: 'none', title: '', artist: '', app: '', front: 'normal' };

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
    const hide = (config.hide === 'fullscreen' && front === 'fullscreen')
      || (config.hide === 'maximized' && (front === 'fullscreen' || front === 'maximized'));
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
      applyVisibility();
    });
    win.on('closed', () => { win = null; });
  }

  function destroyWindow() {
    if (alive()) win.destroy();
    win = null;
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
          lastMedia = JSON.parse(line);
          send('island-media', config.media ? lastMedia : { ...lastMedia, status: 'none' });
          applyVisibility();
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

  // --- IPC ---

  // From the main window: settings (Settings > Layout > Floating island).
  ipcMain.handle('island-configure', (event, next) => {
    config = { ...config, ...next };
    if (config.enabled) {
      if (!alive()) createWindow(); else { place(); send('island-media', config.media ? lastMedia : { ...lastMedia, status: 'none' }); applyVisibility(); }
      // The helper also reports which window is in front, so it runs for either feature.
      if (config.media || config.hide !== 'never') startHelper(); else stopHelper();
      if (!helper) lastMedia.front = 'normal';
      applyVisibility();
    } else {
      destroyWindow();
      stopHelper();
    }
    return { ok: true };
  });

  // From the main window: the latest snapshot of timer, classes, mail, quote.
  ipcMain.on('island-state', (event, state) => {
    lastState = state;
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
    if (action.type === 'open') showMainWindow();
    const main = getMainWindow();
    if (main && !main.isDestroyed()) main.webContents.send('island-action', action);
  });

  // Keep it in place when the screen resolution or taskbar changes. The
  // screen module can only be used once the app is ready.
  app.whenReady().then(() => screen.on('display-metrics-changed', place));

  return { stop: () => { stopHelper(); destroyWindow(); } };
};
