// Bridge for the floating island window (see island.js).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('island', {
  onState: (callback) => ipcRenderer.on('island-state', (event, state) => callback(state)),
  onMedia: (callback) => ipcRenderer.on('island-media', (event, media) => callback(media)),
  onPosition: (callback) => ipcRenderer.on('island-position', (event, position) => callback(position)),
  // true while the pointer is over the island, so clicks elsewhere in its window pass through
  setHover: (inside) => ipcRenderer.send('island-hover', !!inside),
  action: (action) => ipcRenderer.send('island-action', action),
});
