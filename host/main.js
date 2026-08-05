const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { app, BrowserWindow, ipcMain, desktopCapturer, session, screen, clipboard, Tray, Menu, nativeImage, nativeTheme } = require('electron');
const { machineIdSync } = require('node-machine-id');

let CONFIG_PATH; // app hazır olunca (userData yolu) belirlenecek
// Ayarlar dosyası yalnızca bu süreç tarafından yazılıyor; bu yüzden bellekte
// tutulabilir. Öncesinde her tepsi yenilemesi, her pencere olayı ve her IPC
// çağrısı diskten senkron okuma yapıyordu (yüzlerce gereksiz readFileSync).
let configCache = null;
let tray = null;
let isQuitting = false;
let trayStatus = 'Bekleniyor';
let mainWindow;
let psProcess;
let bridgeStopping = false;

// Ekran paylaşımı isteği geldiğinde hangi kaynağın verileceği. Renderer, monitör
// değiştirmek istediğinde önce burayı günceller, sonra getDisplayMedia'yı tekrar çağırır.
let selectedSourceId = null;

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

function loadConfig() {
  if (configCache) return configCache;

  let raw;
  try {
    raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  } catch {
    return null; // dosya henüz yok: ensureConfig temiz bir yapılandırma kuracak
  }

  try {
    const cfg = JSON.parse(stripBom(raw));
    if (!cfg.trustedDevices) cfg.trustedDevices = {};
    if (!cfg.turn) cfg.turn = { ...DEFAULT_TURN };
    if (typeof cfg.clipboardSync !== 'boolean') cfg.clipboardSync = true;
    if (!('captureSourceId' in cfg)) cfg.captureSourceId = null;
    if (!['auto', 'stun-only', 'turn-only'].includes(cfg.iceMode)) cfg.iceMode = 'auto';
    if (typeof cfg.minimizeToTray !== 'boolean') cfg.minimizeToTray = true;
    if (!['system', 'light', 'dark'].includes(cfg.theme)) cfg.theme = 'system';
    configCache = cfg;
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
      theme: 'system',
      captureSourceId: null,
    };
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

// ---------------- Ekran kaynakları ----------------

async function listScreenSources() {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 0, height: 0 },
  });
  const displays = screen.getAllDisplays();
  sourceDisplayMap.clear();
  fallbackSourceId = sources.length ? sources[0].id : null;
  return sources.map((s, i) => {
    const display = displays.find((d) => String(d.id) === String(s.display_id))
      || displays[i]
      || screen.getPrimaryDisplay();
    if (display) sourceDisplayMap.set(s.id, display.id);
    const size = display ? `${display.size.width}×${display.size.height}` : null;
    return {
      id: s.id,
      name: size ? `Ekran ${i + 1} — ${size}` : s.name || `Ekran ${i + 1}`,
      primary: display ? display.id === screen.getPrimaryDisplay().id : i === 0,
    };
  });
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
    // Pencere boş haldeyken gösterilmiyor: HTML ilk karesini çizene kadar bekliyoruz.
    // Eskiden önce beyaz bir çerçeve açılıp sonra arayüz oturuyordu.
    show: false,
    backgroundColor: themeBackground((loadConfig() || {}).theme),
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
  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  });

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

  // Pencere gerçekten yok edildiyse referansı bırak: tepsi menüsü yok edilmiş bir
  // pencereye dokunursa "Object has been destroyed" ile çöküyordu. Katman penceresi
  // de burada kapanmalı, yoksa görünmez bir pencere uygulamayı ayakta tutar.
  mainWindow.on('closed', () => {
    mainWindow = null;
    setGhostMode(false);
  });
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

// Client oranlı (0..1) konum gönderir; burada önce paylaşılan monitörün DIP
// sınırlarına, sonra dipToScreenPoint ile GERÇEK piksel koordinatına çevrilir.
// PowerShell köprüsü DPI farkında olduğu için fiziksel piksel bekliyor.
function moveGhost(u, v) {
  if (!ghostMode) return;
  const bounds = captureDisplay().bounds;
  const dip = {
    x: Math.round(bounds.x + clamp01(u) * (bounds.width - 1)),
    y: Math.round(bounds.y + clamp01(v) * (bounds.height - 1)),
  };

  let physical;
  try {
    physical = screen.dipToScreenPoint(dip);
  } catch {
    physical = dip; // Windows dışı / API yoksa DIP zaten piksel demektir
  }

  if (!lastGhostPoint || lastGhostPoint.x !== physical.x || lastGhostPoint.y !== physical.y) {
    lastGhostPoint = physical;
    writeInput({ t: 'gp', x: physical.x, y: physical.y });
  }

  // Katman penceresi DIP koordinatlarıyla konumlanır (setPosition DIP bekler).
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.setPosition(dip.x - GHOST_HOTSPOT, dip.y - GHOST_HOTSPOT);
  }
}

// ---------------- Girdi enjeksiyon köprüsü (PowerShell, kalıcı süreç) ----------------

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
  migrateLegacyUserData();
  ensureConfig();
  setupDisplayMediaHandler();

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
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  setGhostMode(false); // yarım kalan sürüklemeyi bitirip gerçek imleci iade et
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
    // v3.1.5 düzeltmesi: bu iki alan listede yoktu, dolayısıyla arayüz her açılışta
    // "tepsiye in" kutusunu kayıtlı değerden bağımsız olarak işaretli gösteriyordu.
    minimizeToTray: cfg.minimizeToTray !== false,
    theme: cfg.theme || 'system',
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

// Tema, sayfanın ilk satırı çizilmeden önce gerekiyor: preload bunu senkron olarak
// okuyup <head> içindeki script'e veriyor. Böylece koyu tema seçiliyken açık bir
// kare (ya da tersi) hiç görünmüyor. Ayarlar bellekte olduğu için maliyeti ~0.
ipcMain.on('get-initial-theme', (e) => {
  e.returnValue = (loadConfig() || {}).theme || 'system';
});

ipcMain.handle('save-settings', (_e, { password, signalingUrl, turn, clipboardSync, iceMode, minimizeToTray, theme }) => {
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
  if (['system', 'light', 'dark'].includes(theme)) {
    cfg.theme = theme;
    // Pencerenin arka planı da değişsin: yeniden boyutlama/geri getirme anında
    // eski temanın rengi bir an görünmesin.
    if (mainWindow && !mainWindow.isDestroyed()) {
      try { mainWindow.setBackgroundColor(themeBackground(theme)); } catch { /* eski Electron */ }
    }
  }
  saveConfig(cfg);
  refreshTray();
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

ipcMain.on('set-status', (_e, status) => {
  console.log('[STATUS]', status);
  if (typeof status === 'string' && status.length) {
    trayStatus = status;
    refreshTray();
  }
});
