// Desktop mode: a PCC dashboard drawn on the desktop itself. A transparent
// window the size of the screen joins the wallpaper layer (wallpaper.js),
// so it sits above the wallpaper picture and below the desktop icons: the
// icons stay on top and clickable, and every other window covers it. It
// never takes clicks (stage 1 is read-only).
//
// Who sends what:
//   main window  --'desktop-state'-->  here  -->  dashboard   (classes, tasks, mail...)
//   island.js (media helper)  -->  here  -->  dashboard        (what's playing, what's in front)
//   here (systeminformation)  -->  dashboard                   (CPU, memory, battery, network)
// Nothing is polled or sent while a maximised or full-screen window covers the desktop.

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { execFile } = require('child_process');
const si = require('systeminformation');
const { embedInWallpaper } = require('./wallpaper');

const STATS_EVERY_MS = 4000;
const BATTERY_EVERY_MS = 60 * 1000;
const WALLPAPER_EVERY_MS = 30 * 1000;   // how often to look for a new wallpaper while the dashboard shows

// The wallpaper picture and how Windows fits it to the screen, so the
// dashboard's panels can show a blurred copy of what's behind them (frosted
// glass). A transparent window can't blur the real desktop by itself.
//   fit: 'fill' | 'fit' | 'stretch' | 'center' | 'tile' | 'span'
const WALLPAPER_FITS = { 10: 'fill', 6: 'fit', 2: 'stretch', 0: 'center', 22: 'span' };
function readWallpaper(done) {
  if (process.platform !== 'win32') return done(null);
  execFile('reg', ['query', 'HKCU\\Control Panel\\Desktop'], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
    const value = (name) => { const m = String(stdout || '').match(new RegExp('^\\s+' + name + '\\s+REG_\\w+\\s+(.*)$', 'mi')); return m ? m[1].trim() : ''; };
    // The picture the user picked, or Windows' own copy of it if that file has gone.
    const candidates = [value('WallPaper'), path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper')];
    for (const file of candidates) {
      try {
        if (!file) continue;
        const stat = fs.statSync(file);
        if (!stat.isFile() || !stat.size) continue;
        const fit = value('TileWallpaper') === '1' ? 'tile' : (WALLPAPER_FITS[Number(value('WallpaperStyle'))] || 'fill');
        return done({ url: pathToFileURL(file).href + '?v=' + Math.round(stat.mtimeMs), fit });
      } catch (e) { /* try the next */ }
    }
    done(null);   // a solid colour, or a picture we can't read: plain dark glass
  });
}

