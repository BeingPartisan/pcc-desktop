// Performance: one setting for how smooth (and how hungry) PCC's moving parts
// are: the visualiser, the Desktop mode dashboard and its live stats.
//
//   mode: 'saver' | 'balanced' | 'best'           (Settings > Performance, or the tray)
//   batterySaver: drop to 'saver' while running on battery, and back when plugged in
//   pauseGaming: stop the visualiser listening while a full-screen app (a game, a video) is in front
//
// The renderer sends the choices; this module adds the power state and tells
// whoever is listening (island.js for the visualiser, desktop.js) the profile
// to use right now. Profiles apply live: no window is recreated.

const { app, ipcMain, powerMonitor, BrowserWindow } = require('electron');

const PROFILES = {
  //        bars/wave fps   scenes fps    sparks          dashboard stats   glass            idle animations
  //                                                         (and network)
  saver:    { barsFps: 30, sceneFps: 24, particles: 0.4, statsMs: 4000, glass: 'plain', idleAnims: false },
  balanced: { barsFps: 60, sceneFps: 40, particles: 1,   statsMs: 2000, glass: 'blur',  idleAnims: true },
  // barsFps 0: every frame the screen shows (120 or 144 a second on a fast screen)
  best:     { barsFps: 0,  sceneFps: 60, particles: 1.4, statsMs: 1000, glass: 'rich',  idleAnims: true },
};

module.exports = function registerPerformance({ logEvent, onModeChange }) {
  let config = { mode: 'balanced', batterySaver: true, pauseGaming: true };
  const listeners = [];
  let last = '';

  const onBattery = () => { try { return powerMonitor.isOnBatteryPower(); } catch (e) { return false; } };

  function current() {
    const battery = onBattery();
    const savingForBattery = config.batterySaver && battery && config.mode !== 'saver';
    const mode = savingForBattery ? 'saver' : (PROFILES[config.mode] ? config.mode : 'balanced');
    return { ...PROFILES[mode], mode, chosen: config.mode, onBattery: battery, savingForBattery, pauseGaming: !!config.pauseGaming };
  }

  function announce() {
    const profile = current();
    const key = JSON.stringify(profile);
    if (key === last) return;
    last = key;
    if (profile.savingForBattery) logEvent('info', 'Performance: on battery, using Battery saver');
    for (const fn of listeners) { try { fn(profile); } catch (e) { logEvent('warn', 'Performance listener failed', String(e)); } }
    if (onModeChange) onModeChange(profile);
  }

  ipcMain.handle('perf-configure', (event, next) => {
    config = { ...config, ...(next || {}) };
    announce();
    return current();
  });

  // What each of PCC's processes is using right now, for the readout in Settings.
  // CPU is the average since the previous call (the pane asks every two seconds).
  ipcMain.handle('perf-usage', () => {
    const names = new Map();
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.isDestroyed()) continue;
      const url = w.webContents.getURL();
      const name = url.includes('/island/') ? 'Island' : url.includes('/visualizer/') ? 'Visualiser'
        : url.includes('/desktop/') ? 'Desktop mode' : url.includes('/renderer/index.html') ? 'PCC window' : 'Other';
      names.set(w.webContents.getOSProcessId(), name);
    }
    const totals = {};
    for (const m of app.getAppMetrics()) {
      const name = names.get(m.pid) || 'Electron (shared)';
      const t = totals[name] || (totals[name] = { name, cpu: 0, memoryMB: 0 });
      t.cpu += m.cpu.percentCPUUsage;
      t.memoryMB += m.memory.workingSetSize / 1024;
    }
    return Object.values(totals).map(t => ({ name: t.name, cpu: +t.cpu.toFixed(1), memoryMB: Math.round(t.memoryMB) }));
  });

  app.whenReady().then(() => {
    powerMonitor.on('on-battery', announce);
    powerMonitor.on('on-ac', announce);
  });

  return {
    current,
    // fn(profile) now and whenever it changes
    onChange: (fn) => { listeners.push(fn); },
  };
};
