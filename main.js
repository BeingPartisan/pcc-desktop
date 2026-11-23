const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage, dialog, shell, safeStorage, globalShortcut, nativeTheme, systemPreferences, net, session, desktopCapturer } = require('electron');
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const si = require('systeminformation');
const { autoUpdater } = require('electron-updater');

let mainWindow = null;
let tray = null;
let isQuitting = false;

// --- Logging: in-memory ring buffer + live stream to the Console panel ---
const LOG_BUFFER_MAX = 500;
let logBuffer = [];

function logEvent(level, message, meta) {
  const entry = {
    level, // 'info' | 'warn' | 'error'
    message: String(message),
    meta: meta !== undefined ? meta : null,
    timestamp: Date.now(),
  };
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift();

  // Still print to the real terminal too, for when you're running npm start
  const printer = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  printer(`[PCC:${level}]`, message, meta !== undefined && meta !== null ? meta : '');

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log-entry', entry);
  }
}

ipcMain.handle('get-log-history', () => logBuffer);

// Digiicampus timetable sync lives in its own module (campus.js)
require('./campus')({ logEvent, getMainWindow: () => mainWindow });

// The floating island (its own always-on-top window) lives in island.js
const messaging = require('./messaging')({ logEvent, getMainWindow: () => mainWindow });
require('./feedback')({ logEvent, getMainWindow: () => mainWindow, getLog: () => logBuffer, messaging, broadcastPublicKey: messaging.broadcastPublicKey });

// Settings > Performance: how smooth the visualiser and dashboard are, and Battery saver on battery (performance.js).
const perf = require('./performance')({ logEvent, onModeChange: () => buildTrayMenu() });

// Desktop mode: a PCC dashboard drawn on the wallpaper (desktop.js); the island's media helper feeds it.
const desktop = require('./desktop')({ logEvent, perf, onNetworkWanted: (on) => island.setNetwork(on) });

const island = require('./island')({
  logEvent,
  desktop,
  perf,
  getMainWindow: () => mainWindow,
  // Download / Restart pressed on the island's update row
  onUpdateAction: (type) => (type === 'update-download' ? startUpdateDownload() : installDownloadedUpdate()),
  onSnoozeChange: () => buildTrayMenu(),
  showMainWindow: () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  },
});

process.on('uncaughtException', (err) => {
  logEvent('error', 'Uncaught exception in main process', String((err && err.stack) || err));
});

process.on('unhandledRejection', (reason) => {
  logEvent('error', 'Unhandled promise rejection', String(reason));
});

// --- Simple JSON-file storage in Electron's userData dir ---
// (separate from renderer's localStorage, since this needs to survive
// and be readable from the main process for things like games config)
const CONFIG_FILE = path.join(app.getPath('userData'), 'pcc-config.json');
const PLAYTIME_FILE = path.join(app.getPath('userData'), 'pcc-playtime.json');
const MAIL_SECRET_FILE = path.join(app.getPath('userData'), 'pcc-mail-secret.bin');
const GAME_SIZE_CACHE_FILE = path.join(app.getPath('userData'), 'pcc-game-sizes.json');

function readJsonSafe(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (e) {
    logEvent('error', `Failed to read ${filePath}`, String(e));
  }
  return fallback;
}

function writeJsonSafe(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (e) {
    logEvent('error', `Failed to write ${filePath}`, String(e));
    return false;
  }
}

function getConfig() {
  return readJsonSafe(CONFIG_FILE, { gamesDir: '' });
}

function setConfig(patch) {
  const current = getConfig();
  const updated = { ...current, ...patch };
  writeJsonSafe(CONFIG_FILE, updated);
  return updated;
}

const DEFAULT_HOTKEY = 'CommandOrControl+Alt+Space';

function getHotkey() {
  const cfg = getConfig();
  return cfg.hotkey || DEFAULT_HOTKEY;
}

function registerHotkey(accelerator) {
  globalShortcut.unregisterAll();
  try {
    const ok = globalShortcut.register(accelerator, toggleMainWindow);
    if (!ok) {
      logEvent('warn', `Failed to register hotkey: ${accelerator} (may be in use by another app)`);
      return false;
    }
    logEvent('info', `Global hotkey registered: ${accelerator}`);
    return true;
  } catch (e) {
    logEvent('error', `Error registering hotkey: ${accelerator}`, String(e));
    return false;
  }
}

function toggleMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function getPlaytimeMap() {
  return readJsonSafe(PLAYTIME_FILE, {});
}

function addPlaytime(exePath, seconds) {
  const map = getPlaytimeMap();
  map[exePath] = (map[exePath] || 0) + seconds;
  writeJsonSafe(PLAYTIME_FILE, map);
  return map[exePath];
}

// Uses Electron's async safeStorage API (the sync one is deprecated).
// Passwords saved by older versions of PCC still decrypt with it.
async function saveMailPassword(plainPassword) {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new Error('OS-level encryption is not available on this system.');
  }
  const encrypted = await safeStorage.encryptStringAsync(plainPassword);
  fs.writeFileSync(MAIL_SECRET_FILE, encrypted);
}

async function loadMailPassword() {
  if (!fs.existsSync(MAIL_SECRET_FILE)) return null;
  try {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) return null;
    const encrypted = fs.readFileSync(MAIL_SECRET_FILE);
    const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(encrypted);
    if (shouldReEncrypt) {
      // The OS key was rotated; store the password again under the new key.
      try {
        await saveMailPassword(result);
      } catch (e) {
        logEvent('warn', 'Could not re-encrypt mail password', String(e));
      }
    }
    return result;
  } catch (e) {
    logEvent('error', 'Failed to decrypt mail password', String(e));
    return null;
  }
}

function getMailConfig() {
  const cfg = getConfig();
  return (
    cfg.mail || {
      email: '',
      imapHost: 'imap.gmail.com',
      allowedSenders: [],
      daysBack: 14,
    }
  );
}

function setMailConfig(patch) {
  const mail = { ...getMailConfig(), ...patch };
  setConfig({ mail });
  return mail;
}

function isHttpUrl(value) {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch (e) {
    return false;
  }
}

// spawn() reports a missing/unrunnable file through an async 'error' event,
// not by throwing. Wait until the process has really started (or failed) so
// callers can report the truth back to the UI.
function spawnAndWait(target, options) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(target, [], options);
    child.once('spawn', () => {
      settled = true;
      resolve(child);
    });
    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      } else {
        logEvent('warn', `Process error: ${path.basename(target)}`, String(err));
      }
    });
  });
}

