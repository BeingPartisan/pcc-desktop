const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage, dialog, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const si = require('systeminformation');
const AutoLaunch = require('auto-launch');
const { autoUpdater } = require('electron-updater');

let mainWindow = null;
let tray = null;
let isQuitting = false;

// --- Simple JSON-file storage in Electron's userData dir ---
// (separate from renderer's localStorage, since this needs to survive
// and be readable from the main process for things like games config)
const CONFIG_FILE = path.join(app.getPath('userData'), 'pcc-config.json');
const PLAYTIME_FILE = path.join(app.getPath('userData'), 'pcc-playtime.json');
const MAIL_SECRET_FILE = path.join(app.getPath('userData'), 'pcc-mail-secret.bin');

function readJsonSafe(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (e) {
    console.error(`Failed to read ${filePath}:`, e);
  }
  return fallback;
}

function writeJsonSafe(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error(`Failed to write ${filePath}:`, e);
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

function getPlaytimeMap() {
  return readJsonSafe(PLAYTIME_FILE, {});
}

function addPlaytime(exePath, seconds) {
  const map = getPlaytimeMap();
  map[exePath] = (map[exePath] || 0) + seconds;
  writeJsonSafe(PLAYTIME_FILE, map);
  return map[exePath];
}

function saveMailPassword(plainPassword) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS-level encryption is not available on this system.');
  }
  const encrypted = safeStorage.encryptString(plainPassword);
  fs.writeFileSync(MAIL_SECRET_FILE, encrypted);
}

function loadMailPassword() {
  if (!fs.existsSync(MAIL_SECRET_FILE)) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    const encrypted = fs.readFileSync(MAIL_SECRET_FILE);
    return safeStorage.decryptString(encrypted);
  } catch (e) {
    console.error('Failed to decrypt mail password:', e);
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

// Ignore list mirrors the old Python launcher logic: skip installers,
// uninstallers, redistributables, crash reporters, launchers, etc.
const EXE_IGNORE_LIST = ['unins', 'redist', 'setup', 'crash', 'report', 'launcher'];

function findExecutable(folderPath) {
  const stack = [folderPath];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
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

function getFolderSizeBytes(folderPath) {
  let total = 0;
  const stack = [folderPath];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else {
        try {
          total += fs.statSync(fullPath).size;
        } catch (e) {
          // skip unreadable files
        }
      }
    }
  }
  return total;
}

// Fixes Windows showing "electron.app.Electron" as the notification sender
// instead of "Personal Command Center" during development.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.partisan.pcc');
}

const ICON_PATH = path.join(__dirname, 'assets', 'icon.png');

const pccAutoLauncher = new AutoLaunch({
  name: 'Personal Command Center (Beta)',
  path: app.getPath('exe'),
});

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

