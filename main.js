const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage, dialog, shell, safeStorage, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
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
      daysBack: 7,
    }
  );
}

function setMailConfig(patch) {
  const mail = { ...getMailConfig(), ...patch };
  setConfig({ mail });
  return mail;
}

// --- Email classification logic (ported 1:1 from the old Python keyword banks) ---

const SCHEDULE_KEYWORDS = [
  'cancel', 'cancelled', 'canceled', 'postpone', 'postponed', 'reschedul',
  'makeup class', 'make-up class', 'make up class', 'venue chang', 'room chang',
  'shifted to', 'moved to', 'no class', 'will not be held', 'extra class',
  'substitut', 'swapped with',
];
const DEADLINE_KEYWORDS = [
  'due', 'submission', 'submit by', 'submit the', 'deadline', 'last date',
  'to be submitted', 'submit your', 'kindly submit', 'please submit',
];

function classifyEmailText(subject, body) {
  const text = `${subject}\n${body}`.toLowerCase();
  const scheduleHits = SCHEDULE_KEYWORDS.filter((k) => text.includes(k));
  if (scheduleHits.length) return { category: 'schedule_change', hits: scheduleHits };
  const deadlineHits = DEADLINE_KEYWORDS.filter((k) => text.includes(k));
  if (deadlineHits.length) return { category: 'deadline', hits: deadlineHits };
  return { category: null, hits: [] };
}

function guessDateFromText(text) {
  const patterns = [
    /\b(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})\b/,
    /\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{2,4})?\b/i,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) return m[0];
  }
  return null;
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

// Fixes Windows showing "electron.app.Electron" as the notification sender
// instead of "Personal Command Center" during development.
if (process.platform === 'win32') {
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

  // Minimize to tray instead of closing, unless we're actually quitting
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });
}

