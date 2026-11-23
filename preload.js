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
  islandSnooze: (minutes) => ipcRenderer.invoke('island-snooze', minutes),
  testMailLogin: () => ipcRenderer.invoke('test-mail-login'),
  scanEmail: (knownKeys) => ipcRenderer.invoke('scan-email', knownKeys),
  clearLegacyMailSenders: () => ipcRenderer.invoke('clear-legacy-mail-senders'),

  // Appearance
  getSystemAccent: () => ipcRenderer.invoke('get-system-accent'),
  setThemeSource: (source) => ipcRenderer.invoke('set-theme-source', source),
  setAppName: (name) => ipcRenderer.invoke('set-app-name', name),
  getCustomImage: (kind) => ipcRenderer.invoke('get-custom-image', kind),
  pickCustomImage: (kind) => ipcRenderer.invoke('pick-custom-image', kind),
  removeCustomImage: (kind) => ipcRenderer.invoke('remove-custom-image', kind),

  // Messages between devices
  messagesConfigure: (config) => ipcRenderer.invoke('messages-configure', config),
  messagesSend: (message) => ipcRenderer.invoke('messages-send', message),
  messagesBroadcast: (text) => ipcRenderer.invoke('messages-broadcast', text),
  onMessage: (callback) => ipcRenderer.on('message-received', (event, message) => callback(message)),

  // Feedback to the developer
  feedbackSend: (report) => ipcRenderer.invoke('feedback-send', report),
  feedbackStatus: () => ipcRenderer.invoke('feedback-status'),
  feedbackList: () => ipcRenderer.invoke('feedback-list'),
  feedbackMark: (id, done) => ipcRenderer.invoke('feedback-mark', { id, done }),
  onFeedbackReceived: (callback) => ipcRenderer.on('feedback-received', (event, report) => callback(report)),
  onFeedbackDelivered: (callback) => ipcRenderer.on('feedback-delivered', (event, status) => callback(status)),

  // Quotes
  fetchQuotes: () => ipcRenderer.invoke('fetch-quotes'),

  // Evaluation pattern as a Word document; opening it afterwards
  exportEvaluationDocx: (data) => ipcRenderer.invoke('export-evaluation-docx', data),
  openExportedFile: (filePath) => ipcRenderer.invoke('open-path', filePath),
  importWordTables: () => ipcRenderer.invoke('import-word-tables'),

  // Settings > Performance
  perfConfigure: (config) => ipcRenderer.invoke('perf-configure', config),
  perfUsage: () => ipcRenderer.invoke('perf-usage'),

  // Floating island
  islandConfigure: (config) => ipcRenderer.invoke('island-configure', config),
  islandState: (state) => ipcRenderer.send('island-state', state),
  onIslandAction: (callback) => ipcRenderer.on('island-action', (event, action) => callback(action)),

  // Desktop mode (a dashboard on the wallpaper)
  desktopConfigure: (config) => ipcRenderer.invoke('desktop-configure', config),
  desktopState: (state) => ipcRenderer.send('desktop-state', state),

  // About
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  getUpdateStatus: () => ipcRenderer.invoke('get-update-status'),
  onUpdateStatus: (callback) => ipcRenderer.on('update-status', (event, status) => callback(status)),
  updateDownload: () => ipcRenderer.invoke('update-download'),
  updateInstall: () => ipcRenderer.invoke('update-install'),

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

