const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { app, BrowserWindow, ipcMain, desktopCapturer, session, screen, clipboard, Tray, Menu, nativeImage } = require('electron');
const { machineIdSync } = require('node-machine-id');

let CONFIG_PATH; // app hazır olunca (userData yolu) belirlenecek
let tray = null;
let isQuitting = false;
let trayStatus = 'Bekleniyor';
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
    if (!['auto', 'stun-only', 'turn-only'].includes(cfg.iceMode)) cfg.iceMode = 'auto';
    if (typeof cfg.minimizeToTray !== 'boolean') cfg.minimizeToTray = true;
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
      iceMode: 'auto',
      minimizeToTray: true,
      captureSourceId: null,
    };
    saveConfig(cfg);
  }
  selectedSourceId = cfg.captureSourceId;
  return cfg;
}

// TURN bilgisi host'ta tutulur ve client'a sinyalleşme sırasında iletilir; böylece
// CGNAT arkasındaki bağlantılar için client tarafında kod düzenlemek gerekmez.
const PUBLIC_STUN = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

// iceMode:
//   'auto'      -> STUN + TURN birlikte; doğrudan bağlantı denenir, olmazsa TURN'e düşer (varsayılan)
//   'stun-only' -> yalnızca STUN; TURN hiç kullanılmaz (en düşük gecikme, CGNAT'te bağlanamayabilir)
//   'turn-only' -> her şey TURN üzerinden röle edilir (client'ta iceTransportPolicy: 'relay')
function buildIceServers(cfg) {
  const mode = cfg.iceMode || 'auto';
  const turnEntry = (() => {
    if (!cfg.turn || !cfg.turn.url) return null;
    const entry = { urls: cfg.turn.url };
    if (cfg.turn.username) entry.username = cfg.turn.username;
    if (cfg.turn.credential) entry.credential = cfg.turn.credential;
    return entry;
  })();

  if (mode === 'stun-only') return [...PUBLIC_STUN];

  if (mode === 'turn-only') {
    // TURN tanımlı değilse relay zorlanamaz; sessizce STUN'a düşmek yerine
    // en azından STUN döndürüp GUI'de uyarıyoruz.
    return turnEntry ? [turnEntry] : [...PUBLIC_STUN];
  }

  const servers = [...PUBLIC_STUN];
  if (turnEntry) servers.push(turnEntry);
  return servers;
}

// Client'a "sadece röle kullan" demek için gereken politika.
function iceTransportPolicy(cfg) {
  const mode = cfg.iceMode || 'auto';
  const hasTurn = !!(cfg.turn && cfg.turn.url);
  return mode === 'turn-only' && hasTurn ? 'relay' : 'all';
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
      // Pencere küçültüldüğünde/arkada kaldığında Chromium normalde renderer'ı
      // yavaşlatır; veri kanalı da renderer'da olduğu için client'ın girdileri
      // işlenmez ve kontrol "donar". Bu kapatılmadan uzaktan kumanda güvenilir olmaz.
      backgroundThrottling: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile('index.html');

  // Simge durumuna küçültünce görev çubuğunda yer kaplamasın, tepsiye insin.
  mainWindow.on('minimize', (e) => {
    const cfg = loadConfig();
    if (cfg && cfg.minimizeToTray) {
      e.preventDefault();
      mainWindow.hide();
      mainWindow.setSkipTaskbar(true);
    }
  });

  // Kapatma düğmesi de uygulamayı sonlandırmasın: host arka planda çalışmaya
  // devam etmeli, yoksa uzaktan bağlanılamaz. Gerçek çıkış tepsi menüsünden.
  mainWindow.on('close', (e) => {
    if (isQuitting) return;
    const cfg = loadConfig();
    if (cfg && cfg.minimizeToTray) {
      e.preventDefault();
      mainWindow.hide();
      mainWindow.setSkipTaskbar(true);
    }
  });

  // Pencere gerçekten yok edildiğinde (tepsiye inme kapalıyken X'e basılması,
  // ya da çıkış sırasında) referansı temizle. Aksi halde tepsi menüsündeki
  // "Pencereyi Göster" yok edilmiş bir BrowserWindow'a erişmeye çalışıp çöker.
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ---------------- Sistem tepsisi ----------------

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) { createWindow(); }
  mainWindow.setSkipTaskbar(false);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function buildTrayMenu() {
  const cfg = loadConfig() || {};
  return Menu.buildFromTemplate([
    { label: `Kod: ${cfg.hostCode || '-'}`, enabled: false },
    { label: trayStatus, enabled: false },
    { type: 'separator' },
    { label: 'Pencereyi Göster', click: showMainWindow },
    {
      label: 'Kodu Panoya Kopyala',
      click: () => { if (cfg.hostCode) clipboard.writeText(cfg.hostCode); },
    },
    { type: 'separator' },
    {
      label: 'Çıkış',
      click: () => { isQuitting = true; app.quit(); },
    },
  ]);
}

