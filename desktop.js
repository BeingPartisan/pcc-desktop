// Desktop mode: a PCC dashboard drawn on the desktop itself. A transparent
// window the size of the screen joins the wallpaper layer (wallpaper.js),
// so it sits above the wallpaper picture and below the desktop icons: the
// icons stay on top and clickable, and every other window covers it. It
// never takes clicks (stage 1 is read-only).
//
// Who sends what:
//   main window  --'desktop-state'-->  here  -->  dashboard   (classes, tasks, mail...)
//   island.js (media helper)  -->  here  -->  dashboard        (what's playing, what's in front)
//   here  -->  dashboard                                       (CPU, memory, network)
// Nothing is polled or sent while a maximised or full-screen window covers the desktop.

const { app, BrowserWindow, ipcMain, screen, powerMonitor, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { embedInWallpaper } = require('./wallpaper');

// Live stats, every profile.statsMs (Settings > Performance): CPU and memory
// from Node's own counters, network from the byte counters the media helper
// reports each second (island.js), battery read by the dashboard page itself
// (navigator.getBattery). None of it starts a process.
const WALLPAPER_EVERY_MS = 60 * 1000;   // how often to look for a new wallpaper while the dashboard shows
// The cards only ever show the wallpaper heavily blurred, so a small copy looks the same
// and saves holding a full-size (often 4K) picture in memory.
const WALLPAPER_COPY_WIDTH = 640;
// Joining the wallpaper can fail right after sign-in (Explorer isn't ready yet): try again a few times.
const EMBED_RETRIES = 8, EMBED_RETRY_MS = 5000;
// After sleep, hibernate or unlocking, the window is rebuilt once Windows has settled.
const WAKE_REBUILD_MS = 3000;

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
        return done({ file, version: Math.round(stat.mtimeMs), fit });
      } catch (e) { /* try the next */ }
    }
    done(null);   // a solid colour, or a picture we can't read: plain dark glass
  });
}