ipcMain.handle('get-system-info', async () => {
  const [cpu, mem, osInfo, currentLoad, battery, disk] = await Promise.all([
    si.cpu(),
    si.mem(),
    si.osInfo(),
    si.currentLoad(),
    si.battery(),
    si.fsSize(),
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
  if (Notification.isSupported()) {
    new Notification({ title, body, icon: ICON_PATH }).show();
    return { ok: true };
  }
  return { ok: false, reason: 'Notifications not supported on this system' };
});

ipcMain.handle('get-autostart-status', async () => {
  return await pccAutoLauncher.isEnabled();
});

ipcMain.handle('set-autostart', async (event, enable) => {
  const isEnabled = await pccAutoLauncher.isEnabled();
  if (enable && !isEnabled) {
    await pccAutoLauncher.enable();
  } else if (!enable && isEnabled) {
    await pccAutoLauncher.disable();
  }
  return await pccAutoLauncher.isEnabled();
});

// --- Mail scan (schedule/deadline detection) ---

ipcMain.handle('get-mail-config', () => {
  const mail = getMailConfig();
  return {
    email: mail.email || '',
    imapHost: mail.imapHost || 'imap.gmail.com',
    allowedSenders: mail.allowedSenders || [],
    daysBack: mail.daysBack || 7,
    hasPassword: !!loadMailPassword(),
  };
});

ipcMain.handle('set-mail-config', (event, { email, imapHost, allowedSenders, daysBack, appPassword }) => {
  setMailConfig({ email, imapHost, allowedSenders, daysBack });
  if (appPassword) {
    saveMailPassword(appPassword);
  }
  return { ok: true };
});

ipcMain.handle('scan-email', async () => {
  const mail = getMailConfig();
  const password = loadMailPassword();

  if (!mail.email || !password) {
    return {
      error: 'Mail not configured. Open Settings and enter your email + app password.',
      results: [],
    };
  }

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
      const capped = uids.slice(-40).reverse(); // most recent first, same cap as before

      const allowed = (mail.allowedSenders || []).map((a) => a.toLowerCase());

      for (const uid of capped) {
        const msg = await client.fetchOne(uid, { source: true }, { uid: true });
        if (!msg || !msg.source) continue;

        const parsed = await simpleParser(msg.source);
        const sender = parsed.from ? parsed.from.text : '';

        if (allowed.length && !allowed.some((a) => sender.toLowerCase().includes(a))) {
          continue;
        }

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
    return { results };
  } catch (e) {
    try {
      await client.logout();
    } catch (_) {}
    return { error: `IMAP error: ${String(e.message || e)}`, results: [] };
  }
});

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
      await shell.openExternal(target);
    } else {
      // Local app: spawn detached so it isn't tied to PCC's lifecycle
      const child = spawn(target, [], { detached: true, stdio: 'ignore', cwd: path.dirname(target) });
      child.unref();
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
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
  return gamesDir;
});

ipcMain.handle('scan-games', async () => {
  const { gamesDir } = getConfig();
  if (!gamesDir || !fs.existsSync(gamesDir)) return [];

  const playtimeMap = getPlaytimeMap();
  const entries = fs.readdirSync(gamesDir, { withFileTypes: true }).filter((e) => e.isDirectory());

  const games = [];
  for (const entry of entries) {
    const folderPath = path.join(gamesDir, entry.name);
    const exePath = findExecutable(folderPath);
    if (!exePath) continue;

    let iconDataUrl = null;
    try {
      const icon = await app.getFileIcon(exePath, { size: 'large' });
      iconDataUrl = icon.toDataURL();
    } catch (e) {
      iconDataUrl = null;
    }

    games.push({
      name: entry.name.replace(/_/g, ' ').replace(/-/g, ' '),
      exePath,
      sizeBytes: getFolderSizeBytes(folderPath),
      playtimeSeconds: playtimeMap[exePath] || 0,
      icon: iconDataUrl,
    });
  }

  return games;
});

ipcMain.handle('launch-game', async (event, exePath) => {
  try {
    const startedAt = Date.now();
    const child = spawn(exePath, [], { cwd: path.dirname(exePath) });

    child.on('exit', () => {
      const durationSeconds = Math.round((Date.now() - startedAt) / 1000);
      const totalSeconds = addPlaytime(exePath, durationSeconds);
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
    return { ok: false, error: String(e) };
  }
});

// --- Auto Updates (GitHub Releases via electron-updater) ---
// Flow: check silently on startup -> if available, ask before downloading ->
// once downloaded, ask before restarting to install. Nothing happens without
// explicit confirmation at each step.

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

autoUpdater.on('update-available', (info) => {
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
        autoUpdater.downloadUpdate();
      }
    });
});

autoUpdater.on('update-downloaded', () => {
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
        isQuitting = true;
        autoUpdater.quitAndInstall();
      }
    });
});

autoUpdater.on('error', (err) => {
  console.error('Auto-update error:', err);
});

function checkForUpdates(manual) {
  autoUpdater.checkForUpdates().catch((err) => {
    console.error('checkForUpdates failed:', err);
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
  createWindow();
  createTray();
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

app.on('window-all-closed', () => {
  // Keep running in tray on Windows/Linux; on Mac apps typically stay open too
  // We deliberately do NOT quit here since we minimize to tray instead.
});
