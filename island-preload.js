// Bridge for the floating island window (see island.js).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('island', {
  onState: (callback) => ipcRenderer.on('island-state', (event, state) => callback(state)),
  onMedia: (callback) => ipcRenderer.on('island-media', (event, media) => callback(media)),
  onPosition: (callback) => ipcRenderer.on('island-position', (event, position) => callback(position)),
  onUpdate: (callback) => ipcRenderer.on('island-update', (event, status) => callback(status)),
  onNudge: (callback) => ipcRenderer.on('island-nudge', (event, nudge) => callback(nudge)),
  // the text box asks for the keyboard while it's being typed in
  setFocus: (wanted) => ipcRenderer.send('island-focus', !!wanted),
  // true while the pointer is over the island, so clicks elsewhere in its window pass through
  setHover: (inside) => ipcRenderer.send('island-hover', !!inside),
  action: (action) => ipcRenderer.send('island-action', action),
});
