const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const {
  app, BrowserWindow, ipcMain, clipboard, Tray, Menu, nativeImage, nativeTheme,
  dialog, screen, shell,
} = require('electron');
const { machineIdSync } = require('node-machine-id');

const fileIO = require('./file-io');
const platform = require('./platform');

let mainWindow;
let cachedHwid = null;
// Ayar dosyasını yalnızca bu süreç yazıyor; bellekte tutmak her pencere olayında
// ve her IPC çağrısında yapılan senkron disk okumasını ortadan kaldırıyor.
let configCache = null;
let tray = null;
let isQuitting = false;
let logger = null;
let updater = null;

const startHidden = process.argv.includes('--hidden');

// app.getPath('userData') ready beklemeden çalışıyor; sanal makine uyumluluk
// modunun donanım hızlandırmayı kapatabilmesi için ayarlara burada ihtiyaç var.
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

// Not Defteri'nin "UTF-8 BOM'lu" kaydı ve PowerShell'in Out-File'ı dosyanın başına
// görünmez bir işaret (BOM) koyar; JSON.parse bunu kabul etmez. Kırpılmazsa tamamen
// geçerli bir ayar dosyası "bozuk" sayılıp sıfırlanıyordu.
const stripBom = (s) => (s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s);

// ---- Kullanıcı tercihleri ----
const DEFAULT_PREFS = {
  releaseHotkey: 'CtrlLeft+AltLeft',  // yakalamadan çıkış kısayolu
  autoHideUi: true,                    // butonlar/ipuçları 5sn sonra gizlensin
  hideUiCompletely: false,             // butonları tamamen gizle
  mode: 'game',
  quality: 'balanced',
  minimizeToTray: true,          // küçültünce görev çubuğu yerine tepsiye insin
  cursorMode: 'single',          // 'single' = host'un imlecini sür, 'ghost' = ikinci imleç
  theme: 'system',               // 'system' | 'light' | 'dark'
  // v4.0
  fitMode: 'contain',            // 'contain' | 'fill' | 'cover' | 'actual'
  showQosHud: true,              // ağ kalitesi göstergesi
  micEnabled: false,             // mikrofonu host'a gönder
  chatEnabled: true,
  autoAcceptFiles: false,
  recordBitrate: 10,
  autoStart: false,
  autoUpdate: true,
  updateUrl: '',
  vmMode: 'auto',
  vmDetected: false,
  downloadDir: '',
};

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
  cfg.prefs = { ...DEFAULT_PREFS, ...(cfg.prefs || {}) };
  configCache = cfg;
  return cfg;
}

function saveConfig(cfg) {
  configCache = cfg;
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (err) {
    console.error('[config] yazılamadı:', err.message);
  }
}

function prefs() { return loadConfig().prefs; }

function currentTheme() { return prefs().theme || 'system'; }

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

// Pencere arka planı ilk kareden önce doğru temaya ayarlanır; aksi halde açılışta
// beyaz bir kare "flaş" ediyordu.
function themeBackground(theme) {
  const dark = theme === 'dark' || (theme !== 'light' && nativeTheme.shouldUseDarkColors);
  return dark ? '#0b0d12' : '#eef1fa';
}

// ---------------- Sanal makine uyumluluğu (ready'den ÖNCE) ----------------

const bootPrefs = prefs();
if (bootPrefs.vmMode === 'auto' && !bootPrefs.vmDetected) {
  const detection = platform.detectVirtualMachineSync();
  if (detection.detected) {
    const cfg = loadConfig();
    cfg.prefs.vmDetected = detection.vm;
    saveConfig(cfg);
  }
}

const vmCompatActive = bootPrefs.vmMode === 'on'
  || (bootPrefs.vmMode === 'auto' && prefs().vmDetected);

if (vmCompatActive) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
}

app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// Aynı anda iki client penceresi açmak kayıtlı bağlantı dosyasına iki ayrı yerden
// yazılmasına yol açar; ikinci örnek var olanı öne getirip kapanıyor.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());
}

// ---------------- Pencere ----------------

function createWindow() {
  const bounds = loadConfig().windowBounds;
  mainWindow = new BrowserWindow({
    width: (bounds && bounds.width) || 1040,
    height: (bounds && bounds.height) || 680,
    x: bounds ? bounds.x : undefined,
    y: bounds ? bounds.y : undefined,
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
  platform.attachRendererLogging(mainWindow, 'arayüz');
  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (startHidden && prefs().minimizeToTray) {
      mainWindow.setSkipTaskbar(true);
      return;
    }
    mainWindow.show();
  });

  const rememberBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized() || mainWindow.isFullScreen()) return;
    const cfg = loadConfig();
    cfg.windowBounds = mainWindow.getNormalBounds();
    saveConfig(cfg);
  };
  mainWindow.on('resized', rememberBounds);
  mainWindow.on('moved', rememberBounds);

  mainWindow.on('minimize', (e) => {
    if (prefs().minimizeToTray) {
      e.preventDefault();
      mainWindow.hide();
      mainWindow.setSkipTaskbar(true);
    }
  });

  // v4.0 düzeltmesi: pencere yok edildiğinde referans bırakılıyor. Eskiden tepsi
  // menüsü yok edilmiş pencereye dokununca "Object has been destroyed" ile çöküyordu.
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ---------------- Sistem tepsisi ----------------

