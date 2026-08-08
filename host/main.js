const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');
const {
  app, BrowserWindow, ipcMain, desktopCapturer, session, screen, clipboard,
  Tray, Menu, nativeImage, nativeTheme, dialog, powerSaveBlocker, shell,
} = require('electron');
const { machineIdSync } = require('node-machine-id');

const fileIO = require('./file-io');
const platform = require('./platform');

// Ayar dosyası yalnızca bu süreç tarafından yazılıyor; bu yüzden bellekte
// tutulabilir. Öncesinde her tepsi yenilemesi, her pencere olayı ve her IPC
// çağrısı diskten senkron okuma yapıyordu (yüzlerce gereksiz readFileSync).
let configCache = null;
let tray = null;
let isQuitting = false;
let trayStatus = 'Bekleniyor';
let mainWindow;
let sessionWindow = null;
let psProcess;
let bridgeStopping = false;
let logger = null;
let updater = null;
let powerBlockerId = null;

// v4.0: açılışta tepsiye in (Görev Zamanlayıcı ile otomatik başlatmada kullanılır)
const startHidden = process.argv.includes('--hidden');

// Ekran paylaşımı isteği geldiğinde hangi kaynağın verileceği. Renderer, monitör
// değiştirmek istediğinde önce burayı günceller, sonra getDisplayMedia'yı tekrar çağırır.
let selectedSourceId = null;
// Sanal makinelerde ses aygıtı olmayabiliyor ve loopback isteği tüm yakalamayı
// düşürüyor; renderer sessiz yeniden denemeden önce bunu kapatıyor.
let captureAudioEnabled = true;

// desktopCapturer kaynak id'si -> Electron display id. İkinci imlecin hangi
// monitörün koordinat sistemine oturacağını bulmak için gerekli.
const sourceDisplayMap = new Map();
// selectedSourceId boş/geçersizken hangi kaynağın paylaşıldığı (listedeki ilki).
let fallbackSourceId = null;

// ---- İkinci imleç (hayalet imleç) ----
let overlayWin = null;
let ghostMode = false;
let lastGhostPoint = null;
// overlay.html'de okun ucu pencerenin (12,12) noktasında; pencereyi bu kadar
// sola/yukarı kaydırırsak okun ucu tam hedef pikselin üstüne gelir.
const GHOST_HOTSPOT = 12;
const GHOST_WIN_SIZE = 56;

// ---- v4.0: pencere yakalama ----
// Bir PENCERE paylaşıldığında ikinci imleç ekrana değil o pencerenin sınırlarına
// oturmalı. Sınır PowerShell köprüsünden isteniyor ve kısa süre önbellekleniyor:
// her fare hareketinde sormak köprüyü boğardı.
let windowRectCache = { hwnd: 0, rect: null, at: 0 };
const WINDOW_RECT_TTL = 400;

// ---- v4.0: uzaktan çözünürlük değiştirme ----
let originalDisplayMode = null;  // { dev, w, h, hz } — bağlantı bitince geri konur

// ---- v4.0: sistem bilgisi köprüsü ----
let sysProcess = null;
let sysTimer = null;
let sysStatic = null;
let lastDisk = null;
let lastNet = null;
let lastCpuSample = null;

// ---------------- Config yönetimi ----------------

// app.getPath('userData') app.whenReady() beklemeden kullanılabiliyor; sanal makine
// uyumluluk modunun donanım hızlandırmayı KAPATABİLMESİ için ayarların hazır
// olmasına burada ihtiyacımız var.
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

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

// v3.1.5'te ürün adındaki boşluk kaldırıldı ("GameLink Host" -> "GameLink-Host");
// cmd'de cd, .bat kısayolları ve Görev Zamanlayıcı yolları boşlukta tökezliyordu.
// userData klasörü ürün adından türediği için eski ayarlar (kod, parola, güvenilir
// cihazlar) başka bir klasörde kalıyor. İlk açılışta oradan bir kez kopyalanıyor.
function migrateLegacyUserData() {
  try {
    if (fs.existsSync(CONFIG_PATH)) return;
    const parent = path.dirname(app.getPath('userData'));
    for (const legacyName of ['GameLink Host', 'gamelink-host']) {
      const legacy = path.join(parent, legacyName, 'config.json');
      if (legacy !== CONFIG_PATH && fs.existsSync(legacy)) {
        fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
        fs.copyFileSync(legacy, CONFIG_PATH);
        console.log('[config] eski ayarlar taşındı:', legacy);
        return;
      }
    }
  } catch (err) {
    console.error('[config] eski ayarlar taşınamadı:', err.message);
  }
}

// Not Defteri'nin "UTF-8 BOM'lu" kaydı ve PowerShell'in Out-File'ı dosyanın başına
// görünmez bir işaret (BOM) koyar; JSON.parse bunu kabul etmez. Kırpılmazsa tamamen
// geçerli bir ayar dosyası "bozuk" sayılıp sıfırlanıyordu.
const stripBom = (s) => (s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s);

// Ayar dosyası okunabiliyor ama ayrıştırılamıyorsa ÜZERİNE YAZILMAZ: içinde bağlantı
// kodu, parola ve güvenilir cihaz listesi var. Bir kenara yedeklenir, kullanıcı
// isterse geri alabilir.
function backupCorruptConfig(err) {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = `${CONFIG_PATH}.bozuk-${stamp}`;
    fs.copyFileSync(CONFIG_PATH, backup);
    console.error(`[config] ayar dosyası okunamadı (${err.message}); yedeklendi: ${backup}`);
  } catch (e) {
    console.error('[config] bozuk ayar dosyası yedeklenemedi:', e.message);
  }
}

// ---- Parola saklama (v4.0) ----
//
// Eskiden parola config.json'da DÜZ METİN duruyordu. Artık yalnızca scrypt özeti
// saklanıyor. Tel üzerindeki protokol değişmedi: client hâlâ sha256(parola)
// gönderiyor, host o özeti tuzlayıp scrypt'ten geçirerek karşılaştırıyor. Böylece
// ayar dosyasını ele geçiren biri parolayı geri elde edemiyor ve dosya başka bir
// makineye taşındığında (dışa aktarma) parola çalışmaya devam ediyor.

function makePasswordRecord(sha256Hex) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(sha256Hex, salt, 32).toString('hex');
  return { algo: 'scrypt', salt, hash };
}

function verifyPasswordRecord(record, sha256Hex) {
  if (!record || !record.salt || !record.hash || typeof sha256Hex !== 'string') return false;
  try {
    const calculated = crypto.scryptSync(sha256Hex, record.salt, 32);
    const stored = Buffer.from(record.hash, 'hex');
    return calculated.length === stored.length && crypto.timingSafeEqual(calculated, stored);
  } catch {
    return false;
  }
}