function createTray() {
  const trayIcon = nativeImage.createFromPath(ICON_PATH);
  tray = new Tray(trayIcon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Personal Command Center (Beta)');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open PCC',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      },
    },
    { type: 'separator' },
    {
      label: 'Check for Updates',
      click: () => {
        checkForUpdates(true);
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

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
  const [[cpu, osInfo], mem, currentLoad, battery, disk] = await Promise.all([
    getStaticSysInfo(),
    si.mem(),
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

// --- Mail scan (schedule/deadline detection) ---

ipcMain.handle('get-mail-config', async () => {
  const mail = getMailConfig();
  return {
    email: mail.email || '',
    imapHost: mail.imapHost || 'imap.gmail.com',
    allowedSenders: mail.allowedSenders || [],
    daysBack: mail.daysBack || 7,
    hasPassword: !!(await loadMailPassword()),
  };
});

ipcMain.handle('set-mail-config', async (event, { email, imapHost, allowedSenders, daysBack, appPassword }) => {
  setMailConfig({ email, imapHost, allowedSenders, daysBack });
  if (appPassword) {
    await saveMailPassword(appPassword);
    logEvent('info', 'Mail settings saved (app password updated)', { email, imapHost, daysBack });
  } else {
    logEvent('info', 'Mail settings saved', { email, imapHost, daysBack });
  }
  return { ok: true };
});

// Enough to cover the headers and text body of any normal email, without
// pulling down attachments.
const MAIL_FETCH_MAX_BYTES = 256 * 1024;

// Only one scan at a time: a second request while one is running just
// waits for the same result instead of opening another IMAP connection.
let mailScanInFlight = null;

ipcMain.handle('scan-email', () => {
  if (!mailScanInFlight) {
    mailScanInFlight = runMailScan().finally(() => {
      mailScanInFlight = null;
    });
  }
  return mailScanInFlight;
});

async function runMailScan() {
  const mail = getMailConfig();
  const password = await loadMailPassword();

  if (!mail.email || !password) {
    logEvent('warn', 'Mail scan skipped: not configured');
    return {
      error: 'Mail not configured. Open Settings and enter your email + app password.',
      results: [],
    };
  }

  logEvent('info', `Mail scan started for ${mail.email}`, { daysBack: mail.daysBack });

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
    const results = [];

    try {
      const sinceDate = new Date(Date.now() - (mail.daysBack || 7) * 24 * 60 * 60 * 1000);
      const uids = await client.search({ since: sinceDate }, { uid: true });
      const capped = (uids || []).slice(-40).reverse(); // most recent first, same cap as before

      const allowed = (mail.allowedSenders || []).map((a) => a.toLowerCase());

      // Check senders from the lightweight envelopes first (one round trip),
      // so only mail from allowed senders is actually downloaded.
      let wanted = capped;
      if (allowed.length && capped.length) {
        const matching = new Set();
        for await (const m of client.fetch(capped, { envelope: true }, { uid: true })) {
          const from = ((m.envelope && m.envelope.from) || [])
            .map((f) => `${f.name || ''} <${f.address || ''}>`)
            .join(', ')
            .toLowerCase();
          if (allowed.some((a) => from.includes(a))) matching.add(m.uid);
        }
        wanted = capped.filter((uid) => matching.has(uid));
      }

      for (const uid of wanted) {
        const msg = await client.fetchOne(
          uid,
          { source: { start: 0, maxLength: MAIL_FETCH_MAX_BYTES } },
          { uid: true }
        );
        if (!msg || !msg.source) continue;

        const parsed = await simpleParser(msg.source);
        const sender = parsed.from ? parsed.from.text : '';

        const subject = parsed.subject || '';
        const body = parsed.text || '';
        const { category, hits } = classifyEmailText(subject, body);
        if (!category) continue;

        const snippet = body.replace(/\s+/g, ' ').trim().slice(0, 280);
        const guessedDate = category === 'deadline' ? guessDateFromText(`${subject} ${body}`) : null;
        const dateStr = parsed.date ? parsed.date.toString() : '';
        const idHash = crypto
          .createHash('md5')
          .update(`${sender}|${subject}|${dateStr}`)
          .digest('hex')
          .slice(0, 12);

        results.push({
          id: idHash,
          category,
          sender,
          subject,
          date: dateStr,
          snippet,
          matched_keywords: hits,
          guessed_date: guessedDate,
        });
      }
    } finally {
      lock.release();
    }

    await client.logout();
    logEvent('info', `Mail scan complete: ${results.length} matching email(s) found`);
    return { results };
  } catch (e) {
    try {
      await client.logout();
    } catch (_) {}
    logEvent('error', 'Mail scan failed', String(e.message || e));
    return { error: `IMAP error: ${String(e.message || e)}`, results: [] };
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
// Flow: check silently on startup -> if available, ask before downloading ->
// once downloaded, ask before restarting to install. Nothing happens without
// explicit confirmation at each step.

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

autoUpdater.on('update-available', (info) => {
  logEvent('info', `Update available: v${info.version}`);
  dialog
    .showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update available',
      message: `A new version of PCC is available (v${info.version}).`,
      detail: 'Do you want to download it now? It will install the next time you restart.',
      buttons: ['Download', 'Not now'],
      defaultId: 0,
      cancelId: 1,
    })
    .then((result) => {
      if (result.response === 0) {
        logEvent('info', `Downloading update v${info.version}...`);
        autoUpdater.downloadUpdate();
      } else {
        logEvent('info', 'Update download deferred by user');
      }
    });
});

autoUpdater.on('update-downloaded', (info) => {
  logEvent('info', `Update v${info.version} downloaded, ready to install`);
  dialog
    .showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update ready',
      message: 'The update has finished downloading.',
      detail: 'Restart PCC now to install it, or install it later on your own.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    })
    .then((result) => {
      if (result.response === 0) {
        logEvent('info', 'Restarting to install update...');
        isQuitting = true;
        autoUpdater.quitAndInstall();
      } else {
        logEvent('info', 'Update install deferred by user');
      }
    });
});

autoUpdater.on('update-not-available', () => {
  logEvent('info', 'No update available — running latest version');
  // Only say so out loud when the user asked; the startup check stays silent.
  if (lastUpdateCheckWasManual) {
    lastUpdateCheckWasManual = false;
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'No updates',
      message: `You're on the latest version (v${app.getVersion()}).`,
    });
  }
});

let lastUpdateCheckWasManual = false;

ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('check-for-updates', () => {
  // electron-updater only works in the installed (packaged) app.
  if (!app.isPackaged) return { ok: false, reason: 'not-packaged' };
  checkForUpdates(true);
  return { ok: true };
});

autoUpdater.on('error', (err) => {
  logEvent('error', 'Auto-update error', String(err));
});

function checkForUpdates(manual) {
  lastUpdateCheckWasManual = !!manual;
  logEvent('info', manual ? 'Checking for updates (manual)...' : 'Checking for updates (startup)...');
  autoUpdater.checkForUpdates().catch((err) => {
    logEvent('error', 'checkForUpdates failed', String(err));
    if (manual) {
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Update check failed',
        message: 'Could not check for updates.',
        detail: String(err.message || err),
      });
    }
  });
}

// --- App lifecycle ---

app.whenReady().then(() => {
  logEvent('info', `PCC starting up (v${app.getVersion()})`);
  createWindow();
  createTray();
  registerHotkey(getHotkey());
  checkForUpdates(false); // silent check on startup

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
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  // Keep running in tray on Windows/Linux; on Mac apps typically stay open too
  // We deliberately do NOT quit here since we minimize to tray instead.
});
