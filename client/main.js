const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { app, BrowserWindow, ipcMain, clipboard } = require('electron');
const { machineIdSync } = require('node-machine-id');

let CONFIG_PATH;
let mainWindow;
let cachedHwid = null;

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
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
  createWindow();
});

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

ipcMain.handle('clipboard-read', () => clipboard.readText());
ipcMain.on('clipboard-write', (_e, text) => {
  if (typeof text === 'string') clipboard.writeText(text);
});

ipcMain.on('set-fullscreen', (_e, on) => {
  if (mainWindow) mainWindow.setFullScreen(!!on);
});