// Düz metin parola özete çevrildiğinde dosyanın HEMEN yeniden yazılması gerekiyor;
// yoksa düz metin bir sonraki ayar değişikliğine kadar diskte kalırdı.
let configNeedsSave = false;

function applyConfigDefaults(cfg) {
  if (!cfg.trustedDevices) cfg.trustedDevices = {};
  if (!cfg.turn) cfg.turn = { ...DEFAULT_TURN };
  if (typeof cfg.clipboardSync !== 'boolean') cfg.clipboardSync = true;
  if (!('captureSourceId' in cfg)) cfg.captureSourceId = null;
  if (!['auto', 'stun-only', 'turn-only'].includes(cfg.iceMode)) cfg.iceMode = 'auto';
  if (typeof cfg.minimizeToTray !== 'boolean') cfg.minimizeToTray = true;
  if (!['system', 'light', 'dark'].includes(cfg.theme)) cfg.theme = 'system';

  // v4.0 alanları
  if (typeof cfg.updateUrl !== 'string') cfg.updateUrl = '';
  if (typeof cfg.autoUpdate !== 'boolean') cfg.autoUpdate = true;
  if (!['auto', 'on', 'off'].includes(cfg.vmMode)) cfg.vmMode = 'auto';
  if (typeof cfg.vmDetected !== 'boolean') cfg.vmDetected = false;
  if (typeof cfg.chatEnabled !== 'boolean') cfg.chatEnabled = true;
  if (typeof cfg.fileTransfer !== 'boolean') cfg.fileTransfer = true;
  if (typeof cfg.autoAcceptFiles !== 'boolean') cfg.autoAcceptFiles = false;
  if (typeof cfg.downloadDir !== 'string') cfg.downloadDir = '';
  if (typeof cfg.shareSystemInfo !== 'boolean') cfg.shareSystemInfo = true;
  if (typeof cfg.allowRemoteResolution !== 'boolean') cfg.allowRemoteResolution = true;
  if (typeof cfg.allowWindowCapture !== 'boolean') cfg.allowWindowCapture = true;
  if (typeof cfg.sessionWindow !== 'boolean') cfg.sessionWindow = true;
  if (typeof cfg.recordBitrate !== 'number') cfg.recordBitrate = 12;
  if (!['auto', 'h264', 'vp8', 'vp9', 'av1'].includes(cfg.videoCodec)) cfg.videoCodec = 'auto';
  if (typeof cfg.preventSleep !== 'boolean') cfg.preventSleep = true;
  if (!cfg.windowBounds || typeof cfg.windowBounds !== 'object') cfg.windowBounds = null;

  // Düz metin parolayı bir kez özete çevir, sonra dosyadan sil.
  if (typeof cfg.hostPassword === 'string' && cfg.hostPassword.length > 0) {
    const sha = crypto.createHash('sha256').update(cfg.hostPassword).digest('hex');
    cfg.hostPasswordRecord = makePasswordRecord(sha);
    delete cfg.hostPassword;
    configNeedsSave = true;
    console.log('[config] parola düz metinden scrypt özetine taşındı');
  } else if ('hostPassword' in cfg) {
    // Parola hiç ayarlanmamış (boş dize): artık kullanılmayan alanı dosyadan sil.
    delete cfg.hostPassword;
    configNeedsSave = true;
  }
  if (cfg.hostPasswordRecord && typeof cfg.hostPasswordRecord !== 'object') {
    cfg.hostPasswordRecord = null;
  }
  return cfg;
}