module.exports = function registerDesktop({ logEvent, perf, onNetworkWanted }) {
  let win = null;
  let config = { enabled: false, icons: 'left' };   // icons: where the desktop icons are: 'left' | 'right' | 'both'
  let embedded = false;
  let lastState = null, lastMedia = null, lastCover = '', lastUpdate = null;
  let statsTimer = null;
  let cpuBefore = null;
  let netLatest = null, netMark = null;   // the newest byte counters, and the ones at the previous stats reading
  let wallpaperSource = '';   // file, version and fit of the picture the current small copy was made from
  let covered = false;   // a maximised or full-screen window is in front
  let wallpaper = null, wallpaperTimer = null;
  let retries = 0, retryTimer = null, wakeTimer = null;

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
      if (perf) send('desk-perf', perf.current());
      // Nothing is drawn until the first state arrives, so showing it before it joins the wallpaper is invisible.
      win.showInactive();
      embedInWallpaper(win, display, (result) => {
        if (!alive()) return;
        embedded = !!result.ok;
        if (embedded) { retries = 0; logEvent('info', `Desktop mode: on the wallpaper (${result.layout} desktop)`); }
        else if (retries < EMBED_RETRIES) {
          retries++;
          logEvent('info', `Desktop mode: the desktop isn't ready, trying again (${retries})`);
          destroy();
          retryTimer = setTimeout(() => { retryTimer = null; if (config.enabled && !alive()) create(); }, EMBED_RETRY_MS);
          return;
        } else {
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
    clearTimeout(retryTimer); retryTimer = null;
    stopStats();
    if (alive()) win.destroy();
    win = null;
  }

  // --- System stats, only while the dashboard can be seen ---

  // CPU in use since the last reading, from the time every core has spent busy and idle.
  function cpuPercent() {
    const now = os.cpus().reduce((t, c) => { const all = Object.values(c.times).reduce((a, b) => a + b, 0); return { busy: t.busy + all - c.times.idle, all: t.all + all }; }, { busy: 0, all: 0 });
    const before = cpuBefore; cpuBefore = now;
    if (!before || now.all <= before.all) return 0;
    return Math.round((now.busy - before.busy) / (now.all - before.all) * 100);
  }

  function pollStats() {
    try {
      // Network: bytes a second since the previous reading (none yet on the first one).
      let down = 0, up = 0;
      if (netLatest && netMark && netLatest.t > netMark.t) {
        const seconds = (netLatest.t - netMark.t) / 1000;
        down = Math.max(0, (netLatest.rx - netMark.rx) / seconds);
        up = Math.max(0, (netLatest.tx - netMark.tx) / seconds);
      }
      if (netLatest) netMark = netLatest;
      send('desk-stats', { cpu: cpuPercent(), memory: Math.round((1 - os.freemem() / os.totalmem()) * 100), down, up, live: !!netLatest });
    } catch (e) { /* the next tick tries again */ }
  }
  const statsEvery = () => (perf ? perf.current().statsMs : 2000);

  function checkWallpaper() {
    readWallpaper((found) => {
      const source = found ? `${found.file}|${found.version}|${found.fit}` : '';
      if (source === wallpaperSource) return;
      wallpaperSource = source;
      wallpaper = found ? smallCopy(found) : null;
      send('desk-wallpaper', wallpaper);
    });
  }

  // { url: a small JPEG as a data: URL, fit, w, h: the picture's real size } or null
  function smallCopy({ file, fit }) {
    try {
      let img = nativeImage.createFromPath(file);
      if (img.isEmpty()) img = nativeImage.createFromBuffer(fs.readFileSync(file));   // Windows' own copy has no file extension
      if (img.isEmpty()) return null;
      const { width, height } = img.getSize();
      const small = width > WALLPAPER_COPY_WIDTH ? img.resize({ width: WALLPAPER_COPY_WIDTH, quality: 'good' }) : img;
      return { url: 'data:image/jpeg;base64,' + small.toJPEG(85).toString('base64'), fit, w: width, h: height };
    } catch (e) { return null; }
  }

  function startStats() {
    if (statsTimer) return;
    pollStats();
    statsTimer = setInterval(pollStats, statsEvery());
    if (onNetworkWanted) onNetworkWanted(true);
    checkWallpaper();
    wallpaperTimer = setInterval(checkWallpaper, WALLPAPER_EVERY_MS);
  }
  function stopStats() {
    clearInterval(statsTimer); statsTimer = null; clearInterval(wallpaperTimer); wallpaperTimer = null;
    cpuBefore = null; netLatest = null; netMark = null;
    if (onNetworkWanted) onNetworkWanted(false);
  }

  // A new Performance profile: pass it on, and read the stats at the new pace. Nothing restarts.
  if (perf) perf.onChange((profile) => {
    send('desk-perf', profile);
    if (statsTimer) { clearInterval(statsTimer); statsTimer = setInterval(pollStats, profile.statsMs); }
  });

  function applyCovered() {
    const showing = alive() && embedded && !covered;
    send('desk-active', showing);
    if (showing) startStats(); else stopStats();
  }

  // --- From the main window ---

  function configure(next) {
    config = { ...config, ...next };
    if (!config.enabled) { clearTimeout(wakeTimer); return destroy(); }
    if (!alive()) create(); else send('desk-layout', layout());
  }

  ipcMain.handle('desktop-configure', (event, next) => { configure(next || {}); return { ok: true }; });
  ipcMain.on('desktop-state', (event, state) => { lastState = state; send('desk-state', state); });

  app.whenReady().then(() => screen.on('display-metrics-changed', () => {
    // A new resolution or scale: start again at the new size.
    if (alive()) { destroy(); create(); }
  }));

  // Coming back from sleep or hibernate (or unlocking), Windows may have rebuilt
  // the desktop and the old window no longer shows: start again with a new one.
  function rebuildAfterWake(why) {
    if (!config.enabled) return;
    clearTimeout(wakeTimer);
    wakeTimer = setTimeout(() => {
      logEvent('info', `Desktop mode: rebuilding after ${why}`);
      retries = 0; destroy(); create();
    }, WAKE_REBUILD_MS);
  }
  app.whenReady().then(() => {
    powerMonitor.on('resume', () => rebuildAfterWake('sleep'));
    powerMonitor.on('unlock-screen', () => rebuildAfterWake('unlock'));
  });

  return {
    stop: destroy,
    isEnabled: () => !!config.enabled,
    setMedia: (media) => {
      lastMedia = media;
      send('desk-media', media);
      const nowCovered = ['maximized', 'fullscreen'].includes(media && media.front);
      if (nowCovered !== covered) { covered = nowCovered; applyCovered(); }
    },
    // Network byte counters from the media helper, about once a second while asked for.
    setNet: (sample) => { if (sample && sample.t) netLatest = sample; },
    setCover: (cover) => { lastCover = cover || ''; send('desk-cover', lastCover); },
    setUpdate: (status) => { lastUpdate = status; send('desk-update', status); },
  };
};
