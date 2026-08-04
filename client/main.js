const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { app, BrowserWindow, ipcMain, clipboard, Tray, Menu, nativeImage } = require('electron');
const { machineIdSync } = require('node-machine-id');

let CONFIG_PATH;
let mainWindow;
let cachedHwid = null;
let tray = null;
let isQuitting = false;

function getHwid() {
  if (cachedHwid) return cachedHwid;
  const id = machineIdSync({ original: true });
  cachedHwid = crypto.createHash('sha256').update(id).digest('hex');
  return cachedHwid;
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return { savedConnections: [] };
  }
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 640,
    minWidth: 720,
    minHeight: 480,
    title: 'GameLink',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile('index.html');

  mainWindow.on('minimize', (e) => {
    const cfg = loadConfig();
    const toTray = cfg.prefs ? cfg.prefs.minimizeToTray !== false : true;
    if (toTray) {
      e.preventDefault();
      mainWindow.hide();
      mainWindow.setSkipTaskbar(true);
    }
  });
}

// ---------------- Sistem tepsisi ----------------

function showMainWindow() {
  if (!mainWindow) return;
  mainWindow.setSkipTaskbar(false);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'tray-icon.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('GameLink');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Pencereyi Göster', click: showMainWindow },
    { type: 'separator' },
    { label: 'Çıkış', click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on('double-click', showMainWindow);
}

app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

app.whenReady().then(() => {
  CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
  createWindow();
  createTray();
});

app.on('before-quit', () => { isQuitting = true; });

app.on('window-all-closed', () => app.quit());

// ---------------- IPC ----------------

ipcMain.handle('get-init-data', () => ({
  hwid: getHwid(),
  deviceName: os.hostname(),
  savedConnections: loadConfig().savedConnections,
}));

ipcMain.handle('save-connection', (_e, conn) => {
  const cfg = loadConfig();
  const existingIndex = cfg.savedConnections.findIndex(
    (c) => c.signalingUrl === conn.signalingUrl && c.code === conn.code
  );
  const entry = {
    id: existingIndex >= 0 ? cfg.savedConnections[existingIndex].id : crypto.randomUUID(),
    label: conn.label || conn.code,
    signalingUrl: conn.signalingUrl,
    code: conn.code,
    lastUsed: new Date().toISOString(),
  };
  if (existingIndex >= 0) cfg.savedConnections[existingIndex] = entry;
  else cfg.savedConnections.unshift(entry);
  saveConfig(cfg);
  return cfg.savedConnections;
});

ipcMain.handle('remove-connection', (_e, id) => {
  const cfg = loadConfig();
  cfg.savedConnections = cfg.savedConnections.filter((c) => c.id !== id);
  saveConfig(cfg);
  return cfg.savedConnections;
});

// ---- Kullanıcı tercihleri (yakalama kısayolu, arayüz gizleme, mod/kalite) ----

const DEFAULT_PREFS = {
  releaseHotkey: 'CtrlLeft+AltLeft',  // yakalamadan çıkış kısayolu
  autoHideUi: true,                    // butonlar/ipuçları 5sn sonra gizlensin
  hideUiCompletely: false,             // yakalama sırasında butonları anında gizle
  mode: 'game',
  quality: 'balanced',
  clipboardSync: true,           // panoyu host ile eşitle
  minimizeToTray: true,          // küçültünce görev çubuğu yerine tepsiye insin
};

ipcMain.handle('get-prefs', () => {
  const cfg = loadConfig();
  return { ...DEFAULT_PREFS, ...(cfg.prefs || {}) };
});

ipcMain.handle('save-prefs', (_e, partial) => {
  const cfg = loadConfig();
  cfg.prefs = { ...DEFAULT_PREFS, ...(cfg.prefs || {}), ...(partial || {}) };
  saveConfig(cfg);
  return cfg.prefs;
});

// Tam ekran tamamen renderer'daki DOM Fullscreen API'si ile yönetiliyor
// (Keyboard Lock'un çalışması için zaten DOM tam ekranı şart). Buradan ayrıca
// BrowserWindow.setFullScreen çağırmak iki ayrı tam ekran durumu yaratıyordu.
ipcMain.handle('clipboard-read', () => clipboard.readText());
ipcMain.on('clipboard-write', (_e, text) => {
  if (typeof text === 'string') clipboard.writeText(text);
});