function loadConfig() {
  if (configCache) return configCache;

  let raw;
  try {
    raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  } catch {
    return null; // dosya henüz yok: ensureConfig temiz bir yapılandırma kuracak
  }

  try {
    const cfg = applyConfigDefaults(JSON.parse(stripBom(raw)));
    configCache = cfg;
    if (configNeedsSave) {
      configNeedsSave = false;
      saveConfig(cfg);
    }
    return cfg;
  } catch (err) {
    // Dosya var ama ayrıştırılamadı. Sessizce üzerine yazmak kullanıcının bağlantı
    // kodunu, parolasını ve güvenilir cihazlarını yok eder; önce yedeğe alıyoruz.
    backupCorruptConfig(err);
    return null;
  }
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

function ensureConfig() {
  let cfg = loadConfig();
  if (!cfg) {
    cfg = applyConfigDefaults({
      hostCode: generateCodeFromMachine(),
      hostPasswordRecord: null,
      signalingUrl: 'wss://sizin-domaininiz.com',
    });
    saveConfig(cfg);
  }
  selectedSourceId = cfg.captureSourceId;
  return cfg;
}

// Pencerenin arka plan rengi, ilk kare çizilmeden önce doğru tema rengine ayarlanır;
// aksi halde açılışta beyaz bir kare "flaş" ediyordu.
function themeBackground(theme) {
  const dark = theme === 'dark' || (theme !== 'light' && nativeTheme.shouldUseDarkColors);
  return dark ? '#0b0d12' : '#eef1fa';
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

// ---------------- Sanal makine / VDS uyumluluk modu ----------------
//
// Bu blok app.whenReady()'den ÖNCE çalışmak zorunda: donanım hızlandırma kararı
// Chromium ayağa kalkmadan verilmeli.

migrateLegacyUserData();
const bootConfig = ensureConfig();

if (bootConfig.vmMode === 'auto' && !bootConfig.vmDetected) {
  const detection = platform.detectVirtualMachineSync();
  if (detection.detected) {
    bootConfig.vmDetected = detection.vm;
    saveConfig(bootConfig);
  }
}

const vmCompatActive = bootConfig.vmMode === 'on'
  || (bootConfig.vmMode === 'auto' && bootConfig.vmDetected);

if (vmCompatActive) {
  // Sanal makinelerde GPU ya yok ya da yazılım öykünmesi; Chromium'un donanım
  // yolu orada GPU sürecini çökertip uygulamanın hiç açılmamasına yol açıyor.
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
}

// Pencere simge durumuna küçültüldüğünde ya da başka bir pencere üstünü kapattığında
// Chromium süreci "arka plan" sayıp zamanlayıcıları/işlemeyi kısar. Uzaktan kumanda
// için bu ölümcül: client'ın gönderdiği fare/klavye paketleri geç işlenir veya hiç
// işlenmez. Üç bayrak da bu kısıtlamaları kapatıyor.
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// ---------------- Tek örnek kilidi ----------------
//
// Arka planda birden fazla host çalışırsa ikisi de aynı kodla sinyal sunucusuna
// kaydolmaya çalışır, sunucu ikincisini "Bu kod zaten kullanımda" ile reddeder ve
// kullanıcı neden bağlanamadığını anlamaz. Ayrıca iki girdi köprüsü aynı fareyi
// sürer. İkinci örnek başlatıldığında var olanın penceresi öne getiriliyor.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());
}

// ---------------- Ekran kaynakları ----------------

const sourceKind = (id) => (String(id || '').startsWith('window:') ? 'window' : 'screen');

// desktopCapturer'ın Windows'taki pencere kimliği "window:<HWND>:<n>" biçiminde.
function hwndFromSourceId(id) {
  const match = /^window:(\d+):/.exec(String(id || ''));
  return match ? Number(match[1]) : 0;
}

async function listScreenSources() {
  const cfg = loadConfig() || {};
  const types = cfg.allowWindowCapture ? ['screen', 'window'] : ['screen'];

  let sources = [];
  try {
    sources = await desktopCapturer.getSources({ types, thumbnailSize: { width: 0, height: 0 } });
  } catch (err) {
    // VDS'de oturum koptuysa masaüstü yoktur ve bu çağrı hata verir.
    console.error('[kaynak] listelenemedi:', err.message);
    return [];
  }

  const displays = screen.getAllDisplays();
  sourceDisplayMap.clear();

  const screens = sources.filter((s) => sourceKind(s.id) === 'screen');
  const windows = sources.filter((s) => sourceKind(s.id) === 'window');
  fallbackSourceId = screens.length ? screens[0].id : (sources[0] ? sources[0].id : null);

  const mappedScreens = screens.map((s, i) => {
    const display = displays.find((d) => String(d.id) === String(s.display_id))
      || displays[i]
      || screen.getPrimaryDisplay();
    if (display) sourceDisplayMap.set(s.id, display.id);
    const size = display ? `${display.size.width}×${display.size.height}` : null;
    return {
      id: s.id,
      kind: 'screen',
      name: size ? `Ekran ${i + 1} — ${size}` : s.name || `Ekran ${i + 1}`,
      primary: display ? display.id === screen.getPrimaryDisplay().id : i === 0,
    };
  });

  const mappedWindows = windows
    .filter((s) => s.name && s.name.trim())
    .map((s) => ({ id: s.id, kind: 'window', name: s.name, primary: false }));

  return mappedScreens.concat(mappedWindows);
}

// Şu an paylaşılan monitörün Electron display nesnesi. İkinci imlecin oranlı
// (0..1) konumu bu monitörün sınırlarına oturtulur.
function captureDisplay() {
  const displays = screen.getAllDisplays();
  // setDisplayMediaRequestHandler ile aynı seçim kuralı: seçili kaynak listede
  // yoksa ilk kaynak paylaşılıyor demektir.
  const sourceId = sourceDisplayMap.has(selectedSourceId) ? selectedSourceId : fallbackSourceId;
  const displayId = sourceDisplayMap.get(sourceId);
  if (displayId != null) {
    const found = displays.find((d) => d.id === displayId);
    if (found) return found;
  }
  return screen.getPrimaryDisplay();
}

// ---------------- Ekran paylaşımı (onay ekranı olmadan) ----------------

function setupDisplayMediaHandler() {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    const cfg = loadConfig() || {};
    const types = cfg.allowWindowCapture ? ['screen', 'window'] : ['screen'];
    desktopCapturer.getSources({ types, thumbnailSize: { width: 0, height: 0 } })
      .then((sources) => {
        if (!sources.length) { callback({}); return; }
        const chosen = sources.find((s) => s.id === selectedSourceId)
          || sources.find((s) => sourceKind(s.id) === 'screen')
          || sources[0];
        // Ses aygıtı olmayan sanal makinelerde loopback isteği tüm yakalamayı
        // düşürüyor; renderer sessiz yeniden denemede bunu kapatıyor.
        callback(captureAudioEnabled ? { video: chosen, audio: 'loopback' } : { video: chosen });
      })
      .catch((err) => {
        console.error('[yakalama] kaynak alınamadı:', err.message);
        callback({});
      });
  }, { useSystemPicker: false });
}

// ---------------- Pencere ----------------

function createWindow() {
  const cfg = loadConfig() || {};
  const bounds = cfg.windowBounds;

  mainWindow = new BrowserWindow({
    width: (bounds && bounds.width) || 480,
    height: (bounds && bounds.height) || 780,
    x: bounds ? bounds.x : undefined,
    y: bounds ? bounds.y : undefined,
    // v4.0: pencere artık yeniden boyutlandırılabilir ve boyutu hatırlanıyor.
    resizable: true,
    minWidth: 420,
    minHeight: 520,
    title: 'GameLink Host',
    // Pencere boş haldeyken gösterilmiyor: HTML ilk karesini çizene kadar bekliyoruz.
    // Eskiden önce beyaz bir çerçeve açılıp sonra arayüz oturuyordu.
    show: false,
    backgroundColor: themeBackground(cfg.theme),
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
  platform.attachRendererLogging(mainWindow, 'arayüz');
  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    // Görev Zamanlayıcı ile açılışta başlatıldığında pencere hiç görünmesin.
    if (startHidden && (loadConfig() || {}).minimizeToTray) {
      mainWindow.setSkipTaskbar(true);
      return;
    }
    mainWindow.show();
  });

  const rememberBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return;
    const cur = loadConfig();
    if (!cur) return;
    cur.windowBounds = mainWindow.getNormalBounds();
    saveConfig(cur);
  };
  mainWindow.on('resized', rememberBounds);
  mainWindow.on('moved', rememberBounds);

  // Simge durumuna küçültünce görev çubuğunda yer kaplamasın, tepsiye insin.
  mainWindow.on('minimize', (e) => {
    const cur = loadConfig();
    if (cur && cur.minimizeToTray) {
      e.preventDefault();
      mainWindow.hide();
      mainWindow.setSkipTaskbar(true);
    }
  });

  // Kapatma düğmesi de uygulamayı sonlandırmasın: host arka planda çalışmaya
  // devam etmeli, yoksa uzaktan bağlanılamaz. Gerçek çıkış tepsi menüsünden.
  mainWindow.on('close', (e) => {
    if (isQuitting) return;
    const cur = loadConfig();
    if (cur && cur.minimizeToTray) {
      e.preventDefault();
      mainWindow.hide();
      mainWindow.setSkipTaskbar(true);
    }
  });

  // Pencere gerçekten yok edildiyse referansı bırak: tepsi menüsü yok edilmiş bir
  // pencereye dokunursa "Object has been destroyed" ile çöküyordu. Katman penceresi
  // de burada kapanmalı, yoksa görünmez bir pencere uygulamayı ayakta tutar.
  mainWindow.on('closed', () => {
    mainWindow = null;
    setGhostMode(false);
    closeSessionWindow();
  });
}

// ---------------- v4.0: oturum penceresi (AnyDesk tarzı) ----------------
//
// Bir client bağlandığında host'ta küçük bir pencere açılıyor: kim bağlandı, ne
// kadar süredir bağlı, sohbet ve dosya aktarımı. WebRTC bağlantısı ana pencerenin
// renderer'ında olduğu için bu pencere ana süreç üzerinden köprüleniyor.

