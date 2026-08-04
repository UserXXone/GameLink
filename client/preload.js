const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clientAPI', {
  getInitData: () => ipcRenderer.invoke('get-init-data'),
  saveConnection: (conn) => ipcRenderer.invoke('save-connection', conn),
  removeConnection: (id) => ipcRenderer.invoke('remove-connection', id),

  getPrefs: () => ipcRenderer.invoke('get-prefs'),
  savePrefs: (partial) => ipcRenderer.invoke('save-prefs', partial),

  readClipboard: () => ipcRenderer.invoke('clipboard-read'),
  writeClipboard: (text) => ipcRenderer.send('clipboard-write', text),

  setFullscreen: (on) => ipcRenderer.send('set-fullscreen', on),
});
