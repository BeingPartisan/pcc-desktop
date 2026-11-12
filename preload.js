const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pcc', {
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  showNotification: (title, body) => ipcRenderer.invoke('show-notification', { title, body }),
  getAutostartStatus: () => ipcRenderer.invoke('get-autostart-status'),
  setAutostart: (enable) => ipcRenderer.invoke('set-autostart', enable),

  // Data backup
  exportData: (data) => ipcRenderer.invoke('export-data', data),
  backupData: (data, reason) => ipcRenderer.invoke('backup-data', { data, reason }),
  openBackupsFolder: () => ipcRenderer.invoke('open-backups-folder'),
  pickImportFile: () => ipcRenderer.invoke('pick-import-file'),
  applyImport: () => ipcRenderer.invoke('apply-import'),

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

  // Appearance
  getSystemAccent: () => ipcRenderer.invoke('get-system-accent'),
  setThemeSource: (source) => ipcRenderer.invoke('set-theme-source', source),
  setAppName: (name) => ipcRenderer.invoke('set-app-name', name),
  getCustomImage: (kind) => ipcRenderer.invoke('get-custom-image', kind),
  pickCustomImage: (kind) => ipcRenderer.invoke('pick-custom-image', kind),
  removeCustomImage: (kind) => ipcRenderer.invoke('remove-custom-image', kind),

  // About
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),

  // Digiicampus timetable sync
  campusStatus: () => ipcRenderer.invoke('campus-status'),
  campusData: () => ipcRenderer.invoke('campus-data'),
  campusConnect: () => ipcRenderer.invoke('campus-connect'),
  campusSync: (options) => ipcRenderer.invoke('campus-sync', options),
  campusDisconnect: () => ipcRenderer.invoke('campus-disconnect'),

  // Console panel
  getLogHistory: () => ipcRenderer.invoke('get-log-history'),
  onLogEntry: (callback) => {
    ipcRenderer.on('log-entry', (event, entry) => callback(entry));
  },

  // Global hotkey
  getHotkey: () => ipcRenderer.invoke('get-hotkey'),
  setHotkey: (accelerator) => ipcRenderer.invoke('set-hotkey', accelerator),
});

