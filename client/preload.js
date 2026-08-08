const { contextBridge, ipcRenderer } = require('electron');

// Tema tercihi sayfa çizilmeden önce lazım (bkz. index.html <head> script'i), yoksa
// açılışta yanlış renkli bir kare görünüyor. Ayarlar main process'te bellekte
// olduğu için bu senkron çağrı mikrosaniye mertebesinde ve yalnızca bir kez yapılıyor.
const initialTheme = ipcRenderer.sendSync('get-initial-theme');
const appVersion = ipcRenderer.sendSync('get-app-version');

const listeners = new Map();
function on(channel, handler) { listeners.set(channel, handler); }
for (const channel of ['update-state']) {
  ipcRenderer.on(channel, (_e, payload) => {
    const handler = listeners.get(channel);
    if (handler) handler(payload);
  });
}

contextBridge.exposeInMainWorld('clientAPI', {
  initialTheme,
  appVersion,

  getInitData: () => ipcRenderer.invoke('get-init-data'),
  saveConnection: (conn) => ipcRenderer.invoke('save-connection', conn),
  removeConnection: (id) => ipcRenderer.invoke('remove-connection', id),

  getPrefs: () => ipcRenderer.invoke('get-prefs'),
  savePrefs: (partial) => ipcRenderer.invoke('save-prefs', partial),

  readClipboard: () => ipcRenderer.invoke('clipboard-read'),
  writeClipboard: (text) => ipcRenderer.send('clipboard-write', text),

  setFullscreen: (on_) => ipcRenderer.send('set-fullscreen', on_),

  // ---- v4.0 ----
  toggleMaximize: () => ipcRenderer.send('toggle-maximize'),
  fitWindowTo: (width, height) => ipcRenderer.invoke('fit-window-to', { width, height }),

  setAutoStart: (enabled) => ipcRenderer.invoke('set-auto-start', enabled),
  chooseDownloadDir: () => ipcRenderer.invoke('choose-download-dir'),
  exportConfig: () => ipcRenderer.invoke('export-config'),
  importConfig: () => ipcRenderer.invoke('import-config'),
  askFileAccept: (info) => ipcRenderer.invoke('ask-file-accept', info),
  openLogFolder: () => ipcRenderer.send('open-log-folder'),

  checkUpdate: () => ipcRenderer.invoke('check-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  getUpdateState: () => ipcRenderer.invoke('get-update-state'),
  onUpdateState: (handler) => on('update-state', handler),

  // Dosya aktarımı ve ekran kaydı için ana süreçteki dosya G/Ç'si.
  // İsimler host tarafıyla birebir aynı: file-transfer.js iki tarafta da çalışır.
  fileIO: {
    pickFiles: () => ipcRenderer.invoke('file-pick'),
    openRead: (filePath) => ipcRenderer.invoke('file-open-read', filePath),
    readChunk: (handle, len) => ipcRenderer.invoke('file-read-chunk', { handle, len }),
    closeRead: (handle) => ipcRenderer.send('file-close-read', handle),
    openWrite: (name, dir) => ipcRenderer.invoke('file-open-write', { name, dir }),
    writeChunk: (handle, data) => ipcRenderer.invoke('file-write-chunk', { handle, data }),
    closeWrite: (handle) => ipcRenderer.invoke('file-close-write', handle),
    abortWrite: (handle) => ipcRenderer.send('file-abort-write', handle),
    targetDir: (kind) => ipcRenderer.invoke('file-target-dir', kind),
    reveal: (p) => ipcRenderer.send('reveal-path', p),
    open: (p) => ipcRenderer.send('open-path', p),
  },
});
