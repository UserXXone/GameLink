const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { app, BrowserWindow, ipcMain, desktopCapturer, session } = require('electron');
const { machineIdSync } = require('node-machine-id');

let CONFIG_PATH; // app hazır olunca (userData yolu) belirlenecek
let mainWindow;
let psProcess;

// ---------------- Config yönetimi ----------------

function generateCodeFromMachine() {
  const id = machineIdSync({ original: true });
  const hash = crypto.createHash('sha256').update(id).digest('hex').toUpperCase();
  return `${hash.slice(0, 4)}-${hash.slice(4, 8)}`;
}

function generateRandomCode() {
  const bytes = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `${bytes.slice(0, 4)}-${bytes.slice(4, 8)}`;
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const cfg = JSON.parse(raw);
    if (!cfg.trustedDevices) cfg.trustedDevices = {};
    return cfg;
  } catch {
    return null;
  }
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

function ensureConfig() {
  let cfg = loadConfig();
  if (!cfg) {
    cfg = {
      hostCode: generateCodeFromMachine(),
      hostPassword: '',
      signalingUrl: 'wss://sizin-domaininiz.com',
      trustedDevices: {},
    };
    saveConfig(cfg);
  }
  return cfg;
}

// ---------------- Ekran paylaşımı (onay ekranı olmadan) ----------------

function setupDisplayMediaHandler() {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      if (!sources.length) { callback({}); return; }
      callback({ video: sources[0], audio: 'loopback' });
    }).catch(() => callback({}));
  }, { useSystemPicker: false });
}

// ---------------- Pencere ----------------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 440,
    height: 680,
    resizable: false,
    title: 'GameLink Host',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile('index.html');
}

// ---------------- Girdi enjeksiyon köprüsü (PowerShell, kalıcı süreç) ----------------

function startInputBridge() {
  psProcess = spawn('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-File', path.join(__dirname, 'input-bridge.ps1'),
  ]);

  psProcess.stdout.on('data', (d) => console.log('[input-bridge]', d.toString().trim()));
  psProcess.stderr.on('data', (d) => console.error('[input-bridge ERR]', d.toString().trim()));
  psProcess.on('exit', (code) => {
    console.error(`input-bridge kapandı (kod ${code}), 2sn sonra yeniden başlatılıyor...`);
    setTimeout(startInputBridge, 2000);
  });
}

function writeInput(cmd) {
  if (psProcess && psProcess.stdin && !psProcess.killed) {
    psProcess.stdin.write(JSON.stringify(cmd) + '\n');
  }
}

// ---------------- Uygulama yaşam döngüsü ----------------

app.whenReady().then(() => {
  CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
  ensureConfig();
  setupDisplayMediaHandler();
  startInputBridge();
  createWindow();
});

app.on('window-all-closed', () => app.quit());

// ---------------- IPC ----------------

function publicConfig(cfg) {
  return {
    hostCode: cfg.hostCode,
    signalingUrl: cfg.signalingUrl,
    hasPassword: !!cfg.hostPassword,
    trustedDevices: Object.entries(cfg.trustedDevices).map(([hwid, info]) => ({
      hwid,
      name: info.name,
      addedAt: info.addedAt,
      lastSeen: info.lastSeen,
    })),
  };
}

ipcMain.handle('get-config', () => publicConfig(loadConfig()));

ipcMain.handle('save-settings', (_e, { password, signalingUrl }) => {
  const cfg = loadConfig();
  if (typeof password === 'string' && password.length > 0) cfg.hostPassword = password;
  if (typeof signalingUrl === 'string' && signalingUrl.length > 0) cfg.signalingUrl = signalingUrl;
  saveConfig(cfg);
  return publicConfig(cfg);
});

ipcMain.handle('regenerate-code', () => {
  const cfg = loadConfig();
  cfg.hostCode = generateRandomCode();
  saveConfig(cfg);
  return publicConfig(cfg);
});

ipcMain.handle('remove-trusted-device', (_e, hwid) => {
  const cfg = loadConfig();
  delete cfg.trustedDevices[hwid];
  saveConfig(cfg);
  return publicConfig(cfg);
});

// Bir client bağlanmak istediğinde host'un kabul/red kararı burada verilir.
// Bu sayede parola/HWID karşılaştırması hep main process'te (daha güvenli) kalır.
ipcMain.handle('evaluate-join', (_e, { hwid, deviceName, passwordHash }) => {
  const cfg = loadConfig();
  const now = new Date().toISOString();

  if (hwid && cfg.trustedDevices[hwid]) {
    cfg.trustedDevices[hwid].lastSeen = now;
    saveConfig(cfg);
    return { accept: true, config: publicConfig(cfg) };
  }

  if (!cfg.hostPassword) {
    return { accept: false, reason: 'Host parolası ayarlanmamış.', config: publicConfig(cfg) };
  }

  const expectedHash = crypto.createHash('sha256').update(cfg.hostPassword).digest('hex');
  if (passwordHash && passwordHash === expectedHash) {
    if (hwid) {
      cfg.trustedDevices[hwid] = { name: deviceName || 'Adsız cihaz', addedAt: now, lastSeen: now };
      saveConfig(cfg);
    }
    return { accept: true, config: publicConfig(cfg) };
  }

  return { accept: false, reason: 'Parola hatalı.', config: publicConfig(cfg) };
});

ipcMain.on('input', (_e, cmd) => writeInput(cmd));
ipcMain.on('set-status', (_e, status) => console.log('[STATUS]', status));
