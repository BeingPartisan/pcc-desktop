// Bridge for the desktop music visualiser window (see the visualiser part of island.js).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('viz', {
  onConfig: (callback) => ipcRenderer.on('viz-config', (event, config) => callback(config)),
  // the cover of what's playing, as a data: URL ('' when there isn't one)
  onCover: (callback) => ipcRenderer.on('viz-cover', (event, url) => callback(url)),
  onMedia: (callback) => ipcRenderer.on('viz-media', (event, media) => callback(media)),
  // true while music plays (and a little after): keep listening to the sound
  onListen: (callback) => ipcRenderer.on('viz-listen', (event, on) => callback(on)),
  // true while the shapes can be seen: draw them
  onActive: (callback) => ipcRenderer.on('viz-active', (event, on) => callback(on)),
});
