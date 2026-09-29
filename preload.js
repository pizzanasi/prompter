const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('prompter', {
  minimize: () => ipcRenderer.send('win:minimize'),
  close: () => ipcRenderer.send('win:close'),
  setAlwaysOnTop: (on) => ipcRenderer.send('win:always-on-top', !!on),
  setContentProtection: (on) => ipcRenderer.send('win:content-protection', !!on),
  resizeStart: (edge) => ipcRenderer.send('win:resize-start', edge),
  resizeEnd: () => ipcRenderer.send('win:resize-end'),
});