module.exports = function registerDesktop({ logEvent }) {
  let win = null;
  let config = { enabled: false, icons: 'left' };   // icons: where the desktop icons are: 'left' | 'right' | 'both'
  let embedded = false;
  let lastState = null, lastMedia = null, lastCover = '', lastUpdate = null;
  let statsTimer = null, battery = null, batteryAt = 0;
  let covered = false;   // a maximised or full-screen window is in front
  let wallpaper = null, wallpaperTimer = null;

  const alive = () => win && !win.isDestroyed();
  const send = (channel, payload) => { if (alive()) win.webContents.send(channel, payload); };

  function layout() {
    const d = screen.getPrimaryDisplay();
    // How far the taskbar (and anything else docked) reaches in from each edge.
    const inset = {
      top: d.workArea.y - d.bounds.y,
      left: d.workArea.x - d.bounds.x,
      right: d.bounds.x + d.bounds.width - (d.workArea.x + d.workArea.width),
      bottom: d.bounds.y + d.bounds.height - (d.workArea.y + d.workArea.height),
    };
    return { inset, icons: config.icons, width: d.bounds.width, height: d.bounds.height };
  }

  function create() {
    const display = screen.getPrimaryDisplay();
    embedded = false;
    win = new BrowserWindow({
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
      webPreferences: { preload: path.join(__dirname, 'desktop-preload.js'), contextIsolation: true, nodeIntegration: false },
    });
    win.setIgnoreMouseEvents(true);
    win.loadFile(path.join(__dirname, 'renderer', 'desktop', 'index.html'));
    win.webContents.once('did-finish-load', () => {
      send('desk-layout', layout());
      if (wallpaper) send('desk-wallpaper', wallpaper); else checkWallpaper();
      if (lastState) send('desk-state', lastState);
      if (lastMedia) send('desk-media', lastMedia);
      send('desk-cover', lastCover);
      send('desk-update', lastUpdate);
      // Nothing is drawn until the first state arrives, so showing it before it joins the wallpaper is invisible.
      win.showInactive();
      embedInWallpaper(win, display, (result) => {
        if (!alive()) return;
        embedded = !!result.ok;
        if (embedded) logEvent('info', `Desktop mode: on the wallpaper (${result.layout} desktop)`);
        else {
          // A dashboard floating over every window would be in the way, so it stays off.
          logEvent('warn', `Desktop mode: couldn't join the wallpaper (${result.reason})`);
          win.hide();
        }
        applyCovered();
      });
    });
    const made = win;   // a new window may already have replaced this one by the time it closes
    win.on('closed', () => { if (win !== made) return; win = null; embedded = false; stopStats(); });
  }

  function destroy() {
    stopStats();
    if (alive()) win.destroy();
    win = null;
  }

  // --- System stats, only while the dashboard can be seen ---

  async function pollStats() {
    try {
      const now = Date.now();
      const [load, mem, net] = await Promise.all([si.currentLoad(), si.mem(), si.networkStats().catch(() => [])]);
      if (!battery || now - batteryAt > BATTERY_EVERY_MS) {
        batteryAt = now;
        const b = await si.battery().catch(() => null);
        battery = b && b.hasBattery ? { percent: Math.round(b.percent), charging: !!b.isCharging } : { none: true };
      }
      const iface = (net || []).find(n => n.operstate === 'up') || (net || [])[0];
      send('desk-stats', {
        cpu: Math.round(load.currentLoad),
        memory: Math.round(mem.active / mem.total * 100),
        battery,
        // bytes a second over the last interval; the first reading after a pause has none yet
        down: iface && iface.rx_sec > 0 ? iface.rx_sec : 0,
        up: iface && iface.tx_sec > 0 ? iface.tx_sec : 0,
      });
    } catch (e) { /* the next tick tries again */ }
  }

  function checkWallpaper() {
    readWallpaper((next) => {
      if (JSON.stringify(next) === JSON.stringify(wallpaper)) return;
      wallpaper = next;
      send('desk-wallpaper', wallpaper);
    });
  }

  function startStats() {
    if (statsTimer) return;
    pollStats();
    statsTimer = setInterval(pollStats, STATS_EVERY_MS);
    checkWallpaper();
    wallpaperTimer = setInterval(checkWallpaper, WALLPAPER_EVERY_MS);
  }
  function stopStats() { clearInterval(statsTimer); statsTimer = null; clearInterval(wallpaperTimer); wallpaperTimer = null; }

  function applyCovered() {
    const showing = alive() && embedded && !covered;
    send('desk-active', showing);
    if (showing) startStats(); else stopStats();
  }

  // --- From the main window ---

  function configure(next) {
    config = { ...config, ...next };
    if (!config.enabled) return destroy();
    if (!alive()) create(); else send('desk-layout', layout());
  }

  ipcMain.handle('desktop-configure', (event, next) => { configure(next || {}); return { ok: true }; });
  ipcMain.on('desktop-state', (event, state) => { lastState = state; send('desk-state', state); });

  app.whenReady().then(() => screen.on('display-metrics-changed', () => {
    // A new resolution or scale: start again at the new size.
    if (alive()) { destroy(); create(); }
  }));

  return {
    stop: destroy,
    isEnabled: () => !!config.enabled,
    setMedia: (media) => {
      lastMedia = media;
      send('desk-media', media);
      const nowCovered = ['maximized', 'fullscreen'].includes(media && media.front);
      if (nowCovered !== covered) { covered = nowCovered; applyCovered(); }
    },
    setCover: (cover) => { lastCover = cover || ''; send('desk-cover', lastCover); },
    setUpdate: (status) => { lastUpdate = status; send('desk-update', status); },
  };
};
