const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { app, BrowserWindow, ipcMain, desktopCapturer, session, screen, clipboard } = require('electron');
const { machineIdSync } = require('node-machine-id');

let CONFIG_PATH; // app hazır olunca (userData yolu) belirlenecek
let mainWindow;
let psProcess;
let bridgeStopping = false;

// Ekran paylaşımı isteği geldiğinde hangi kaynağın verileceği. Renderer, monitör
// değiştirmek istediğinde önce burayı günceller, sonra getDisplayMedia'yı tekrar çağırır.
let selectedSourceId = null;

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

const DEFAULT_TURN = { url: '', username: '', credential: '' };

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const cfg = JSON.parse(raw);
    if (!cfg.trustedDevices) cfg.trustedDevices = {};
    if (!cfg.turn) cfg.turn = { ...DEFAULT_TURN };
    if (typeof cfg.clipboardSync !== 'boolean') cfg.clipboardSync = true;
    if (!('captureSourceId' in cfg)) cfg.captureSourceId = null;
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
      turn: { ...DEFAULT_TURN },
      clipboardSync: true,
      captureSourceId: null,
    };
    saveConfig(cfg);
  }
  selectedSourceId = cfg.captureSourceId;
  return cfg;
}

// TURN bilgisi host'ta tutulur ve client'a sinyalleşme sırasında iletilir; böylece
// CGNAT arkasındaki bağlantılar için client tarafında kod düzenlemek gerekmez.
function buildIceServers(cfg) {
  const servers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];
  if (cfg.turn && cfg.turn.url) {
    const entry = { urls: cfg.turn.url };
    if (cfg.turn.username) entry.username = cfg.turn.username;
    if (cfg.turn.credential) entry.credential = cfg.turn.credential;
    servers.push(entry);
  }
  return servers;
}

// ---------------- Ekran kaynakları ----------------

async function listScreenSources() {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 0, height: 0 },
  });
  const displays = screen.getAllDisplays();
  return sources.map((s, i) => {
    const display = displays.find((d) => String(d.id) === String(s.display_id));
    const size = display ? `${display.size.width}×${display.size.height}` : null;
    return {
      id: s.id,
      name: size ? `Ekran ${i + 1} — ${size}` : s.name || `Ekran ${i + 1}`,
      primary: display ? display.id === screen.getPrimaryDisplay().id : i === 0,
    };
  });
}

// ---------------- Ekran paylaşımı (onay ekranı olmadan) ----------------

function setupDisplayMediaHandler() {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      .then((sources) => {
        if (!sources.length) { callback({}); return; }
        const chosen = sources.find((s) => s.id === selectedSourceId) || sources[0];
        callback({ video: chosen, audio: 'loopback' });
      })
      .catch(() => callback({}));
  }, { useSystemPicker: false });
}

// ---------------- Pencere ----------------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 460,
    height: 760,
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
    if (bridgeStopping) return;
    console.error(`input-bridge kapandı (kod ${code}), 2sn sonra yeniden başlatılıyor...`);
    setTimeout(startInputBridge, 2000);
  });
}

function writeInput(cmd) {
  if (psProcess && psProcess.stdin && !psProcess.killed) {
    psProcess.stdin.write(JSON.stringify(cmd) + '\n');
  }
}

function stopInputBridge() {
  bridgeStopping = true;
  if (!psProcess || psProcess.killed) return;
  // Önce basılı kalan her şeyi bıraktır, sonra stdin'i kapatarak köprüyü düzgün sonlandır.
  writeInput({ t: 'r' });
  try { psProcess.stdin.end(); } catch { /* zaten kapanmış olabilir */ }
}

// ---------------- Uygulama yaşam döngüsü ----------------

app.whenReady().then(() => {
  CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
  ensureConfig();
  setupDisplayMediaHandler();
  startInputBridge();
  createWindow();
});

app.on('before-quit', stopInputBridge);
app.on('window-all-closed', () => app.quit());

// ---------------- IPC ----------------

function publicConfig(cfg) {
  return {
    hostCode: cfg.hostCode,
    signalingUrl: cfg.signalingUrl,
    hasPassword: !!cfg.hostPassword,
    turn: cfg.turn,
    clipboardSync: cfg.clipboardSync,
    captureSourceId: cfg.captureSourceId,
    iceServers: buildIceServers(cfg),
    trustedDevices: Object.entries(cfg.trustedDevices).map(([hwid, info]) => ({
      hwid,
      name: info.name,
      addedAt: info.addedAt,
      lastSeen: info.lastSeen,
    })),
  };
}

ipcMain.handle('get-config', () => publicConfig(loadConfig()));

ipcMain.handle('save-settings', (_e, { password, signalingUrl, turn, clipboardSync }) => {
  const cfg = loadConfig();
  if (typeof password === 'string' && password.length > 0) cfg.hostPassword = password;
  if (typeof signalingUrl === 'string' && signalingUrl.length > 0) cfg.signalingUrl = signalingUrl;
  if (turn && typeof turn === 'object') {
    cfg.turn = {
      url: typeof turn.url === 'string' ? turn.url.trim() : '',
      username: typeof turn.username === 'string' ? turn.username : '',
      credential: typeof turn.credential === 'string' ? turn.credential : '',
    };
  }
  if (typeof clipboardSync === 'boolean') cfg.clipboardSync = clipboardSync;
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

ipcMain.handle('list-sources', () => listScreenSources());

ipcMain.handle('set-capture-source', (_e, sourceId) => {
  const cfg = loadConfig();
  cfg.captureSourceId = sourceId || null;
  selectedSourceId = cfg.captureSourceId;
  saveConfig(cfg);
  return publicConfig(cfg);
});

ipcMain.handle('clipboard-read', () => clipboard.readText());
ipcMain.on('clipboard-write', (_e, text) => {
  if (typeof text === 'string') clipboard.writeText(text);
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
