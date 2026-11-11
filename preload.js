const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pcc', {
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  showNotification: (title, body) => ipcRenderer.invoke('show-notification', { title, body }),
  getAutostartStatus: () => ipcRenderer.invoke('get-autostart-status'),
  setAutostart: (enable) => ipcRenderer.invoke('set-autostart', enable),

  // Quick Launcher (URL or local app)
  pickAppFile: () => ipcRenderer.invoke('pick-app-file'),
  launchItem: (type, target) => ipcRenderer.invoke('launch-item', { type, target }),

  // Games Library
  getGamesConfig: () => ipcRenderer.invoke('get-games-config'),
  pickGamesFolder: () => ipcRenderer.invoke('pick-games-folder'),
  scanGames: (force) => ipcRenderer.invoke('scan-games', !!force),
  launchGame: (exePath) => ipcRenderer.invoke('launch-game', exePath),
  onGameSessionEnded: (callback) => {
    ipcRenderer.on('game-session-ended', (event, data) => callback(data));
  },

  // Mail scan
  getMailConfig: () => ipcRenderer.invoke('get-mail-config'),
  setMailConfig: (config) => ipcRenderer.invoke('set-mail-config', config),
  scanEmail: () => ipcRenderer.invoke('scan-email'),

  // Console panel
  getLogHistory: () => ipcRenderer.invoke('get-log-history'),
  onLogEntry: (callback) => {
    ipcRenderer.on('log-entry', (event, entry) => callback(entry));
  },

  // Global hotkey
  getHotkey: () => ipcRenderer.invoke('get-hotkey'),
  setHotkey: (accelerator) => ipcRenderer.invoke('set-hotkey', accelerator),
});

