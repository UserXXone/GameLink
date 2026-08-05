const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { app, BrowserWindow, ipcMain, clipboard, Tray, Menu, nativeImage, nativeTheme } = require('electron');
const { machineIdSync } = require('node-machine-id');

let CONFIG_PATH;
let mainWindow;
let cachedHwid = null;
// Ayar dosyasını yalnızca bu süreç yazıyor; bellekte tutmak her pencere olayında
// ve her IPC çağrısında yapılan senkron disk okumasını ortadan kaldırıyor.
let configCache = null;
let tray = null;
let isQuitting = false;

// HWID, makine kimliğinden türetiliyor ve bunun için node-machine-id senkron bir
// alt süreç (REG QUERY) çalıştırıyor - ilk çağrıda 150-300 ms. Sonuç ayar dosyasına
// yazılıyor, sonraki açılışlarda alt süreç hiç çalışmıyor.
function getHwid() {
  if (cachedHwid) return cachedHwid;
  const cfg = loadConfig();
  if (typeof cfg.hwid === 'string' && cfg.hwid.length === 64) {
    cachedHwid = cfg.hwid;
    return cachedHwid;
  }
  const id = machineIdSync({ original: true });
  cachedHwid = crypto.createHash('sha256').update(id).digest('hex');
  cfg.hwid = cachedHwid;
  saveConfig(cfg);
  return cachedHwid;
}

// Not Defteri'nin "UTF-8 BOM'lu" kaydı ve PowerShell'in Out-File'ı dosyanın başına
// görünmez bir işaret (BOM) koyar; JSON.parse bunu kabul etmez. Kırpılmazsa tamamen
// geçerli bir ayar dosyası "bozuk" sayılıp sıfırlanıyordu.
const stripBom = (s) => (s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s);

function loadConfig() {
  if (configCache) return configCache;

  let cfg = null;
  let raw = null;
  try {
    raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  } catch { /* dosya henüz yok: aşağıda boş yapılandırma kurulur */ }

  if (raw !== null) {
    try {
      cfg = JSON.parse(stripBom(raw));
    } catch (err) {
      // Dosya var ama okunamıyor. Sessizce üzerine yazmak kayıtlı bağlantıları ve
      // tercihleri yok eder; önce yedeğe alıyoruz.
      try {
        const backup = `${CONFIG_PATH}.bozuk-${new Date().toISOString().replace(/[:.]/g, '-')}`;
        fs.copyFileSync(CONFIG_PATH, backup);
        console.error(`[config] ayar dosyası okunamadı (${err.message}); yedeklendi: ${backup}`);
      } catch (e) {
        console.error('[config] bozuk ayar dosyası yedeklenemedi:', e.message);
      }
    }
  }

  if (!cfg || typeof cfg !== 'object') cfg = {};
  if (!Array.isArray(cfg.savedConnections)) cfg.savedConnections = [];
  configCache = cfg;
  return cfg;
}

function saveConfig(cfg) {
  configCache = cfg;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

function currentTheme() {
  const prefs = loadConfig().prefs || {};
  return prefs.theme || 'system';
}

// Pencere arka planı ilk kareden önce doğru temaya ayarlanır; aksi halde açılışta
// beyaz bir kare "flaş" ediyordu.
function themeBackground(theme) {
  const dark = theme === 'dark' || (theme !== 'light' && nativeTheme.shouldUseDarkColors);
  return dark ? '#0b0d12' : '#eef1fa';
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 680,
    minWidth: 760,
    minHeight: 500,
    title: 'GameLink',
    show: false,
    backgroundColor: themeBackground(currentTheme()),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile('index.html');
  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  });

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
  // Tepsi ve HWID hesabı açılış yolunu tıkamasın: pencere yaratıldıktan sonraki
  // olay döngüsü turuna bırakılıyor. HWID'yi burada "ısıtmak", renderer'ın ilk
  // get-init-data çağrısının alt süreç beklemesini de önlüyor.
  setImmediate(() => {
    createTray();
    try { getHwid(); } catch { /* ilk bağlantıda yeniden denenir */ }
  });
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
  hideUiCompletely: false,             // butonları tamamen gizle
  mode: 'game',
  quality: 'balanced',
  minimizeToTray: true,          // küçültünce görev çubuğu yerine tepsiye insin
  cursorMode: 'single',          // 'single' = host'un imlecini sür, 'ghost' = ikinci imleç
  theme: 'system',               // 'system' | 'light' | 'dark'
};

ipcMain.handle('get-prefs', () => {
  const cfg = loadConfig();
  return { ...DEFAULT_PREFS, ...(cfg.prefs || {}) };
});

ipcMain.handle('save-prefs', (_e, partial) => {
  const cfg = loadConfig();
  cfg.prefs = { ...DEFAULT_PREFS, ...(cfg.prefs || {}), ...(partial || {}) };
  saveConfig(cfg);
  if (partial && partial.theme && mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.setBackgroundColor(themeBackground(partial.theme)); } catch { /* eski Electron */ }
  }
  return cfg.prefs;
});

// Tema, sayfanın ilk satırı çizilmeden bilinmeli (bkz. preload.js). Ayarlar bellekte
// olduğu için bu senkron çağrının maliyeti yok denecek kadar az.
ipcMain.on('get-initial-theme', (e) => { e.returnValue = currentTheme(); });

ipcMain.handle('clipboard-read', () => clipboard.readText());
ipcMain.on('clipboard-write', (_e, text) => {
  if (typeof text === 'string') clipboard.writeText(text);
});

ipcMain.on('set-fullscreen', (_e, on) => {
  if (mainWindow) mainWindow.setFullScreen(!!on);
});
