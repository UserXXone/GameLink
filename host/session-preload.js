const { contextBridge, ipcRenderer } = require('electron');

// Oturum penceresi WebRTC'ye hiç dokunmaz: veri kanalları ana pencerenin
// renderer'ında yaşıyor. Bu pencere yalnızca olay alır ve eylem gönderir; ana
// süreç ikisi arasında köprü kurar.
const initialTheme = ipcRenderer.sendSync('get-initial-theme');
const appVersion = ipcRenderer.sendSync('get-app-version');

let eventHandler = null;
ipcRenderer.on('session-event', (_e, payload) => {
  if (eventHandler) eventHandler(payload);
});

contextBridge.exposeInMainWorld('sessionAPI', {
  initialTheme,
  appVersion,
  onEvent: (handler) => { eventHandler = handler; },
  send: (payload) => ipcRenderer.send('session-action', payload),
  close: () => ipcRenderer.send('session-close'),
  reveal: (p) => ipcRenderer.send('reveal-path', p),
  pickFiles: () => ipcRenderer.invoke('file-pick'),
});
