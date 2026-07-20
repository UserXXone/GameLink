const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hostAPI', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  injectMouseMove: (dx, dy) => ipcRenderer.send('input', { t: 'm', dx, dy }),
  injectMouseButton: (btn, down) => ipcRenderer.send('input', { t: 'b', btn, down }),
  injectWheel: (delta) => ipcRenderer.send('input', { t: 'w', delta }),
  injectKey: (scan, ext, down) => ipcRenderer.send('input', { t: 'k', scan, ext, down }),
  setStatus: (s) => ipcRenderer.send('set-status', s),
});
