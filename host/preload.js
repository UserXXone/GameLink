const { contextBridge, ipcRenderer } = require('electron');

// Tema tercihi sayfanın ilk satırı çizilmeden önce bilinmeli, yoksa açılışta yanlış
// renkli bir kare görünüyor. sendSync burada bilinçli bir tercih: ayarlar main
// process'te zaten bellekte, çağrı mikrosaniye mertebesinde ve preload sırasında
// bir kez yapılıyor.
const initialTheme = ipcRenderer.sendSync('get-initial-theme');
const appVersion = ipcRenderer.sendSync('get-app-version');

// Main process'ten renderer'a itilen olaylar. Her biri tek bir dinleyiciye
// bağlanıyor; renderer callback'i sonradan atayabilsin diye küçük bir kayıt tablosu.
const listeners = new Map();
function on(channel, handler) { listeners.set(channel, handler); }
for (const channel of ['sysinfo-static', 'sysinfo-tick', 'update-state', 'session-action']) {
  ipcRenderer.on(channel, (_e, payload) => {
    const handler = listeners.get(channel);
    if (handler) handler(payload);
  });
}

contextBridge.exposeInMainWorld('hostAPI', {
  initialTheme,
  appVersion,

  getConfig: () => ipcRenderer.invoke('get-config'),
  saveSettings: (partial) => ipcRenderer.invoke('save-settings', partial),
  regenerateCode: () => ipcRenderer.invoke('regenerate-code'),
  removeTrustedDevice: (hwid) => ipcRenderer.invoke('remove-trusted-device', hwid),
  evaluateJoin: (hwid, deviceName, passwordHash) =>
    ipcRenderer.invoke('evaluate-join', { hwid, deviceName, passwordHash }),

  listSources: () => ipcRenderer.invoke('list-sources'),
  setCaptureSource: (sourceId) => ipcRenderer.invoke('set-capture-source', sourceId),
  setCaptureAudio: (enabled) => ipcRenderer.send('set-capture-audio', enabled),

  readClipboard: () => ipcRenderer.invoke('clipboard-read'),
  writeClipboard: (text) => ipcRenderer.send('clipboard-write', text),

  injectMouseMove: (dx, dy) => ipcRenderer.send('input', { t: 'm', dx, dy }),
  injectMouseButton: (btn, down) => ipcRenderer.send('input', { t: 'b', btn, down }),
  injectWheel: (delta, horizontal) => ipcRenderer.send('input', { t: 'w', delta, h: !!horizontal }),
  injectKey: (scan, ext, down) => ipcRenderer.send('input', { t: 'k', scan, ext, down }),
  releaseAllInputs: () => ipcRenderer.send('input', { t: 'r' }),

  // İkinci imleç: konum 0..1 oranlı gelir, gerçek piksele main process çevirir.
  setGhostMode: (on_) => ipcRenderer.send('ghost-mode', !!on_),
  ghostMove: (u, v) => ipcRenderer.send('ghost-move', { u, v }),
  ghostButton: (btn, down) => ipcRenderer.send('ghost-button', { btn, down }),
  ghostWheel: (delta, horizontal) => ipcRenderer.send('ghost-wheel', { delta, h: !!horizontal }),

  setStatus: (s) => ipcRenderer.send('set-status', s),

  // ---- v4.0 ----
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

  listDisplayModes: () => ipcRenderer.invoke('list-display-modes'),
  setDisplayMode: (w, h, hz) => ipcRenderer.invoke('set-display-mode', { w, h, hz }),
  restoreDisplayMode: () => ipcRenderer.invoke('restore-display-mode'),

  // Oturum penceresi köprüsü: WebRTC bu renderer'da, arayüz ayrı pencerede.
  sessionStart: (info) => ipcRenderer.send('session-start', info),
  sessionEnd: () => ipcRenderer.send('session-end'),
  sessionPush: (payload) => ipcRenderer.send('session-push', payload),
  onSessionAction: (handler) => on('session-action', handler),

  onSystemStatic: (handler) => on('sysinfo-static', handler),
  onSystemTick: (handler) => on('sysinfo-tick', handler),

  // Dosya aktarımı ve ekran kaydı için ana süreçteki dosya G/Ç'si.
  // İsimler client tarafıyla birebir aynı: file-transfer.js iki tarafta da çalışır.
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