function showMainWindow() {
  // v4.0 düzeltmesi: isDestroyed kontrolü eklendi (host'ta v3.1'de düzeltilmişti,
  // client'a taşınmamıştı).
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setSkipTaskbar(false);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'tray-icon.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('GameLink ' + app.getVersion());
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Pencereyi Göster', click: showMainWindow },
    { type: 'separator' },
    { label: 'Çıkış', click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on('double-click', showMainWindow);
}

// ---------------- Windows açılışında başlat ----------------
//
// Client yönetici yetkisi istemiyor, bu yüzden Görev Zamanlayıcı'ya gerek yok;
// Electron'un kendi oturum açma öğesi yeterli.

function autoStartQuery() {
  try {
    return !!app.getLoginItemSettings({ path: process.execPath }).openAtLogin;
  } catch {
    return false;
  }
}

function autoStartSet(enabled) {
  if (!app.isPackaged) return { ok: false, reason: 'Geliştirme modunda otomatik başlatma kurulamaz.' };
  if (platform.isPortableBuild()) {
    return { ok: false, reason: 'Taşınabilir sürümde otomatik başlatma kurulamaz; kurulum sürümünü kullanın.' };
  }
  try {
    app.setLoginItemSettings({
      openAtLogin: !!enabled,
      path: process.execPath,
      args: ['--hidden'],
    });
    const cfg = loadConfig();
    cfg.prefs.autoStart = autoStartQuery();
    saveConfig(cfg);
    return { ok: true, enabled: cfg.prefs.autoStart };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

// ---------------- Ayarları dışa/içe aktarma ----------------

const EXPORT_MARKER = 'gamelink-client-config';

async function exportConfig() {
  const cfg = loadConfig();
  const res = await dialog.showSaveDialog({
    title: 'GameLink ayarlarını dışa aktar',
    defaultPath: `gamelink-client-ayarlar-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'GameLink ayar dosyası', extensions: ['json'] }],
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  try {
    fs.writeFileSync(res.filePath, JSON.stringify({
      app: EXPORT_MARKER,
      formatVersion: 1,
      appVersion: app.getVersion(),
      exportedAt: new Date().toISOString(),
      data: { savedConnections: cfg.savedConnections, prefs: cfg.prefs },
    }, null, 2), 'utf8');
    return { ok: true, path: res.filePath };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

async function importConfig() {
  const res = await dialog.showOpenDialog({
    title: 'GameLink ayarlarını içe aktar',
    properties: ['openFile'],
    filters: [{ name: 'GameLink ayar dosyası', extensions: ['json'] }],
  });
  if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
  try {
    const parsed = JSON.parse(stripBom(fs.readFileSync(res.filePaths[0], 'utf8')));
    if (!parsed || parsed.app !== EXPORT_MARKER || !parsed.data) {
      return { ok: false, reason: 'Bu dosya bir GameLink client ayar dosyası değil.' };
    }
    const cfg = loadConfig();
    if (Array.isArray(parsed.data.savedConnections)) cfg.savedConnections = parsed.data.savedConnections;
    if (parsed.data.prefs && typeof parsed.data.prefs === 'object') {
      // HWID ve pencere konumu makineye özgü; taşınmıyor.
      cfg.prefs = { ...DEFAULT_PREFS, ...cfg.prefs, ...parsed.data.prefs };
      cfg.prefs.autoStart = autoStartQuery();
      cfg.prefs.vmDetected = loadConfig().prefs.vmDetected;
    }
    saveConfig(cfg);
    return { ok: true, prefs: cfg.prefs, savedConnections: cfg.savedConnections };
  } catch (err) {
    return { ok: false, reason: 'Dosya okunamadı: ' + err.message };
  }
}

// ---------------- Uygulama yaşam döngüsü ----------------

app.whenReady().then(() => {
  logger = platform.createLogger('client.log');
  if (vmCompatActive) console.log('[uyumluluk] sanal makine modu etkin: donanım hızlandırma kapalı');

  fileIO.register({
    folderName: 'GameLink',
    getDownloadDir: () => prefs().downloadDir || null,
  });

  updater = platform.createUpdater({
    getFeedUrl: () => prefs().updateUrl || '',
    notify: (state) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-state', state);
    },
  });

  createWindow();
  // Tepsi ve HWID hesabı açılış yolunu tıkamasın: pencere yaratıldıktan sonraki
  // olay döngüsü turuna bırakılıyor. HWID'yi burada "ısıtmak", renderer'ın ilk
  // get-init-data çağrısının alt süreç beklemesini de önlüyor.
  setImmediate(() => {
    createTray();
    try { getHwid(); } catch { /* ilk bağlantıda yeniden denenir */ }
    if (prefs().autoUpdate) setTimeout(() => updater.check(false), 8000);
  });
});

app.on('child-process-gone', (_event, details) => {
  console.error('[alt süreç] öldü:', details.type, details.reason, 'çıkış kodu', details.exitCode);
  const cfg = loadConfig();
  if (details.type === 'GPU' && cfg.prefs.vmMode === 'auto' && !cfg.prefs.vmDetected) {
    cfg.prefs.vmDetected = true;
    saveConfig(cfg);
    console.error('[uyumluluk] GPU çöktü -> sanal makine modu açıldı, yeniden başlatılıyor');
    isQuitting = true;
    app.relaunch();
    app.exit(0);
  }
});

app.on('render-process-gone', (_event, _contents, details) => {
  console.error('[renderer] öldü:', details.reason, 'çıkış kodu', details.exitCode);
});

app.on('before-quit', () => {
  isQuitting = true;
  fileIO.closeAll();
});

app.on('window-all-closed', () => app.quit());

// ---------------- IPC ----------------

ipcMain.handle('get-init-data', () => ({
  hwid: getHwid(),
  deviceName: os.hostname(),
  savedConnections: loadConfig().savedConnections,
  version: app.getVersion(),
  portable: platform.isPortableBuild(),
  vmCompatActive,
}));

ipcMain.on('get-app-version', (e) => { e.returnValue = app.getVersion(); });

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

ipcMain.handle('get-prefs', () => {
  const p = { ...prefs() };
  p.autoStart = autoStartQuery();
  p.portable = platform.isPortableBuild();
  p.vmCompatActive = vmCompatActive;
  return p;
});

ipcMain.handle('save-prefs', (_e, partial) => {
  const cfg = loadConfig();
  cfg.prefs = { ...DEFAULT_PREFS, ...cfg.prefs, ...(partial || {}) };
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

// ---- v4.0: izleme penceresi ----

ipcMain.on('set-fullscreen', (_e, on) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setFullScreen(!!on);
});

ipcMain.on('toggle-maximize', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});

// Pencereyi host'un görüntü boyutuna oturt: 1:1 izlemek istendiğinde ölçekleme
// kaynaklı bulanıklık olmasın. Ekrana sığmıyorsa oranı koruyarak küçültülür.
ipcMain.handle('fit-window-to', (_e, { width, height }) => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (!width || !height) return false;
  if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
  if (mainWindow.isMaximized()) mainWindow.unmaximize();

  const work = screen.getDisplayMatching(mainWindow.getBounds()).workAreaSize;
  const scale = Math.min(1, (work.width - 40) / width, (work.height - 80) / height);
  mainWindow.setContentSize(Math.round(width * scale), Math.round(height * scale), false);
  mainWindow.center();
  return true;
});

ipcMain.handle('set-auto-start', (_e, enabled) => {
  const result = autoStartSet(!!enabled);
  return { ...result, autoStart: autoStartQuery() };
});

ipcMain.handle('choose-download-dir', async () => {
  const res = await dialog.showOpenDialog({
    title: 'Gelen dosyaların kaydedileceği klasör',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (res.canceled || !res.filePaths.length) return { canceled: true };
  const cfg = loadConfig();
  cfg.prefs.downloadDir = res.filePaths[0];
  saveConfig(cfg);
  return { ok: true, prefs: cfg.prefs };
});

ipcMain.handle('export-config', () => exportConfig());
ipcMain.handle('import-config', () => importConfig());

ipcMain.handle('check-update', () => updater.check(true));
ipcMain.handle('install-update', () => updater.install());
ipcMain.handle('get-update-state', () => updater.getState());

ipcMain.handle('ask-file-accept', async (_e, { name, size }) => {
  const kb = size >= 1048576 ? (size / 1048576).toFixed(1) + ' MB' : Math.round(size / 1024) + ' KB';
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  const options = {
    type: 'question',
    buttons: ['Kabul et', 'Reddet'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    title: 'GameLink — Gelen dosya',
    message: 'Host bir dosya göndermek istiyor:',
    detail: `${name}\n${kb}\n\nKabul ederseniz seçtiğiniz kayıt klasörüne indirilir.`,
  };
  const res = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options);
  return res.response === 0;
});

ipcMain.on('open-log-folder', () => {
  if (logger && logger.path) shell.showItemInFolder(logger.path);
});