function refreshTray() {
  if (!tray) return;
  const cfg = loadConfig() || {};
  tray.setToolTip(`GameLink Host — ${cfg.hostCode || '-'} (${trayStatus})`);
  tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'tray-icon.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.on('double-click', showMainWindow);
  refreshTray();
}

// ---------------- Girdi enjeksiyon köprüsü (PowerShell, kalıcı süreç) ----------------

function startInputBridge() {
  psProcess = spawn('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    // Paketlenmiş .exe'de kaynaklar app.asar arşivinin içinde durur ve PowerShell
    // arşivin içindeki bir yolu açamaz. asarUnpack sayesinde bu script gerçek bir
    // dosya olarak app.asar.unpacked altına çıkarılıyor; yolu ona çeviriyoruz.
    '-File', path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'input-bridge.ps1'),
  ]);

  psProcess.stdout.on('data', (d) => console.log('[input-bridge]', d.toString().trim()));
  psProcess.stderr.on('data', (d) => console.error('[input-bridge ERR]', d.toString().trim()));
  // Köprü süreci ölmüşken stdin'e yazmak EPIPE fırlatır; yakalanmazsa tüm uygulama
  // çöker. Burada yutup 'exit' işleyicisinin yeniden başlatmasına bırakıyoruz.
  psProcess.on('error', (err) => console.error('[input-bridge] süreç hatası:', err.message));
  psProcess.stdin.on('error', (err) => console.error('[input-bridge] stdin hatası:', err.message));
  psProcess.on('exit', (code) => {
    if (bridgeStopping) return;
    console.error(`input-bridge kapandı (kod ${code}), 2sn sonra yeniden başlatılıyor...`);
    setTimeout(startInputBridge, 2000);
  });
}

function writeInput(cmd) {
  if (!psProcess || psProcess.killed) return;
  const stdin = psProcess.stdin;
  if (!stdin || !stdin.writable || stdin.destroyed) return;
  try {
    stdin.write(JSON.stringify(cmd) + '\n');
  } catch (err) {
    console.error('[input-bridge] yazma başarısız:', err.message);
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

// Pencere simge durumuna küçültüldüğünde ya da başka bir pencere üstünü kapattığında
// Chromium süreci "arka plan" sayıp zamanlayıcıları/işlemeyi kısar. Uzaktan kumanda
// için bu ölümcül: client'ın gönderdiği fare/klavye paketleri geç işlenir veya hiç
// işlenmez. Üç bayrak da bu kısıtlamaları kapatıyor.
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

app.whenReady().then(() => {
  CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
  ensureConfig();
  setupDisplayMediaHandler();
  startInputBridge();
  createWindow();
  createTray();
});

app.on('before-quit', () => {
  isQuitting = true;
  stopInputBridge();
});

// Tepsiye inmişken pencere kapansa bile uygulama yaşamaya devam etsin;
// aksi halde host çevrimdışı olur ve uzaktan bağlanılamaz.
app.on('window-all-closed', () => {
  if (isQuitting) app.quit();
});

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
    iceMode: cfg.iceMode || 'auto',
    iceTransportPolicy: iceTransportPolicy(cfg),
    trustedDevices: Object.entries(cfg.trustedDevices).map(([hwid, info]) => ({
      hwid,
      name: info.name,
      addedAt: info.addedAt,
      lastSeen: info.lastSeen,
    })),
  };
}

ipcMain.handle('get-config', () => publicConfig(loadConfig()));

ipcMain.handle('save-settings', (_e, { password, signalingUrl, turn, clipboardSync, iceMode, minimizeToTray }) => {
  const cfg = loadConfig();
  if (typeof password === 'string' && password.length > 0) cfg.hostPassword = password;
  if (typeof signalingUrl === 'string' && signalingUrl.length > 0) cfg.signalingUrl = signalingUrl;
  if (['auto', 'stun-only', 'turn-only'].includes(iceMode)) cfg.iceMode = iceMode;
  if (turn && typeof turn === 'object') {
    cfg.turn = {
      url: typeof turn.url === 'string' ? turn.url.trim() : '',
      username: typeof turn.username === 'string' ? turn.username : '',
      credential: typeof turn.credential === 'string' ? turn.credential : '',
    };
  }
  if (typeof clipboardSync === 'boolean') cfg.clipboardSync = clipboardSync;
  if (typeof minimizeToTray === 'boolean') cfg.minimizeToTray = minimizeToTray;
  saveConfig(cfg);
  refreshTray();
  return publicConfig(cfg);
});

ipcMain.handle('regenerate-code', () => {
  const cfg = loadConfig();
  cfg.hostCode = generateRandomCode();
  saveConfig(cfg);
  refreshTray();
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
ipcMain.on('set-status', (_e, status) => {
  console.log('[STATUS]', status);
  if (typeof status === 'string' && status.length) {
    trayStatus = status;
    refreshTray();
  }
});