function openSessionWindow(info) {
  const cfg = loadConfig() || {};
  if (!cfg.sessionWindow) return;

  if (sessionWindow && !sessionWindow.isDestroyed()) {
    sessionWindow.webContents.send('session-event', { t: 'peer', ...info });
    sessionWindow.showInactive();
    return;
  }

  sessionWindow = new BrowserWindow({
    width: 420,
    height: 560,
    minWidth: 360,
    minHeight: 420,
    title: 'GameLink — Oturum',
    show: false,
    backgroundColor: themeBackground(cfg.theme),
    webPreferences: {
      preload: path.join(__dirname, 'session-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  sessionWindow.setMenuBarVisibility(false);
  platform.attachRendererLogging(sessionWindow, 'oturum');
  sessionWindow.loadFile('session.html');
  sessionWindow.once('ready-to-show', () => {
    if (!sessionWindow || sessionWindow.isDestroyed()) return;
    sessionWindow.showInactive();
    sessionWindow.webContents.send('session-event', { t: 'peer', ...info });
  });
  sessionWindow.on('closed', () => { sessionWindow = null; });
}

function closeSessionWindow() {
  if (sessionWindow && !sessionWindow.isDestroyed()) sessionWindow.destroy();
  sessionWindow = null;
}

function toSession(payload) {
  if (sessionWindow && !sessionWindow.isDestroyed()) {
    sessionWindow.webContents.send('session-event', payload);
  }
}

function toRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

// ---------------- Sistem tepsisi ----------------

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
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
  if (!tray || tray.isDestroyed()) return;
  const cfg = loadConfig() || {};
  tray.setToolTip(`GameLink Host ${app.getVersion()} — ${cfg.hostCode || '-'} (${trayStatus})`);
  tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'tray-icon.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.on('double-click', showMainWindow);
  refreshTray();
}

// ---------------- İkinci imleç (hayalet imleç) ----------------
//
// Windows'ta masaüstü başına yalnızca TEK sistem imleci vardır; gerçekten bağımsız
// ikinci bir imleç ancak ayrı bir oturumda (RDP) mümkün. Burada yapılan şey, ikinci
// imleci taklit etmek:
//   1) Client'ın imleci host'un GERÇEK imlecine hiç dokunmadan hareket eder; host
//      kullanıcısı kendi faresiyle çalışmaya devam eder.
//   2) Host, ikinci imleci tıklama geçirgen bir katman penceresiyle görür.
//   3) Tıklama/tekerlek anında gerçek imleç birkaç milisaniye "ödünç alınır"
//      (input-bridge.ps1 -> Borrow-Begin/Borrow-End) ve hemen geri konur.
// Katman penceresi setContentProtection ile ekran yakalamadan hariç tutulur, yoksa
// client hem kendi imlecini hem de gecikmeli katman imlecini görürdü.

function createOverlay() {
  if (overlayWin && !overlayWin.isDestroyed()) return;
  overlayWin = new BrowserWindow({
    width: GHOST_WIN_SIZE,
    height: GHOST_WIN_SIZE,
    x: -GHOST_WIN_SIZE * 2, // ilk konum gelene kadar ekran dışında dursun
    y: -GHOST_WIN_SIZE * 2,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  // Katman hiçbir tıklamayı yakalamamalı, odak çalmamalı.
  overlayWin.setIgnoreMouseEvents(true, { forward: false });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Ekran paylaşımından hariç tut (Win10 2004+ WDA_EXCLUDEFROMCAPTURE).
  try { overlayWin.setContentProtection(true); } catch { /* desteklenmiyorsa görünür kalır */ }
  overlayWin.loadFile('overlay.html');
  overlayWin.once('ready-to-show', () => {
    if (overlayWin && !overlayWin.isDestroyed()) overlayWin.showInactive();
  });
  overlayWin.on('closed', () => { overlayWin = null; });
}

function destroyOverlay() {
  if (overlayWin && !overlayWin.isDestroyed()) overlayWin.destroy();
  overlayWin = null;
}

function setGhostMode(on) {
  const next = !!on;
  if (next === ghostMode) return;
  ghostMode = next;
  if (ghostMode) {
    createOverlay();
  } else {
    // Yarım kalmış bir sürükleme varsa köprü gerçek imleci sahibine iade etsin.
    writeInput({ t: 'gx' });
    lastGhostPoint = null;
    destroyOverlay();
  }
}

const clamp01 = (n) => (typeof n === 'number' && isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

// Paylaşılan pencerenin fiziksel piksel sınırları. Pencere taşınıp boyutlanabildiği
// için kısa ömürlü önbellekle sürekli tazeleniyor; her fare paketinde köprüye sormak
// gecikmeyi artırırdı.
function refreshWindowRect(hwnd) {
  const now = Date.now();
  if (windowRectCache.hwnd === hwnd && now - windowRectCache.at < WINDOW_RECT_TTL) return;
  // Başka bir pencereye geçildiyse eldeki sınır artık yanlış; yanıt gelene kadar
  // ekran koordinatlarına düşülsün.
  if (windowRectCache.hwnd !== hwnd) windowRectCache.rect = null;
  windowRectCache.at = now;
  windowRectCache.hwnd = hwnd;
  bridgeRequest({ t: 'wr', hwnd }).then((res) => {
    if (res && Array.isArray(res.r) && res.r.length === 4) windowRectCache.rect = res.r;
    else if (res) windowRectCache.rect = null;
  });
}

// Client oranlı (0..1) konum gönderir; burada paylaşılan alanın GERÇEK piksel
// koordinatına çevrilir. PowerShell köprüsü DPI farkında olduğu için fiziksel
// piksel bekliyor. Katman penceresi ise DIP ile konumlanır (setPosition DIP alır).
function moveGhost(u, v) {
  if (!ghostMode) return;

  let physical = null;
  let dip = null;

  if (sourceKind(selectedSourceId) === 'window') {
    const hwnd = hwndFromSourceId(selectedSourceId);
    refreshWindowRect(hwnd);
    const rect = windowRectCache.rect;
    if (rect) {
      physical = {
        x: Math.round(rect[0] + clamp01(u) * (rect[2] - 1)),
        y: Math.round(rect[1] + clamp01(v) * (rect[3] - 1)),
      };
      try { dip = screen.screenToDipPoint(physical); } catch { dip = physical; }
    }
  }

  if (!physical) {
    const bounds = captureDisplay().bounds;
    dip = {
      x: Math.round(bounds.x + clamp01(u) * (bounds.width - 1)),
      y: Math.round(bounds.y + clamp01(v) * (bounds.height - 1)),
    };
    try {
      physical = screen.dipToScreenPoint(dip);
    } catch {
      physical = dip; // Windows dışı / API yoksa DIP zaten piksel demektir
    }
  }

  if (!lastGhostPoint || lastGhostPoint.x !== physical.x || lastGhostPoint.y !== physical.y) {
    lastGhostPoint = physical;
    writeInput({ t: 'gp', x: physical.x, y: physical.y });
  }

  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.setPosition(Math.round(dip.x) - GHOST_HOTSPOT, Math.round(dip.y) - GHOST_HOTSPOT);
  }
}

// ---------------- Girdi enjeksiyon köprüsü (PowerShell, kalıcı süreç) ----------------

// v4.0: köprü artık sorulara da cevap veriyor (pencere sınırı, ekran modları).
// Yanıtlar stdout'a JSON satırı olarak geliyor ve id ile eşleştiriliyor.
let bridgeRequestId = 0;
const bridgePending = new Map();
let bridgeStdoutBuffer = '';

function bridgeRequest(cmd, timeoutMs = 5000) {
  return new Promise((resolve) => {
    if (!psProcess || psProcess.killed) { resolve(null); return; }
    bridgeRequestId += 1;
    const id = bridgeRequestId;
    const timer = setTimeout(() => {
      bridgePending.delete(id);
      resolve(null);
    }, timeoutMs);
    bridgePending.set(id, { resolve, timer });
    writeInput({ ...cmd, id });
  });
}

function handleBridgeLine(line) {
  const text = line.trim();
  if (!text) return;
  if (text[0] !== '{') { console.log('[input-bridge]', text); return; }

  let msg;
  try { msg = JSON.parse(text); } catch { console.log('[input-bridge]', text); return; }

  const waiting = bridgePending.get(msg.id);
  if (!waiting) return;
  bridgePending.delete(msg.id);
  clearTimeout(waiting.timer);
  waiting.resolve(msg);
}

function startInputBridge() {
  psProcess = spawn('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    // Paketlenmiş .exe'de kaynaklar app.asar arşivinin içinde durur ve PowerShell
    // arşivin içindeki bir yolu açamaz. asarUnpack sayesinde bu script gerçek bir
    // dosya olarak app.asar.unpacked altına çıkarılıyor; yolu ona çeviriyoruz.
    '-File', path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'input-bridge.ps1'),
  ], { windowsHide: true });

  psProcess.stdout.on('data', (d) => {
    // Satırlar parça parça gelebilir; tam satır oluşana kadar biriktiriliyor.
    bridgeStdoutBuffer += d.toString();
    let index = bridgeStdoutBuffer.indexOf('\n');
    while (index >= 0) {
      handleBridgeLine(bridgeStdoutBuffer.slice(0, index));
      bridgeStdoutBuffer = bridgeStdoutBuffer.slice(index + 1);
      index = bridgeStdoutBuffer.indexOf('\n');
    }
    if (bridgeStdoutBuffer.length > 64 * 1024) bridgeStdoutBuffer = '';
  });

  psProcess.stderr.on('data', (d) => console.error('[input-bridge ERR]', d.toString().trim()));
  // Köprü süreci ölmüşken stdin'e yazmak EPIPE fırlatır; yakalanmazsa tüm uygulama
  // çöker. Burada yutup 'exit' işleyicisinin yeniden başlatmasına bırakıyoruz.
  psProcess.on('error', (err) => console.error('[input-bridge] süreç hatası:', err.message));
  psProcess.stdin.on('error', (err) => console.error('[input-bridge] stdin hatası:', err.message));
  psProcess.on('exit', (code) => {
    // Bekleyen sorular sonsuza kadar asılı kalmasın.
    for (const [, waiting] of bridgePending) { clearTimeout(waiting.timer); waiting.resolve(null); }
    bridgePending.clear();
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

// ---------------- v4.0: uzaktan ekran çözünürlüğü ----------------

// Paylaşılan monitörün sol üst köşesinin FİZİKSEL koordinatı; köprü hangi ekran
// aygıtından bahsettiğimizi bununla buluyor.
function captureDisplayOriginPhysical() {
  const bounds = captureDisplay().bounds;
  try {
    return screen.dipToScreenPoint({ x: bounds.x, y: bounds.y });
  } catch {
    return { x: bounds.x, y: bounds.y };
  }
}

async function listDisplayModes() {
  const origin = captureDisplayOriginPhysical();
  const res = await bridgeRequest({ t: 'dm', x: origin.x, y: origin.y });
  if (!res || !res.dev) return { device: null, current: null, modes: [] };
  const modes = Array.isArray(res.modes) ? res.modes : (res.modes ? [res.modes] : []);
  const current = Array.isArray(res.cur) ? { w: res.cur[0], h: res.cur[1], hz: res.cur[2] } : null;
  return { device: res.dev, current, modes };
}

async function setDisplayMode(w, h, hz) {
  const cfg = loadConfig() || {};
  if (!cfg.allowRemoteResolution) return { ok: false, reason: 'Host bu izni kapatmış.' };

  const info = await listDisplayModes();
  if (!info.device) return { ok: false, reason: 'Ekran aygıtı bulunamadı.' };

  // İlk değişimden önceki mod saklanıyor; bağlantı bitince buraya dönülüyor.
  if (!originalDisplayMode && info.current) {
    originalDisplayMode = { dev: info.device, ...info.current };
  }

  const res = await bridgeRequest({ t: 'ds', dev: info.device, w, h, hz: hz || 0 });
  const code = res ? res.code : -1;
  if (code === 0) {
    console.log(`[ekran] çözünürlük ${w}x${h}@${hz || 'auto'} olarak ayarlandı`);
    return { ok: true };
  }
  return { ok: false, reason: `Windows çözünürlüğü kabul etmedi (kod ${code}).` };
}

async function restoreDisplayMode() {
  if (!originalDisplayMode) return;
  const target = originalDisplayMode;
  originalDisplayMode = null;
  await bridgeRequest({ t: 'ds', dev: target.dev, w: target.w, h: target.h, hz: target.hz || 0 });
  console.log('[ekran] çözünürlük eski haline döndürüldü');
}

// ---------------- v4.0: sistem bilgisi ----------------

// CPU yüzdesi Node tarafında hesaplanıyor: alt süreç maliyeti yok ve dilden
// bağımsız. os.cpus() kümülatif tik sayaçları verir, iki örnek arasındaki farktan
// meşguliyet oranı çıkar.
function cpuPercent() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    for (const key of Object.keys(cpu.times)) total += cpu.times[key];
    idle += cpu.times.idle;
  }
  const sample = { idle, total };
  const previous = lastCpuSample;
  lastCpuSample = sample;
  if (!previous) return 0;
  const deltaTotal = total - previous.total;
  const deltaIdle = idle - previous.idle;
  if (deltaTotal <= 0) return 0;
  return Math.max(0, Math.min(100, (1 - deltaIdle / deltaTotal) * 100));
}

function startSysInfo() {
  if (sysTimer) return;
  lastCpuSample = null;
  cpuPercent();

  const scriptPath = path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'sysinfo-bridge.ps1');
  try {
    sysProcess = spawn('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath, '-ParentPid', String(process.pid),
    ], { windowsHide: true });

    let buffer = '';
    sysProcess.stdout.on('data', (d) => {
      buffer += d.toString();
      let index = buffer.indexOf('\n');
      while (index >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf('\n');
        if (!line || line[0] !== '{') continue;
        try {
          const msg = JSON.parse(line);
          if (msg.t === 'static') { sysStatic = msg; toRenderer('sysinfo-static', msg); }
          else if (msg.t === 'tick') { lastDisk = msg.disk; lastNet = msg.net; }
          else if (msg.t === 'disks' && sysStatic) {
            sysStatic.disks = msg.disks;
            toRenderer('sysinfo-static', sysStatic);
          }
        } catch { /* bozuk satırı atla */ }
      }
      if (buffer.length > 64 * 1024) buffer = '';
    });
    sysProcess.stderr.on('data', (d) => console.error('[sysinfo ERR]', d.toString().trim()));
    sysProcess.on('error', (err) => console.error('[sysinfo] başlatılamadı:', err.message));
    sysProcess.on('exit', () => { sysProcess = null; });
  } catch (err) {
    console.error('[sysinfo] köprü açılamadı:', err.message);
  }

  // Ölçüm köprüden bağımsız da işe yarasın: CPU/RAM her koşulda gider.
  sysTimer = setInterval(() => {
    const totalMem = os.totalmem();
    toRenderer('sysinfo-tick', {
      cpu: Math.round(cpuPercent() * 10) / 10,
      mem: { total: totalMem, used: totalMem - os.freemem() },
      disk: lastDisk,
      net: lastNet,
      uptime: Math.round(os.uptime()),
    });
  }, 250);
}

function stopSysInfo() {
  if (sysTimer) { clearInterval(sysTimer); sysTimer = null; }
  if (sysProcess && !sysProcess.killed) {
    try { sysProcess.kill(); } catch { /* zaten kapanmış */ }
  }
  sysProcess = null;
  sysStatic = null;
  lastDisk = null;
  lastNet = null;
}

// ---------------- v4.0: Windows açılışında başlat ----------------
//
// Host yönetici yetkisi istediği için shell:startup kısayolu işe yaramaz (her
// açılışta UAC istemi çıkar). Görev Zamanlayıcı'da "en yüksek ayrıcalıklarla"
// çalışan bir ONLOGON görevi bu istemi ortadan kaldırıyor.

const TASK_NAME = 'GameLink-Host';

// schtasks bir alt süreç; her publicConfig çağrısında sorulursa bağlantı kabul
// yolunda 50-100 ms boşuna harcanır. Değer önbellekleniyor, yalnızca arayüz
// açıkça sorduğunda ya da ayar değiştiğinde tazeleniyor.
let autoStartCache = null;

function autoStartQuery(force) {
  if (autoStartCache !== null && !force) return autoStartCache;
  try {
    execFileSync('schtasks', ['/Query', '/TN', TASK_NAME], { stdio: 'ignore', windowsHide: true });
    autoStartCache = true;
  } catch {
    autoStartCache = false;
  }
  return autoStartCache;
}

function autoStartSet(enabled) {
  try {
    if (!enabled) {
      execFileSync('schtasks', ['/Delete', '/TN', TASK_NAME, '/F'], { stdio: 'ignore', windowsHide: true });
      autoStartCache = false;
      return { ok: true, enabled: false };
    }
    if (!app.isPackaged) {
      return { ok: false, reason: 'Geliştirme modunda otomatik başlatma kurulamaz.' };
    }
    if (platform.isPortableBuild()) {
      return { ok: false, reason: 'Taşınabilir sürümde otomatik başlatma kurulamaz; kurulum sürümünü kullanın.' };
    }
    // --hidden: açılışta pencere gösterilmeden doğrudan tepsiye insin.
    const command = `"${process.execPath}" --hidden`;
    execFileSync(
      'schtasks',
      ['/Create', '/TN', TASK_NAME, '/TR', command, '/SC', 'ONLOGON', '/RL', 'HIGHEST', '/F'],
      { stdio: 'ignore', windowsHide: true }
    );
    return { ok: true, enabled: autoStartQuery(true) };
  } catch (err) {
    return { ok: false, reason: 'Görev Zamanlayıcı komutu başarısız: ' + err.message };
  }
}

// ---------------- v4.0: ayarları dışa/içe aktarma ----------------
//
// Parola dışa aktarılırken DÜZ METİN değil scrypt kaydı taşınıyor: dosya başka
// birinin eline geçse bile parola geri elde edilemez, ama hedef makinede aynı
// parola çalışmaya devam eder.

const EXPORT_MARKER = 'gamelink-host-config';

function buildExport(cfg) {
  return {
    app: EXPORT_MARKER,
    formatVersion: 1,
    appVersion: app.getVersion(),
    exportedAt: new Date().toISOString(),
    data: {
      hostCode: cfg.hostCode,
      signalingUrl: cfg.signalingUrl,
      hostPasswordRecord: cfg.hostPasswordRecord || null,
      turn: cfg.turn,
      iceMode: cfg.iceMode,
      clipboardSync: cfg.clipboardSync,
      minimizeToTray: cfg.minimizeToTray,
      theme: cfg.theme,
      updateUrl: cfg.updateUrl,
      autoUpdate: cfg.autoUpdate,
      vmMode: cfg.vmMode,
      chatEnabled: cfg.chatEnabled,
      fileTransfer: cfg.fileTransfer,
      autoAcceptFiles: cfg.autoAcceptFiles,
      downloadDir: cfg.downloadDir,
      shareSystemInfo: cfg.shareSystemInfo,
      allowRemoteResolution: cfg.allowRemoteResolution,
      allowWindowCapture: cfg.allowWindowCapture,
      sessionWindow: cfg.sessionWindow,
      recordBitrate: cfg.recordBitrate,
      videoCodec: cfg.videoCodec,
      preventSleep: cfg.preventSleep,
      trustedDevices: cfg.trustedDevices,
    },
  };
}

async function exportConfig() {
  const cfg = loadConfig();
  const res = await dialog.showSaveDialog({
    title: 'GameLink ayarlarını dışa aktar',
    defaultPath: `gamelink-host-ayarlar-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'GameLink ayar dosyası', extensions: ['json'] }],
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  try {
    fs.writeFileSync(res.filePath, JSON.stringify(buildExport(cfg), null, 2), 'utf8');
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
      return { ok: false, reason: 'Bu dosya bir GameLink Host ayar dosyası değil.' };
    }
    const cfg = loadConfig();
    // Yalnızca tanınan alanlar aktarılıyor; dosyadaki fazlalıklar yok sayılıyor.
    const merged = applyConfigDefaults({ ...cfg, ...parsed.data });
    saveConfig(merged);
    selectedSourceId = merged.captureSourceId;
    refreshTray();
    return { ok: true, config: publicConfig(merged) };
  } catch (err) {
    return { ok: false, reason: 'Dosya okunamadı: ' + err.message };
  }
}

// ---------------- Uygulama yaşam döngüsü ----------------

app.whenReady().then(() => {
  logger = platform.createLogger('host.log');
  if (vmCompatActive) console.log('[uyumluluk] sanal makine modu etkin: donanım hızlandırma kapalı');
  if (platform.isRemoteSession()) console.log('[uyumluluk] uzak masaüstü oturumunda çalışıyor (SESSIONNAME=' + process.env.SESSIONNAME + ')');

  setupDisplayMediaHandler();

  fileIO.register({
    folderName: 'GameLink',
    getDownloadDir: () => {
      const cfg = loadConfig();
      return cfg && cfg.downloadDir ? cfg.downloadDir : null;
    },
  });

  updater = platform.createUpdater({
    getFeedUrl: () => (loadConfig() || {}).updateUrl || '',
    notify: (state) => toRenderer('update-state', state),
  });

  // Sıra bilinçli seçildi: önce pencere açılır (kullanıcı ilk kareyi en erken görsün),
  // PowerShell köprüsü ayrı bir süreçte paralel ısınır. Tepsi ve monitör listesi ise
  // açılış yolunu tıkamasın diye bir sonraki olay döngüsü turuna bırakılıyor —
  // desktopCapturer.getSources tek başına birkaç yüz milisaniye sürebiliyor.
  createWindow();
  startInputBridge();

  setImmediate(() => {
    createTray();
    // Kaynak -> monitör eşlemesi: ikinci imlecin koordinat dönüşümü buna bağlı,
    // renderer listeyi istemeden de hazır olsun.
    listScreenSources().catch(() => {});
    const cfg = loadConfig() || {};
    if (cfg.autoUpdate) setTimeout(() => updater.check(false), 8000);
  });
});

// GPU süreci çökerse (sanal makinelerde tipik) uyumluluk modunu kalıcı olarak açıp
// bir kez yeniden başlatıyoruz. vmDetected diske yazıldığı için bu döngüye girmez.
app.on('child-process-gone', (_event, details) => {
  console.error('[alt süreç] öldü:', details.type, details.reason, 'çıkış kodu', details.exitCode);
  const cfg = loadConfig();
  if (details.type === 'GPU' && cfg && cfg.vmMode === 'auto' && !cfg.vmDetected) {
    cfg.vmDetected = true;
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
  setGhostMode(false); // yarım kalan sürüklemeyi bitirip gerçek imleci iade et
  stopSysInfo();
  fileIO.closeAll();
  if (powerBlockerId !== null) {
    try { powerSaveBlocker.stop(powerBlockerId); } catch { /* zaten durmuş */ }
    powerBlockerId = null;
  }
  // Çözünürlük değiştirilmişse geri koy; köprü stdin'i kapatılmadan ÖNCE.
  if (originalDisplayMode) {
    const target = originalDisplayMode;
    originalDisplayMode = null;
    writeInput({ t: 'ds', dev: target.dev, w: target.w, h: target.h, hz: target.hz || 0, id: 0 });
  }
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
    hasPassword: !!cfg.hostPasswordRecord,
    turn: cfg.turn,
    clipboardSync: cfg.clipboardSync,
    // v3.1.5 düzeltmesi: bu iki alan listede yoktu, dolayısıyla arayüz her açılışta
    // "tepsiye in" kutusunu kayıtlı değerden bağımsız olarak işaretli gösteriyordu.
    minimizeToTray: cfg.minimizeToTray !== false,
    theme: cfg.theme || 'system',
    captureSourceId: cfg.captureSourceId,
    iceServers: buildIceServers(cfg),
    iceMode: cfg.iceMode || 'auto',
    iceTransportPolicy: iceTransportPolicy(cfg),
    // v4.0
    version: app.getVersion(),
    updateUrl: cfg.updateUrl,
    autoUpdate: cfg.autoUpdate,
    vmMode: cfg.vmMode,
    vmDetected: cfg.vmDetected,
    vmCompatActive,
    remoteSession: platform.isRemoteSession(),
    chatEnabled: cfg.chatEnabled,
    fileTransfer: cfg.fileTransfer,
    autoAcceptFiles: cfg.autoAcceptFiles,
    downloadDir: cfg.downloadDir,
    shareSystemInfo: cfg.shareSystemInfo,
    allowRemoteResolution: cfg.allowRemoteResolution,
    allowWindowCapture: cfg.allowWindowCapture,
    sessionWindow: cfg.sessionWindow,
    recordBitrate: cfg.recordBitrate,
    videoCodec: cfg.videoCodec,
    preventSleep: cfg.preventSleep,
    autoStart: autoStartQuery(),
    portable: platform.isPortableBuild(),
    trustedDevices: Object.entries(cfg.trustedDevices).map(([hwid, info]) => ({
      hwid,
      name: info.name,
      addedAt: info.addedAt,
      lastSeen: info.lastSeen,
    })),
  };
}

ipcMain.handle('get-config', () => publicConfig(loadConfig()));

// Tema, sayfanın ilk satırı çizilmeden önce gerekiyor: preload bunu senkron olarak
// okuyup <head> içindeki script'e veriyor. Böylece koyu tema seçiliyken açık bir
// kare (ya da tersi) hiç görünmüyor. Ayarlar bellekte olduğu için maliyeti ~0.
ipcMain.on('get-initial-theme', (e) => {
  e.returnValue = (loadConfig() || {}).theme || 'system';
});

ipcMain.on('get-app-version', (e) => { e.returnValue = app.getVersion(); });

const BOOLEAN_SETTINGS = [
  'clipboardSync', 'minimizeToTray', 'autoUpdate', 'chatEnabled', 'fileTransfer',
  'autoAcceptFiles', 'shareSystemInfo', 'allowRemoteResolution', 'allowWindowCapture',
  'sessionWindow', 'preventSleep',
];

ipcMain.handle('save-settings', (_e, patch) => {
  const settings = patch || {};
  const cfg = loadConfig();

  if (typeof settings.password === 'string' && settings.password.length > 0) {
    // Arayüz düz parolayı gönderiyor, diske yalnızca scrypt özeti yazılıyor.
    const sha = crypto.createHash('sha256').update(settings.password).digest('hex');
    cfg.hostPasswordRecord = makePasswordRecord(sha);
  }
  if (settings.clearPassword === true) cfg.hostPasswordRecord = null;
  if (typeof settings.signalingUrl === 'string' && settings.signalingUrl.length > 0) {
    cfg.signalingUrl = settings.signalingUrl;
  }
  if (['auto', 'stun-only', 'turn-only'].includes(settings.iceMode)) cfg.iceMode = settings.iceMode;
  if (settings.turn && typeof settings.turn === 'object') {
    cfg.turn = {
      url: typeof settings.turn.url === 'string' ? settings.turn.url.trim() : '',
      username: typeof settings.turn.username === 'string' ? settings.turn.username : '',
      credential: typeof settings.turn.credential === 'string' ? settings.turn.credential : '',
    };
  }
  for (const key of BOOLEAN_SETTINGS) {
    if (typeof settings[key] === 'boolean') cfg[key] = settings[key];
  }
  if (typeof settings.updateUrl === 'string') cfg.updateUrl = settings.updateUrl.trim();
  if (['auto', 'on', 'off'].includes(settings.vmMode)) cfg.vmMode = settings.vmMode;
  if (['auto', 'h264', 'vp8', 'vp9', 'av1'].includes(settings.videoCodec)) cfg.videoCodec = settings.videoCodec;
  if (typeof settings.recordBitrate === 'number' && settings.recordBitrate > 0) {
    cfg.recordBitrate = Math.min(80, Math.max(1, settings.recordBitrate));
  }
  if (typeof settings.downloadDir === 'string') cfg.downloadDir = settings.downloadDir;
  if (['system', 'light', 'dark'].includes(settings.theme)) {
    cfg.theme = settings.theme;
    // Pencerenin arka planı da değişsin: yeniden boyutlama/geri getirme anında
    // eski temanın rengi bir an görünmesin.
    for (const win of [mainWindow, sessionWindow]) {
      if (win && !win.isDestroyed()) {
        try { win.setBackgroundColor(themeBackground(settings.theme)); } catch { /* eski Electron */ }
      }
    }
    toSession({ t: 'theme', theme: settings.theme });
  }

  saveConfig(cfg);
  refreshTray();
  return publicConfig(cfg);
});

ipcMain.handle('set-auto-start', (_e, enabled) => {
  const result = autoStartSet(!!enabled);
  return { ...result, autoStart: autoStartQuery(true) };
});

ipcMain.handle('choose-download-dir', async () => {
  const res = await dialog.showOpenDialog({
    title: 'Gelen dosyaların kaydedileceği klasör',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (res.canceled || !res.filePaths.length) return { canceled: true };
  const cfg = loadConfig();
  cfg.downloadDir = res.filePaths[0];
  saveConfig(cfg);
  return { ok: true, path: cfg.downloadDir, config: publicConfig(cfg) };
});

ipcMain.handle('export-config', () => exportConfig());
ipcMain.handle('import-config', () => importConfig());

// Gelen dosya onayı. Oturum penceresi kapalı olabileceği ve arka planda kalabileceği
// için soru işletim sistemi diyaloğuyla soruluyor: her koşulda görünür.
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
    message: 'Bağlı cihaz bir dosya göndermek istiyor:',
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

ipcMain.handle('check-update', () => updater.check(true));
ipcMain.handle('install-update', () => updater.install());
ipcMain.handle('get-update-state', () => updater.getState());

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
  // Kaynak değişti: önbellekteki pencere sınırı artık yanlış.
  windowRectCache = { hwnd: 0, rect: null, at: 0 };
  saveConfig(cfg);
  return publicConfig(cfg);
});

// Yakalama sesli başlatılamadıysa renderer sessiz olarak yeniden deniyor.
ipcMain.on('set-capture-audio', (_e, enabled) => { captureAudioEnabled = !!enabled; });

ipcMain.handle('list-display-modes', () => listDisplayModes());
ipcMain.handle('set-display-mode', (_e, { w, h, hz }) => setDisplayMode(w, h, hz));
ipcMain.handle('restore-display-mode', async () => { await restoreDisplayMode(); return true; });

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

  if (!cfg.hostPasswordRecord) {
    return { accept: false, reason: 'Host parolası ayarlanmamış.', config: publicConfig(cfg) };
  }

  if (verifyPasswordRecord(cfg.hostPasswordRecord, passwordHash)) {
    if (hwid) {
      cfg.trustedDevices[hwid] = { name: deviceName || 'Adsız cihaz', addedAt: now, lastSeen: now };
      saveConfig(cfg);
    }
    return { accept: true, config: publicConfig(cfg) };
  }

  return { accept: false, reason: 'Parola hatalı.', config: publicConfig(cfg) };
});

ipcMain.on('input', (_e, cmd) => writeInput(cmd));

// ---- İkinci imleç ----
ipcMain.on('ghost-mode', (_e, on) => setGhostMode(on));
ipcMain.on('ghost-move', (_e, { u, v }) => moveGhost(u, v));
ipcMain.on('ghost-button', (_e, { btn, down }) => {
  if (!ghostMode) return;
  writeInput({ t: 'gb', btn, down: !!down });
});
ipcMain.on('ghost-wheel', (_e, { delta, h }) => {
  if (!ghostMode) return;
  writeInput({ t: 'gw', delta, h: !!h });
});

// ---- v4.0: oturum yaşam döngüsü ----

ipcMain.on('session-start', (_e, info) => {
  const cfg = loadConfig() || {};
  // Her yeni oturumda sesli yakalamayı yeniden dene: ses aygıtı bu arada
  // takılmış olabilir.
  captureAudioEnabled = true;
  openSessionWindow(info || {});
  if (cfg.shareSystemInfo) startSysInfo();
  if (cfg.preventSleep && powerBlockerId === null) {
    // Oturum sürerken makine uykuya dalarsa bağlantı kopar ve host'a bir daha
    // erişilemez; uzaktan uyandırmanın yolu yok.
    try { powerBlockerId = powerSaveBlocker.start('prevent-display-sleep'); } catch { powerBlockerId = null; }
  }
});

ipcMain.on('session-end', () => {
  closeSessionWindow();
  stopSysInfo();
  restoreDisplayMode();
  if (powerBlockerId !== null) {
    try { powerSaveBlocker.stop(powerBlockerId); } catch { /* zaten durmuş */ }
    powerBlockerId = null;
  }
});

// Ana pencere (WebRTC sahibi) -> oturum penceresi
ipcMain.on('session-push', (_e, payload) => toSession(payload));
// Oturum penceresi -> ana pencere
ipcMain.on('session-action', (_e, payload) => toRenderer('session-action', payload));
ipcMain.on('session-close', () => closeSessionWindow());

ipcMain.on('set-status', (_e, status) => {
  console.log('[STATUS]', status);
  if (typeof status === 'string' && status.length) {
    trayStatus = status;
    refreshTray();
  }
});