// Ignore list mirrors the old Python launcher logic: skip installers,
// uninstallers, redistributables, crash reporters, launchers, etc.
const EXE_IGNORE_LIST = ['unins', 'redist', 'setup', 'crash', 'report', 'launcher'];

// Both folder walkers are async so a big library never freezes the window.
// (Same traversal order as before, so each game resolves to the same exe
// and keeps its recorded playtime.)
async function findExecutable(folderPath) {
  const stack = [folderPath];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.exe')) {
        const lower = entry.name.toLowerCase();
        if (!EXE_IGNORE_LIST.some((x) => lower.includes(x))) {
          return fullPath;
        }
      }
    }
  }
  return null;
}

async function getFolderSizeBytes(folderPath) {
  let total = 0;
  const stack = [folderPath];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    const files = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else files.push(fullPath);
    }
    const sizes = await Promise.all(
      files.map((f) =>
        fs.promises.stat(f).then(
          (s) => s.size,
          () => 0 // skip unreadable files
        )
      )
    );
    for (const s of sizes) total += s;
  }
  return total;
}

// Folder sizes are the expensive part of a games scan (one stat per file),
// and they rarely change, so they're cached on disk and only recomputed
// when stale or when the user presses Refresh.
const GAME_SIZE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function getCachedFolderSize(folderPath, cache, force) {
  const hit = cache[folderPath];
  if (!force && hit && Date.now() - hit.at < GAME_SIZE_TTL_MS) return hit.sizeBytes;
  const sizeBytes = await getFolderSizeBytes(folderPath);
  cache[folderPath] = { sizeBytes, at: Date.now() };
  return sizeBytes;
}

// The app ID ties the installed app to its Start menu shortcut, which is
// where Windows takes the taskbar icon and the notification name from.
// A development run (npm start) has no such shortcut: with the ID set,
// Windows falls back to the Electron icon in the taskbar, so there the ID
// is left alone and the window's own icon is used instead.
if (process.platform === 'win32' && app.isPackaged) {
  app.setAppUserModelId('com.partisan.pcc');
}

const ICON_PATH = path.join(__dirname, 'assets', 'icon.png');

// --- Autostart (Electron's built-in login item support) ---
// When Windows starts PCC at login it passes --hidden, so the app comes up
// in the tray instead of opening its window over whatever you're doing.
const HIDDEN_FLAG = '--hidden';
const startHidden = process.argv.includes(HIDDEN_FLAG);
const LOGIN_ITEM = { path: process.execPath, args: [HIDDEN_FLAG] };

function getAutostartState() {
  // In development the executable is the bare Electron binary, so
  // registering it would launch an empty Electron at login.
  if (!app.isPackaged) return { supported: false, enabled: false };
  return { supported: true, enabled: app.getLoginItemSettings(LOGIN_ITEM).openAtLogin };
}

// --- Single instance lock: prevent multiple copies running ---
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    icon: ICON_PATH,
    title: 'Personal Command Center (Beta)',
    show: !startHidden, // started at login: stay in the tray until asked for

    // --- NATIVE AESTHETICS UPGRADES ---
    titleBarStyle: 'hidden', // Hides the default OS title bar
    titleBarOverlay: {       // Keeps OS window controls (Win/Mac) but styles them to match your dark theme
      color: '#00000000',     // 8-digit hex for fully transparent background
      symbolColor: '#7A80A0', // Keeps the minimize/maximize/close icons visible
      height: 55
    },
    backgroundMaterial: 'mica', // Enables Windows 11 Mica blur effect
    vibrancy: 'under-window',   // Enables macOS Vibrancy blur effect
    // ----------------------------------

    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // window.open() / target=_blank links go to the default browser instead of
  // spawning a bare Electron window. Anything that isn't http(s) is dropped.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // The main window only ever shows the local UI; never let it navigate away.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file://')) return;
    event.preventDefault();
    if (isHttpUrl(url)) shell.openExternal(url);
  });

  // Forward renderer-side console.log/warn/error into the same Console panel
  // (Details are read from the event object; the old positional arguments
  // are deprecated in current Electron.)
  mainWindow.webContents.on('console-message', (event) => {
    const levelMap = { debug: 'info', info: 'info', warning: 'warn', error: 'error' };
    const { level, message, lineNumber, sourceId } = event;
    const shortSource = sourceId ? sourceId.split(/[\\/]/).pop() : '';
    logEvent(levelMap[level] || 'info', `[renderer] ${message}`, shortSource ? `${shortSource}:${lineNumber}` : null);
  });

  // The island shrinks to a handle while PCC itself is being used.
  mainWindow.on('focus', () => island.setAppFocused(true));
  mainWindow.on('blur', () => island.setAppFocused(false));
  mainWindow.on('hide', () => island.setAppFocused(false));

  // Minimize to tray instead of closing, unless we're actually quitting
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });
}

// The music visualiser and the island's bars listen to what the computer is
// playing. Chromium only hands out that "loopback" sound together with a
// screen capture, so the screen goes along and the page stops it at once
// (see renderer/visualizer/audio.js). Only PCC's own island and visualiser
// pages are allowed; anything else asking gets nothing.
function allowSystemAudio() {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    const url = (request.frame && request.frame.url) || '';
    const ours = url.startsWith('file://') && /\/renderer\/(island|visualizer)\//.test(url.replace(/\\/g, '/'));
    if (!ours) return callback({});
    desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      .then((sources) => callback(sources.length ? { video: sources[0], audio: 'loopback' } : {}))
      .catch(() => callback({}));
  });
}

// Rebuilt when the island is hidden or comes back, so the menu offers the right one.
function buildTrayMenu() {
  if (!tray) return;
  const islandItems = !island.isEnabled() ? []
    : island.isSnoozed()
      ? [{ label: 'Show the island now', click: () => island.snooze(0) }, { type: 'separator' }]
      : [{ label: 'Hide the island for an hour', click: () => island.snooze(60) }, { type: 'separator' }];
  // While the desktop visualiser is on: draw it over every window (click-through) or back on the wallpaper.
  const viz = island.visualizer();
  const visualizerItems = viz.style === 'off' ? [] : [
    { label: 'Visualiser over windows', type: 'checkbox', checked: viz.layer === 'top',
      click: () => { if (mainWindow) mainWindow.webContents.send('island-action', { type: 'visualizer-layer' }); } },
    { type: 'separator' },
  ];
  // Performance modes, as a quick switch. The choice is saved by the app, like the one in Settings.
  const profile = perf.current();
  const perfItems = [
    { label: profile.savingForBattery ? 'Performance (Battery saver while on battery)' : 'Performance', enabled: false },
    ...[['saver', 'Battery saver'], ['balanced', 'Balanced'], ['best', 'Best quality']].map(([mode, label]) => ({
      label, type: 'radio', checked: profile.chosen === mode,
      click: () => { if (mainWindow) mainWindow.webContents.send('island-action', { type: 'perf-mode', mode }); },
    })),
    { type: 'separator' },
  ];
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open PCC', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { type: 'separator' },
    ...islandItems,
    ...perfItems,
    ...visualizerItems,
    {
      label: 'Check for Updates',
      click: () => {
        // the answer appears as a dialog in the app window, so bring it forward
        if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
        checkForUpdates(true);
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
  ]));
}

