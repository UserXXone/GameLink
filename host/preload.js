const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hostAPI', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveSettings: (partial) => ipcRenderer.invoke('save-settings', partial),
  regenerateCode: () => ipcRenderer.invoke('regenerate-code'),
  removeTrustedDevice: (hwid) => ipcRenderer.invoke('remove-trusted-device', hwid),
  evaluateJoin: (hwid, deviceName, passwordHash) =>
    ipcRenderer.invoke('evaluate-join', { hwid, deviceName, passwordHash }),

  listSources: () => ipcRenderer.invoke('list-sources'),
  setCaptureSource: (sourceId) => ipcRenderer.invoke('set-capture-source', sourceId),

  readClipboard: () => ipcRenderer.invoke('clipboard-read'),
  writeClipboard: (text) => ipcRenderer.send('clipboard-write', text),

  injectMouseMove: (dx, dy) => ipcRenderer.send('input', { t: 'm', dx, dy }),
  injectMouseButton: (btn, down) => ipcRenderer.send('input', { t: 'b', btn, down }),
  injectWheel: (delta, horizontal) => ipcRenderer.send('input', { t: 'w', delta, h: !!horizontal }),
  injectKey: (scan, ext, down) => ipcRenderer.send('input', { t: 'k', scan, ext, down }),
  releaseAllInputs: () => ipcRenderer.send('input', { t: 'r' }),

  setStatus: (s) => ipcRenderer.send('set-status', s),
});
