const { contextBridge, ipcRenderer } = require('electron');

// Tema tercihi sayfa çizilmeden önce lazım (bkz. index.html <head> script'i), yoksa
// açılışta yanlış renkli bir kare görünüyor. Ayarlar main process'te bellekte
// olduğu için bu senkron çağrı mikrosaniye mertebesinde ve yalnızca bir kez yapılıyor.
const initialTheme = ipcRenderer.sendSync('get-initial-theme');

contextBridge.exposeInMainWorld('clientAPI', {
  initialTheme,

  getInitData: () => ipcRenderer.invoke('get-init-data'),
  saveConnection: (conn) => ipcRenderer.invoke('save-connection', conn),
  removeConnection: (id) => ipcRenderer.invoke('remove-connection', id),

  getPrefs: () => ipcRenderer.invoke('get-prefs'),
  savePrefs: (partial) => ipcRenderer.invoke('save-prefs', partial),

  readClipboard: () => ipcRenderer.invoke('clipboard-read'),
  writeClipboard: (text) => ipcRenderer.send('clipboard-write', text),

  setFullscreen: (on) => ipcRenderer.send('set-fullscreen', on),
});