ipcMain.handle('island-snooze', (event, minutes) => { island.snooze(Number(minutes) || 0); return { snoozed: island.isSnoozed() }; });

function createTray() {
  const trayIcon = nativeImage.createFromPath(ICON_PATH);
  tray = new Tray(trayIcon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Personal Command Center (Beta)');
  buildTrayMenu();
  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// --- IPC handlers exposed to renderer via preload.js ---

// Only CPU load and memory change second to second. CPU model and OS never
// change while the app runs, and disks/battery move slowly, so those are
// cached instead of re-queried (each query spawns system processes on Windows).
let staticSysInfo = null;
const slowSysInfo = {
  battery: { ttl: 30 * 1000, at: 0, value: null, pending: null, load: () => si.battery() },
  disk: { ttl: 60 * 1000, at: 0, value: null, pending: null, load: () => si.fsSize() },
};

function getStaticSysInfo() {
  if (!staticSysInfo) {
    staticSysInfo = Promise.all([si.cpu(), si.osInfo()]).catch((e) => {
      staticSysInfo = null; // allow a retry on the next poll
      throw e;
    });
  }
  return staticSysInfo;
}

function getSlowSysInfo(key) {
  const slot = slowSysInfo[key];
  if (slot.value && Date.now() - slot.at < slot.ttl) return Promise.resolve(slot.value);
  if (!slot.pending) {
    slot.pending = slot
      .load()
      .then((value) => {
        slot.value = value;
        slot.at = Date.now();
        return value;
      })
      .finally(() => {
        slot.pending = null;
      });
  }
  return slot.pending;
}

ipcMain.handle('get-system-info', async () => {
  // Memory from Node's own counters: on Windows, si.mem() starts a PowerShell process every time.
  const mem = { total: require('os').totalmem(), available: require('os').freemem() };
  mem.active = mem.total - mem.available;
  const [[cpu, osInfo], currentLoad, battery, disk] = await Promise.all([
    getStaticSysInfo(),
    si.currentLoad(),
    getSlowSysInfo('battery'),
    getSlowSysInfo('disk'),
  ]);

  return {
    cpu: {
      manufacturer: cpu.manufacturer,
      brand: cpu.brand,
      cores: cpu.cores,
      speed: cpu.speed,
    },
    memory: {
      totalGB: (mem.total / 1024 ** 3).toFixed(2),
      usedGB: (mem.active / 1024 ** 3).toFixed(2),
      freeGB: (mem.available / 1024 ** 3).toFixed(2),
    },
    os: {
      platform: osInfo.platform,
      distro: osInfo.distro,
      release: osInfo.release,
      arch: osInfo.arch,
    },
    load: {
      currentLoadPercent: currentLoad.currentLoad.toFixed(1),
    },
    battery: {
      hasBattery: battery.hasBattery,
      percent: battery.percent,
      isCharging: battery.isCharging,
    },
    disks: disk.map((d) => ({
      mount: d.mount,
      sizeGB: (d.size / 1024 ** 3).toFixed(1),
      usedGB: (d.used / 1024 ** 3).toFixed(1),
      usePercent: d.use,
    })),
  };
});

ipcMain.handle('show-notification', (event, { title, body }) => {
  logEvent('info', `Notification sent: "${title}"`, body);
  if (Notification.isSupported()) {
    new Notification({ title, body, icon: ICON_PATH }).show();
    return { ok: true };
  }
  return { ok: false, reason: 'Notifications not supported on this system' };
});

ipcMain.handle('get-autostart-status', () => getAutostartState());

ipcMain.handle('set-autostart', (event, enable) => {
  if (app.isPackaged) {
    app.setLoginItemSettings({ ...LOGIN_ITEM, openAtLogin: !!enable });
    logEvent('info', enable ? 'Autostart enabled' : 'Autostart disabled');
  }
  return getAutostartState();
});

// --- Data backup: export / import / automatic backups ---
// The renderer owns the day-to-day data (tasks, notes, finances...) in its
// localStorage and hands it over as a plain object. The main process adds
// its own settings and playtime, and does the file work. The mail password
// is never included.

const BACKUP_APP_ID = 'personal-command-center';
const BACKUP_DIR = path.join(app.getPath('userData'), 'backups');
const BACKUP_KEEP = 10;
let pendingImport = null; // a picked backup file waiting for the user's confirmation

function buildBackup(rendererData) {
  return {
    app: BACKUP_APP_ID,
    appVersion: app.getVersion(),
    exportedAt: new Date().toISOString(),
    data: rendererData && typeof rendererData === 'object' ? rendererData : {},
    main: { config: getConfig(), playtime: getPlaytimeMap() },
  };
}

function backupStamp() {
  // e.g. 2026-11-11_14-05-09 (local time, safe in a file name)
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

ipcMain.handle('export-data', async (event, rendererData) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export PCC data',
    defaultPath: path.join(app.getPath('documents'), `pcc-export-${backupStamp().slice(0, 10)}.json`),
    filters: [{ name: 'PCC backup', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  try {
    await fs.promises.writeFile(result.filePath, JSON.stringify(buildBackup(rendererData), null, 2), 'utf-8');
    logEvent('info', `Data exported to ${result.filePath}`);
    return { ok: true, filePath: result.filePath };
  } catch (e) {
    logEvent('error', 'Data export failed', String(e));
    return { ok: false, error: String(e.message || e) };
  }
});

// The evaluation pattern as a Word document (evaluation-docx.js builds it).
ipcMain.handle('export-evaluation-docx', async (event, data) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export evaluation pattern',
    defaultPath: path.join(app.getPath('documents'), `Evaluation pattern ${backupStamp().slice(0, 10)}.docx`),
    filters: [{ name: 'Word document', extensions: ['docx'] }],
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  try {
    const { buildEvaluationDocx } = require('./evaluation-docx');
    await fs.promises.writeFile(result.filePath, await buildEvaluationDocx(data || {}));
    logEvent('info', `Evaluation pattern exported to ${result.filePath}`);
    return { ok: true, filePath: result.filePath };
  } catch (e) {
    logEvent('error', 'Evaluation export failed', String(e));
    return { ok: false, error: String(e.message || e) };
  }
});
// A Word file's tables (word-tables.js), for importing an evaluation pattern or a schedule.
ipcMain.handle('import-word-tables', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import from a Word document',
    defaultPath: app.getPath('documents'),
    filters: [{ name: 'Word document', extensions: ['docx'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
  try {
    const { readWordTables } = require('./word-tables');
    const tables = readWordTables(await fs.promises.readFile(result.filePaths[0]));
    return { ok: true, name: path.basename(result.filePaths[0]), tables };
  } catch (e) {
    logEvent('warn', 'Word import failed', String(e));
    return { ok: false, error: String(e.message || e) };
  }
});
ipcMain.handle('open-path', async (event, filePath) => {
  // Only files this app just wrote: a .docx in a folder the user chose.
  if (typeof filePath !== 'string' || !/\.docx$/i.test(filePath)) return false;
  return (await shell.openPath(filePath)) === '';
});

// Automatic safety copy, kept in the app's own data folder. Only the most
// recent BACKUP_KEEP files are kept.
ipcMain.handle('backup-data', async (event, { data, reason }) => {
  try {
    await fs.promises.mkdir(BACKUP_DIR, { recursive: true });
    const filePath = path.join(BACKUP_DIR, `pcc-backup-${backupStamp()}.json`);
    await fs.promises.writeFile(filePath, JSON.stringify(buildBackup(data)), 'utf-8');

    const old = (await fs.promises.readdir(BACKUP_DIR))
      .filter((f) => /^pcc-backup-.*\.json$/.test(f))
      .sort()
      .reverse()
      .slice(BACKUP_KEEP);
    await Promise.all(old.map((f) => fs.promises.unlink(path.join(BACKUP_DIR, f)).catch(() => {})));

    logEvent('info', `Backup saved (${reason || 'manual'})`, path.basename(filePath));
    return { ok: true, filePath };
  } catch (e) {
    logEvent('error', 'Backup failed', String(e));
    return { ok: false, error: String(e.message || e) };
  }
});

ipcMain.handle('open-backups-folder', async () => {
  await fs.promises.mkdir(BACKUP_DIR, { recursive: true });
  const err = await shell.openPath(BACKUP_DIR);
  return { ok: !err, error: err || undefined };
});

// Step 1 of an import: pick and validate a file. Nothing is changed yet.
ipcMain.handle('pick-import-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import PCC data',
    defaultPath: app.getPath('documents'),
    properties: ['openFile'],
    filters: [{ name: 'PCC backup', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
  try {
    const parsed = JSON.parse(await fs.promises.readFile(result.filePaths[0], 'utf-8'));
    const validData = parsed && parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data);
    if (!parsed || parsed.app !== BACKUP_APP_ID || !validData) {
      return { ok: false, error: 'That file is not a PCC backup.' };
    }
    pendingImport = parsed;
    return {
      ok: true,
      fileName: path.basename(result.filePaths[0]),
      exportedAt: parsed.exportedAt || null,
      data: parsed.data,
    };
  } catch (e) {
    logEvent('error', 'Could not read import file', String(e));
    return { ok: false, error: 'Could not read that file: ' + String(e.message || e) };
  }
});

// Step 2, after the user confirms: restore the main-process side (settings
// and playtime). The renderer restores its own data and reloads.
ipcMain.handle('apply-import', () => {
  const backup = pendingImport;
  pendingImport = null;
  if (!backup) return { ok: false, error: 'No import in progress' };
  const main = backup.main || {};
  if (main.config && typeof main.config === 'object') {
    writeJsonSafe(CONFIG_FILE, main.config);
    registerHotkey(getHotkey());
  }
  if (main.playtime && typeof main.playtime === 'object') {
    writeJsonSafe(PLAYTIME_FILE, main.playtime);
  }
  logEvent('info', 'Data imported from backup', backup.exportedAt || null);
  return { ok: true };
});

// --- Global Hotkey ---

ipcMain.handle('get-hotkey', () => {
  return getHotkey();
});

ipcMain.handle('set-hotkey', (event, accelerator) => {
  if (!accelerator || typeof accelerator !== 'string') {
    return { ok: false, error: 'Invalid accelerator' };
  }
  // A global shortcut swallows its key in every app, so a bare letter or
  // Shift+letter would make that key unusable system-wide.
  const keys = accelerator.split('+');
  const hasModifier = keys.some((k) => /^(CommandOrControl|CmdOrCtrl|Control|Ctrl|Alt|Super|Meta|Command|Cmd)$/i.test(k));
  const isFunctionKey = /^F([1-9]|1\d|2[0-4])$/i.test(keys[keys.length - 1]);
  if (!hasModifier && !isFunctionKey) {
    return { ok: false, error: 'Use Ctrl, Alt or the Windows key with another key (or a function key).' };
  }
  const success = registerHotkey(accelerator);
  if (success) {
    setConfig({ hotkey: accelerator });
    return { ok: true };
  }
  // Re-register the previous working one so the app isn't left with no hotkey
  registerHotkey(getHotkey());
  return { ok: false, error: 'Could not register that shortcut — it may already be in use.' };
});

// --- Mail scan (feeds the Inbox page) ---
// The main process only fetches: it signs in over IMAP, lists recent mail
// and downloads the start of anything the app hasn't seen yet. Sorting by
// sender, course tags and date detection all happen in the renderer
// (renderer/js/inbox.js), on this computer. Nothing is sent anywhere.

const MAIL_DEFAULT_DAYS_BACK = 14;
const MAIL_MAX_NEW_PER_SCAN = 250;      // newest first; the rest are picked up by later scans
const MAIL_FETCH_MAX_BYTES = 48 * 1024; // headers plus the opening of the body, never attachments
const MAIL_TEXT_CHARS = 2500;           // how much body text is passed on for date / course detection

// One-time move from the old keyword scan's settings to the Inbox: widen the
// look-back, and replace the short list of named senders with the whole
// domain of the user's own address. The old senders are handed to the
// renderer once so it can label them Important.
function migrateMailConfigForInbox() {
  const cfg = getConfig();
  if (!cfg.mail || cfg.mail.inboxMigrated) return;
  const mail = { ...cfg.mail, inboxMigrated: true };
  mail.daysBack = Math.max(Number(mail.daysBack) || 0, MAIL_DEFAULT_DAYS_BACK);
  const domain = String(mail.email || '').split('@')[1];
  const old = (mail.allowedSenders || []).filter(Boolean);
  if (domain && old.length && old.every((s) => s.includes('@') && !s.startsWith('@'))) {
    mail.legacyImportantSenders = old;
    mail.allowedSenders = ['@' + domain];
  }
  setConfig({ mail });
  logEvent('info', 'Mail settings updated for the Inbox', { daysBack: mail.daysBack, scanFrom: mail.allowedSenders });
}

ipcMain.handle('get-mail-config', async () => {
  migrateMailConfigForInbox();
  const mail = getMailConfig();
  return {
    email: mail.email || '',
    imapHost: mail.imapHost || 'imap.gmail.com',
    allowedSenders: mail.allowedSenders || [],
    daysBack: mail.daysBack || MAIL_DEFAULT_DAYS_BACK,
    hasPassword: !!(await loadMailPassword()),
    legacyImportantSenders: mail.legacyImportantSenders || [],
  };
});

// Mail servers answer a refused sign-in with little more than "Command
// failed". This turns what they do say into something a person can act on.
function explainMailError(e, host) {
  const server = String(e.responseText || '').trim();
  const gmail = /gmail|google/i.test(host || '');
  if (e.authenticationFailed) {
    if (/application-specific password/i.test(server)) {
      return 'Sign-in refused: this account needs an app password, not your normal password. Create one at myaccount.google.com/apppasswords and paste it here.';
    }
    if (gmail) {
      return 'Sign-in refused by Gmail. Check the email address, and use a 16-letter app password (not your normal password) from myaccount.google.com/apppasswords. That page only works once 2-Step Verification is on. If it says the setting is not available, a college or work account may have it switched off by its administrator.';
    }
    return `Sign-in refused by ${host}${server ? ' ("' + server + '")' : ''}. Check the email address and password. Many providers need a separate app password for mail apps.`;
  }
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(e.code)) return `Could not find the mail server "${host}". Check the IMAP server name and your internet connection.`;
  if (['ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'ESOCKET', 'NoConnection'].includes(e.code)) return `Could not connect to ${host}. Check your internet connection; some networks block mail apps.`;
  return `Could not read mail: ${String(e.message || e)}${server ? ' (' + server + ')' : ''}`;
}

// Google shows app passwords as four groups of four letters. The spaces are
// only for reading; remove them, along with any stray space around a paste.
function tidyMailPassword(raw) {
  const value = String(raw || '').trim();
  return /^([a-z]{4}\s+){3}[a-z]{4}$/i.test(value) ? value.replace(/\s+/g, '') : value;
}

// Signs in and straight out again, to check the saved settings work.
ipcMain.handle('test-mail-login', async () => {
  const mail = getMailConfig();
  const password = await loadMailPassword();
  if (!mail.email || !password) return { ok: false, error: 'Add your email address and app password first.' };
  const host = mail.imapHost || 'imap.gmail.com';
  const { ImapFlow } = require('imapflow');
  const client = new ImapFlow({ host, port: 993, secure: true, auth: { user: mail.email, pass: password }, logger: false });
  try {
    await client.connect();
    await client.logout().catch(() => {});
    logEvent('info', 'Mail sign-in check passed');
    return { ok: true };
  } catch (e) {
    try { client.close(); } catch (_) {}
    logEvent('error', 'Mail sign-in check failed', { reason: e.authenticationFailed ? 'sign-in refused' : (e.code || String(e.message || e)), server: String(e.responseText || '') });
    return { ok: false, error: explainMailError(e, host) };
  }
});

ipcMain.handle('set-mail-config', async (event, { email, imapHost, allowedSenders, daysBack, appPassword }) => {
  setMailConfig({ email: String(email || '').trim(), imapHost, allowedSenders, daysBack });
  appPassword = tidyMailPassword(appPassword);
  if (appPassword) {
    await saveMailPassword(appPassword);
    logEvent('info', 'Mail settings saved (app password updated)', { email, imapHost, daysBack });
  } else {
    logEvent('info', 'Mail settings saved', { email, imapHost, daysBack });
  }
  return { ok: true };
});

// The renderer has now labelled the old named senders; don't offer them again.
ipcMain.handle('clear-legacy-mail-senders', () => {
  const mail = getMailConfig();
  if (mail.legacyImportantSenders) {
    delete mail.legacyImportantSenders;
    setConfig({ mail });
  }
  return { ok: true };
});

// Who an email was addressed to, from the user's point of view:
//   'direct'  to you, alone or with a few others (up to DIRECT_MAX_RECIPIENTS)
//   'cc'      you were copied in
//   'group'   to you along with many others
//   'list'    reached you through a mailing list or a group address
//             (you aren't named in To or Cc, or the mail says it's from a list)
const DIRECT_MAX_RECIPIENTS = 5;

// Gmail ignores dots and anything after a "+" in the part before the @, so
// "a.b+x@gmail.com" is the same inbox as "ab@gmail.com".
function sameInbox(address) {
  let [local, domain] = String(address || '').toLowerCase().trim().split('@');
  if (!domain) return '';
  local = local.split('+')[0];
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return `${local}@${domain}`;
}

function mailAudience(envelope, headers, myAddress) {
  const me = sameInbox(myAddress);
  const to = ((envelope && envelope.to) || []).map((a) => sameInbox(a.address));
  const cc = ((envelope && envelope.cc) || []).map((a) => sameInbox(a.address));
  const h = String(headers || '').toLowerCase();
  const fromList = /^list-id:/m.test(h) || /^list-unsubscribe:/m.test(h) || /^precedence:\s*(bulk|list)/m.test(h);
  if (!me || fromList) return 'list';
  if (to.includes(me)) return to.length + cc.length <= DIRECT_MAX_RECIPIENTS ? 'direct' : 'group';
  if (cc.includes(me)) return 'cc';
  return 'list';
}

// Only one scan at a time: a second request while one is running just
// waits for the same result instead of opening another IMAP connection.
let mailScanInFlight = null;

ipcMain.handle('scan-email', (event, knownKeys) => {
  if (!mailScanInFlight) {
    mailScanInFlight = runMailScan(Array.isArray(knownKeys) ? knownKeys : []).finally(() => {
      mailScanInFlight = null;
    });
  }
  return mailScanInFlight;
});

// knownKeys: the messages the app already holds, so they aren't downloaded again.
// Returns { messages: [new ones], present: [keys of every message in the window] }.
async function runMailScan(knownKeys) {
  migrateMailConfigForInbox();
  const mail = getMailConfig();
  const password = await loadMailPassword();

  if (!mail.email || !password) {
    logEvent('warn', 'Mail scan skipped: not configured');
    return { error: 'Mail is not set up. Add your email and app password in Settings.', notConfigured: true, messages: [] };
  }

  const daysBack = Number(mail.daysBack) || MAIL_DEFAULT_DAYS_BACK;
  logEvent('info', `Mail scan started for ${mail.email}`, { daysBack });

  const { ImapFlow } = require('imapflow');
  const { simpleParser } = require('mailparser');

  const client = new ImapFlow({
    host: mail.imapHost || 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: mail.email, pass: password },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    const messages = [];
    const present = [];

    try {
      // A message is identified by the mailbox's UIDVALIDITY plus its UID,
      // which stays the same for as long as it sits in the inbox.
      const validity = String(client.mailbox.uidValidity);
      const keyOf = (uid) => `${validity}:${uid}`;
      const known = new Set(knownKeys);

      const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
      const uids = (await client.search({ since }, { uid: true })) || [];
      const allowed = (mail.allowedSenders || []).map((a) => a.toLowerCase()).filter(Boolean);

      // Pass 1: envelopes for everything in the window (one round trip),
      // plus the three headers that say whether a message came from a list.
      // Who each message was addressed to is worked out for all of them, so
      // mail fetched before this existed gets it too.
      const wanted = [];
      const audiences = {};
      if (uids.length) {
        for await (const m of client.fetch(uids, { envelope: true, headers: ['list-id', 'list-unsubscribe', 'precedence'] }, { uid: true })) {
          const from = ((m.envelope && m.envelope.from) || [])[0] || {};
          const fromText = `${from.name || ''} <${from.address || ''}>`.toLowerCase();
          if (allowed.length && !allowed.some((a) => fromText.includes(a))) continue;
          present.push(keyOf(m.uid));
          audiences[keyOf(m.uid)] = mailAudience(m.envelope, m.headers, mail.email);
          if (!known.has(keyOf(m.uid))) wanted.push(m.uid);
        }
      }

      // Pass 2: the start of each new message (again one round trip).
      const batch = wanted.sort((a, b) => b - a).slice(0, MAIL_MAX_NEW_PER_SCAN);
      const raw = [];
      if (batch.length) {
        const query = { envelope: true, flags: true, source: { start: 0, maxLength: MAIL_FETCH_MAX_BYTES } };
        for await (const m of client.fetch(batch, query, { uid: true })) {
          raw.push({ uid: m.uid, envelope: m.envelope || {}, flags: m.flags, source: m.source });
        }
      }

      for (const m of raw) {
        let text = '';
        try {
          const parsed = await simpleParser(m.source);
          text = parsed.text || '';
        } catch (e) {
          // A message cut off mid-way can fail to parse; its subject is still useful.
        }
        const from = (m.envelope.from || [])[0] || {};
        const body = text.replace(/\s+/g, ' ').trim();
        messages.push({
          key: keyOf(m.uid),
          messageId: m.envelope.messageId || '',
          fromName: from.name || '',
          fromAddress: (from.address || '').toLowerCase(),
          subject: m.envelope.subject || '(no subject)',
          date: m.envelope.date ? new Date(m.envelope.date).toISOString() : new Date().toISOString(),
          text: body.slice(0, MAIL_TEXT_CHARS),
          seen: !!(m.flags && m.flags.has('\\Seen')),
          audience: audiences[keyOf(m.uid)] || 'list',
        });
      }

      logEvent('info', `Mail scan complete: ${messages.length} new of ${present.length} in the last ${daysBack} days` +
        (wanted.length > batch.length ? ` (${wanted.length - batch.length} more next time)` : ''));
      return { messages, present, audiences, more: wanted.length > batch.length };
    } finally {
      lock.release();
      await client.logout().catch(() => {});
    }
  } catch (e) {
    try {
      await client.logout();
    } catch (_) {}
    logEvent('error', 'Mail scan failed', { reason: e.authenticationFailed ? 'sign-in refused' : (e.code || String(e.message || e)), server: String(e.responseText || '') });
    return { error: explainMailError(e, mail.imapHost || 'imap.gmail.com'), messages: [] };
  }
}

// --- Quick Launcher: pick + launch either a local app or a URL ---

ipcMain.handle('pick-app-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose an application',
    properties: ['openFile'],
    filters:
      process.platform === 'win32'
        ? [{ name: 'Executables', extensions: ['exe'] }, { name: 'All Files', extensions: ['*'] }]
        : [{ name: 'All Files', extensions: ['*'] }],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('launch-item', async (event, { type, target }) => {
  try {
    if (type === 'url') {
      if (!isHttpUrl(target)) throw new Error('Only http(s) links can be opened');
      await shell.openExternal(target);
    } else {
      // Local app: spawn detached so it isn't tied to PCC's lifecycle
      try {
        const child = await spawnAndWait(target, { detached: true, stdio: 'ignore', cwd: path.dirname(target) });
        child.unref();
      } catch (spawnErr) {
        // Some apps can't be spawned directly (e.g. they need elevation);
        // let Windows open them the way a double-click would.
        const openErr = await shell.openPath(target);
        if (openErr) throw new Error(`${spawnErr.message || spawnErr} / ${openErr}`);
      }
    }
    logEvent('info', `Launched ${type}: ${target}`);
    return { ok: true };
  } catch (e) {
    logEvent('error', `Failed to launch ${type}: ${target}`, String(e));
    return { ok: false, error: String(e.message || e) };
  }
});

// --- Games Library ---

ipcMain.handle('get-games-config', () => {
  return getConfig();
});

ipcMain.handle('pick-games-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose your Games folder',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  const gamesDir = result.filePaths[0];
  setConfig({ gamesDir });
  logEvent('info', `Games folder set to ${gamesDir}`);
  return gamesDir;
});

ipcMain.handle('scan-games', async (event, force) => {
  const { gamesDir } = getConfig();
  if (!gamesDir || !fs.existsSync(gamesDir)) {
    logEvent('warn', 'Games scan skipped: no valid folder configured');
    return [];
  }

  logEvent('info', `Scanning games library: ${gamesDir}${force ? ' (full rescan)' : ''}`);
  const startedAt = Date.now();
  const playtimeMap = getPlaytimeMap();
  const sizeCache = readJsonSafe(GAME_SIZE_CACHE_FILE, {});

  let entries;
  try {
    entries = (await fs.promises.readdir(gamesDir, { withFileTypes: true })).filter((e) => e.isDirectory());
  } catch (e) {
    logEvent('error', 'Games scan failed: could not read games folder', String(e));
    return [];
  }

  const scanned = await Promise.all(
    entries.map(async (entry) => {
      const folderPath = path.join(gamesDir, entry.name);
      const exePath = await findExecutable(folderPath);
      if (!exePath) return null;

      const [iconDataUrl, sizeBytes] = await Promise.all([
        app.getFileIcon(exePath, { size: 'large' }).then(
          (icon) => icon.toDataURL(),
          () => null
        ),
        getCachedFolderSize(folderPath, sizeCache, !!force),
      ]);

      return {
        name: entry.name.replace(/_/g, ' ').replace(/-/g, ' '),
        exePath,
        sizeBytes,
        playtimeSeconds: playtimeMap[exePath] || 0,
        icon: iconDataUrl,
      };
    })
  );
  const games = scanned.filter(Boolean);

  // Drop cache entries for folders that no longer exist, then persist.
  const liveFolders = new Set(entries.map((e) => path.join(gamesDir, e.name)));
  for (const key of Object.keys(sizeCache)) {
    if (key.startsWith(gamesDir) && !liveFolders.has(key)) delete sizeCache[key];
  }
  writeJsonSafe(GAME_SIZE_CACHE_FILE, sizeCache);

  logEvent('info', `Games scan complete: ${games.length} title(s) found in ${Date.now() - startedAt} ms`);
  return games;
});

ipcMain.handle('launch-game', async (event, exePath) => {
  try {
    const startedAt = Date.now();
    logEvent('info', `Launching game: ${exePath}`);
    const child = await spawnAndWait(exePath, { cwd: path.dirname(exePath) });

    child.on('exit', () => {
      const durationSeconds = Math.round((Date.now() - startedAt) / 1000);
      const totalSeconds = addPlaytime(exePath, durationSeconds);
      logEvent('info', `Game session ended: ${path.basename(exePath)}`, { durationSeconds, totalSeconds });
      if (mainWindow) {
        mainWindow.webContents.send('game-session-ended', {
          exePath,
          durationSeconds,
          totalSeconds,
        });
      }
    });

    return { ok: true };
  } catch (e) {
    logEvent('error', `Failed to launch game: ${exePath}`, String(e));
    return { ok: false, error: String(e.message || e) };
  }
});

// --- Auto Updates (GitHub Releases via electron-updater) ---
// The app checks on startup and then every UPDATE_CHECK_MINUTES. Nothing is
// downloaded or installed without the user saying so: each stage is sent to
// the app window as an 'update-status' message, and its own styled dialog
// (renderer/js/updates.js) asks before downloading and before restarting.
//
//   status.state: 'available' | 'downloading' | 'downloaded' | 'none' | 'error'

const UPDATE_CHECK_MINUTES = 30;

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

let lastUpdateCheckWasManual = false;
let lastUpdateStatus = null;   // replayed to the window when it asks (e.g. after a reload)
let announcedVersion = null;   // the version a system notification has already been shown for

function sendUpdateStatus(status) {
  lastUpdateStatus = status;
  // The island shows real updates (not "you're up to date" or errors from a manual check).
  island.setUpdate(['available', 'downloading', 'downloaded'].includes(status.state) ? status : null);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-status', status);
}

// Release notes arrive as HTML, or as a list of them; the dialog wants plain text.
function plainReleaseNotes(notes) {
  const raw = Array.isArray(notes) ? notes.map((n) => n.note || '').join('\n') : String(notes || '');
  return raw.replace(/<li>/gi, '• ').replace(/<\/(p|li|h\d|div)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n').trim().slice(0, 1200);
}

autoUpdater.on('update-available', (info) => {
  logEvent('info', `Update available: v${info.version}`);
  sendUpdateStatus({ state: 'available', version: info.version, current: app.getVersion(), notes: plainReleaseNotes(info.releaseNotes), manual: lastUpdateCheckWasManual });
  // If the window is tucked away in the tray, say so once with a system notification.
  const hidden = !mainWindow || !mainWindow.isVisible() || mainWindow.isMinimized();
  if (hidden && announcedVersion !== info.version && Notification.isSupported()) {
    announcedVersion = info.version;
    const note = new Notification({ title: 'Update available', body: `Version ${info.version} is ready to download. Click to open.`, icon: ICON_PATH });
    note.on('click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
    note.show();
  }
});

autoUpdater.on('download-progress', (progress) => {
  sendUpdateStatus({ ...(lastUpdateStatus || {}), state: 'downloading', percent: Math.round(progress.percent || 0) });
});

autoUpdater.on('update-downloaded', (info) => {
  logEvent('info', `Update v${info.version} downloaded, ready to install`);
  sendUpdateStatus({ ...(lastUpdateStatus || {}), state: 'downloaded', version: info.version });
});

autoUpdater.on('update-not-available', () => {
  logEvent('info', 'No update available — running latest version');
  // Only say so when the user asked; scheduled checks stay silent.
  if (lastUpdateCheckWasManual) sendUpdateStatus({ state: 'none', current: app.getVersion(), manual: true });
  lastUpdateCheckWasManual = false;
});

autoUpdater.on('error', (err) => {
  logEvent('error', 'Auto-update error', String(err));
  const wasDownloading = lastUpdateStatus && lastUpdateStatus.state === 'downloading';
  if (lastUpdateCheckWasManual || wasDownloading) sendUpdateStatus({ state: 'error', message: String(err.message || err).slice(0, 300), manual: true });
  lastUpdateCheckWasManual = false;
});

function checkForUpdates(manual) {
  // electron-updater only works in the installed (packaged) app.
  // A development run shows a preview instead, so the dialog and the island's update row can be seen.
  if (!app.isPackaged) {
    if (manual) startUpdatePreview();
    return;
  }
  // Don't interrupt a download, or re-offer something already downloaded.
  if (lastUpdateStatus && ['downloading', 'downloaded'].includes(lastUpdateStatus.state)) {
    if (manual) sendUpdateStatus({ ...lastUpdateStatus, manual: true });
    return;
  }
  lastUpdateCheckWasManual = !!manual;
  logEvent('info', manual ? 'Checking for updates (manual)...' : 'Checking for updates...');
  autoUpdater.checkForUpdates().catch((err) => {
    logEvent('error', 'checkForUpdates failed', String(err));
    if (manual) sendUpdateStatus({ state: 'error', message: String(err.message || err).slice(0, 300), manual: true });
    lastUpdateCheckWasManual = false;
  });
}

ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('check-for-updates', () => {
  checkForUpdates(true);
  return { ok: app.isPackaged };
});

// The window asks for the current status when it loads, so an update found
// before it was ready (or before a reload) is still offered.
ipcMain.handle('get-update-status', () => lastUpdateStatus);

// --- Update preview (development runs only) ---
// Walks through the same stages as a real update with a made-up version.
// Nothing is downloaded or installed; each status carries preview: true.
let previewTimer = null;

function startUpdatePreview() {
  clearInterval(previewTimer);
  sendUpdateStatus({
    state: 'available', version: '9.9.9', current: app.getVersion(), manual: true, preview: true,
    notes: 'This is a preview of the update dialog.\n• Release notes from GitHub appear here\n• Download and Restart only pretend\n• The island shows the same update when you point at it',
  });
}

function previewDownload() {
  let percent = 0;
  sendUpdateStatus({ ...lastUpdateStatus, state: 'downloading', percent });
  clearInterval(previewTimer);
  previewTimer = setInterval(() => {
    percent += 8;
    if (percent < 100) return sendUpdateStatus({ ...lastUpdateStatus, state: 'downloading', percent });
    clearInterval(previewTimer);
    sendUpdateStatus({ ...lastUpdateStatus, state: 'downloaded', percent: 100 });
  }, 350);
}

function startUpdateDownload() {
  if (!lastUpdateStatus || lastUpdateStatus.state !== 'available') return { ok: false };
  if (lastUpdateStatus.preview) { previewDownload(); return { ok: true }; }
  logEvent('info', `Downloading update v${lastUpdateStatus.version}...`);
  sendUpdateStatus({ ...lastUpdateStatus, state: 'downloading', percent: 0 });
  autoUpdater.downloadUpdate().catch((err) => {
    logEvent('error', 'Update download failed', String(err));
    sendUpdateStatus({ state: 'error', message: String(err.message || err).slice(0, 300), manual: true });
  });
  return { ok: true };
}

function installDownloadedUpdate() {
  if (!lastUpdateStatus || lastUpdateStatus.state !== 'downloaded') return { ok: false };
  if (lastUpdateStatus.preview) { sendUpdateStatus({ state: 'none', current: app.getVersion(), manual: true, preview: true }); return { ok: true }; }
  logEvent('info', 'Restarting to install update...');
  isQuitting = true;
  autoUpdater.quitAndInstall();
  return { ok: true };
}

ipcMain.handle('update-download', () => startUpdateDownload());
ipcMain.handle('update-install', () => installDownloadedUpdate());

// --- Quotes ---
// A batch of quotes from a free public source (no account, nothing about
// the user is sent). The renderer keeps the short ones; see renderer/js/quotes.js.
const QUOTES_URL = 'https://dummyjson.com/quotes/random/10';

ipcMain.handle('fetch-quotes', async () => {
  try {
    const res = await net.fetch(QUOTES_URL, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { ok: false, error: `Quote service answered ${res.status}` };
    const list = await res.json();
    const quotes = (Array.isArray(list) ? list : [])
      .map((q) => ({ text: String(q.quote || '').replace(/\s+/g, ' ').trim(), author: String(q.author || '').trim() }))
      .filter((q) => q.text);
    return { ok: true, quotes };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

// --- Appearance (Settings > Appearance) ---

// Windows accent colour as #rrggbb, or null where the system has none.
ipcMain.handle('get-system-accent', () => {
  try {
    const rgba = systemPreferences.getAccentColor(); // "rrggbbaa"
    return rgba ? '#' + rgba.slice(0, 6) : null;
  } catch (e) {
    return null;
  }
});

// Keeps the window chrome and the Windows backdrop in step with the app's
// theme: 'light', 'dark', or 'system' to follow Windows.
ipcMain.handle('set-theme-source', (event, source) => {
  if (['light', 'dark', 'system'].includes(source)) nativeTheme.themeSource = source;
  return nativeTheme.shouldUseDarkColors;
});

// The display name chosen in Settings. The window title follows the page's
// own title; the tray tooltip is set here.
ipcMain.handle('set-app-name', (event, name) => {
  if (tray && typeof name === 'string' && name.trim()) tray.setToolTip(name.trim().slice(0, 60));
  return { ok: true };
});

// A custom logo or wallpaper is copied into the app's data folder, so it
// keeps working if the original file is moved or deleted.
const CUSTOM_IMAGE_KINDS = ['logo', 'wallpaper'];

function findCustomImage(kind) {
  const dir = app.getPath('userData');
  const file = fs.readdirSync(dir).find((f) => f.startsWith(`custom-${kind}.`));
  if (!file) return null;
  const full = path.join(dir, file);
  // The timestamp makes the page reload the image after it's replaced.
  return `${pathToFileURL(full).href}?t=${Math.round(fs.statSync(full).mtimeMs)}`;
}

function removeCustomImage(kind) {
  const dir = app.getPath('userData');
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith(`custom-${kind}.`)) fs.unlinkSync(path.join(dir, f));
  }
}

ipcMain.handle('get-custom-image', (event, kind) => (CUSTOM_IMAGE_KINDS.includes(kind) ? findCustomImage(kind) : null));

ipcMain.handle('pick-custom-image', async (event, kind) => {
  if (!CUSTOM_IMAGE_KINDS.includes(kind)) return { ok: false, error: 'Unknown image kind' };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: kind === 'logo' ? 'Choose a logo image' : 'Choose a background image',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
  });
  if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
  try {
    const source = result.filePaths[0];
    removeCustomImage(kind);
    const dest = path.join(app.getPath('userData'), `custom-${kind}${path.extname(source).toLowerCase()}`);
    await fs.promises.copyFile(source, dest);
    logEvent('info', `Custom ${kind} image set`);
    return { ok: true, url: findCustomImage(kind) };
  } catch (e) {
    logEvent('error', `Could not set custom ${kind} image`, String(e));
    return { ok: false, error: String(e.message || e) };
  }
});

ipcMain.handle('remove-custom-image', (event, kind) => {
  if (CUSTOM_IMAGE_KINDS.includes(kind)) removeCustomImage(kind);
  return { ok: true };
});

// --- App lifecycle ---

app.whenReady().then(() => {
  logEvent('info', `PCC starting up (v${app.getVersion()})`);
  createWindow();
  allowSystemAudio();
  createTray();
  registerHotkey(getHotkey());
  checkForUpdates(false); // silent check on startup...
  setInterval(() => checkForUpdates(false), UPDATE_CHECK_MINUTES * 60 * 1000); // ...and regularly while running

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow.show();
    }
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  island.stop(); // close the island and its helper process with the app
  desktop.stop();
  messaging.stop();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  // Keep running in tray on Windows/Linux; on Mac apps typically stay open too
  // We deliberately do NOT quit here since we minimize to tray instead.
});
