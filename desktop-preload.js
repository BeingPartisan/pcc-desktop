// Bridge for the Desktop mode dashboard window (see desktop.js).
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (callback) => ipcRenderer.on(channel, (event, payload) => callback(payload));

contextBridge.exposeInMainWorld('deskBridge', {
  onLayout: on('desk-layout'),   // { inset: {top,left,right,bottom}, icons: 'left'|'right', width, height }
  onState: on('desk-state'),     // the app's snapshot: classes, tasks, deadlines, mail, messages...
  onMedia: on('desk-media'),     // what's playing
  onCover: on('desk-cover'),     // its cover as a data: URL, or ''
  onUpdate: on('desk-update'),   // an app update that's available / downloading / ready, or null
  onStats: on('desk-stats'),     // CPU, memory, battery, network
  onWallpaper: on('desk-wallpaper'), // { url, fit } of the wallpaper picture, or null
  onActive: on('desk-active'),   // false while a maximised or full-screen window covers the desktop
});
