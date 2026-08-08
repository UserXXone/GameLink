// GameLink v4.0 — Ortak platform yardımcıları (günlük, sanal makine tespiti, güncelleyici)
//
// Bu dosyanın BİREBİR AYNISI host/ ve client/ altında bulunur; bkz. file-transfer.js
// başındaki not.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { app } = require('electron');

// ---------------- Dosyaya günlük ----------------
//
// "VDS'de çöküyor" gibi sorunlar ekran görüntüsüyle teşhis edilemiyor: pencere
// hiç açılmadan süreç ölüyor olabiliyor. Konsol çıktısı ve yakalanmamış hatalar
// artık diske de yazılıyor; kullanıcı tek dosya gönderince ne olduğu görülüyor.

const MAX_LOG_BYTES = 2 * 1024 * 1024;

function createLogger(fileName) {
  let stream = null;
  let logPath = null;

  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    logPath = path.join(dir, fileName);
    // Basit döndürme: dosya büyüdüyse bir öncekinin üzerine yaz.
    try {
      if (fs.statSync(logPath).size > MAX_LOG_BYTES) {
        fs.renameSync(logPath, logPath + '.1');
      }
    } catch { /* dosya yok, sorun değil */ }
    stream = fs.createWriteStream(logPath, { flags: 'a' });
  } catch {
    stream = null; // salt okunur profil: günlük olmadan devam
  }

  function write(level, args) {
    if (!stream) return;
    const line = args.map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return a.stack || a.message;
      try { return JSON.stringify(a); } catch { return String(a); }
    }).join(' ');
    try { stream.write(`${new Date().toISOString()} [${level}] ${line}\n`); } catch { /* disk doldu */ }
  }

  const original = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...a) => { original.log(...a); write('bilgi', a); };
  console.warn = (...a) => { original.warn(...a); write('uyari', a); };
  console.error = (...a) => { original.error(...a); write('hata', a); };

  process.on('uncaughtException', (err) => {
    console.error('YAKALANMAYAN HATA:', err);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('YAKALANMAYAN REDDETME:', reason);
  });

  console.log(`--- GameLink ${app.getVersion()} başladı --- ${os.version ? os.version() : ''} ${process.arch} electron ${process.versions.electron}`);
  return { path: logPath, write };
}

// Renderer'daki (arayüz) hatalar ana sürecin konsoluna düşmez; pencere hiç
// açılmadığında ya da uzaktaki bir makinede sorun çıktığında görülemezler.
// Uyarı ve hata seviyesindekiler günlüğe aktarılıyor; bilgi/ayrıntı satırları
// dosyayı şişirmesin diye elenmiş durumda.
function attachRendererLogging(win, label) {
  if (!win || win.isDestroyed()) return;
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level < 2) return;
    const where = sourceId ? ` (${String(sourceId).split(/[\\/]/).pop()}:${line})` : '';
    const text = `[${label}] ${message}${where}`;
    if (level >= 3) console.error(text);
    else console.warn(text);
  });
  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`[${label}] preload hatası (${preloadPath}):`, error && error.message);
  });
  win.webContents.on('did-fail-load', (_event, code, description) => {
    console.error(`[${label}] sayfa yüklenemedi: ${description} (${code})`);
  });
}

// ---------------- Sanal makine / VDS tespiti ----------------
//
// VDS ve sanal makinelerde GPU ya hiç yok ya da yazılım öykünmesi; Chromium'un
// donanım hızlandırması orada GPU sürecini çökertebiliyor ve uygulama hiç
// açılmıyor. Hızlandırmayı kapatmaya app.whenReady()'DEN ÖNCE karar vermek
// gerektiği için tespit senkron: kayıt defterinden BIOS bilgisi okunuyor
// (~50 ms) ve sonuç ayar dosyasına yazılıyor, sonraki açılışlarda hiç çalışmıyor.

const VM_MARKERS = [
  'vmware', 'virtualbox', 'innotek', 'qemu', 'kvm', 'xen', 'bochs', 'parallels',
  'virtual machine', 'hyper-v', 'virtual platform', 'openstack', 'proxmox',
  'bhyve', 'amazon ec2', 'google compute', 'alibaba cloud', 'oracle vm',
];

function detectVirtualMachineSync() {
  let text = '';
  try {
    text = execFileSync(
      'reg',
      ['query', 'HKLM\\HARDWARE\\DESCRIPTION\\System\\BIOS'],
      { encoding: 'utf8', timeout: 4000, windowsHide: true }
    );
  } catch {
    return { vm: false, detected: false };
  }
  const lower = text.toLowerCase();
  const vm = VM_MARKERS.some((m) => lower.includes(m));
  return { vm, detected: true };
}

// Uzak masaüstü oturumunda mıyız? VDS'de sık: oturum kesilince masaüstü yok olur,
// ekran yakalama ve girdi enjeksiyonu sessizce çalışmaz.
function isRemoteSession() {
  return typeof process.env.SESSIONNAME === 'string' && /^RDP-/i.test(process.env.SESSIONNAME);
}

// Taşınabilir (portable) sürümde otomatik güncelleme yapılamaz: kurulum dizini yok.
function isPortableBuild() {
  return !!process.env.PORTABLE_EXECUTABLE_DIR;
}

// ---------------- Otomatik güncelleme ----------------
//
// electron-updater'ın "generic" sağlayıcısı kullanılıyor: kurulum dosyaları ve
// electron-builder'ın ürettiği latest.yml herhangi bir HTTPS dizininde durabilir
// (kendi sunucunuz) ya da bir ağ/disk yolu verilebilir. Adres boşken güncelleme
// tamamen sessizce devre dışıdır.

function createUpdater(options) {
  const opts = options || {};
  const getFeedUrl = opts.getFeedUrl || (() => '');
  const notify = opts.notify || (() => {});

  let autoUpdater = null;
  let loadError = null;
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (err) {
    loadError = err.message;
  }

  let state = { status: 'idle', message: '', version: null, percent: 0 };
  let wired = false;

  function setState(next) {
    state = Object.assign({}, state, next);
    notify(state);
  }

  function unavailableReason() {
    if (loadError) return 'Güncelleme bileşeni yüklenemedi: ' + loadError;
    if (!app.isPackaged) return 'Geliştirme modunda güncelleme denetlenmez.';
    if (isPortableBuild()) return 'Taşınabilir sürüm kendini güncelleyemez; kurulum sürümünü kullanın.';
    if (!getFeedUrl()) return 'Güncelleme sunucusu adresi girilmemiş.';
    return null;
  }

  function wire() {
    if (wired || !autoUpdater) return;
    wired = true;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = { info: console.log, warn: console.warn, error: console.error, debug: () => {} };

    autoUpdater.on('checking-for-update', () => setState({ status: 'checking', message: 'Güncelleme denetleniyor...' }));
    autoUpdater.on('update-available', (info) => setState({ status: 'downloading', version: info.version, percent: 0, message: `Sürüm ${info.version} indiriliyor...` }));
    autoUpdater.on('update-not-available', () => setState({ status: 'current', message: 'Program güncel.' }));
    autoUpdater.on('download-progress', (p) => setState({ status: 'downloading', percent: Math.round(p.percent), message: `İndiriliyor %${Math.round(p.percent)}` }));
    autoUpdater.on('update-downloaded', (info) => setState({ status: 'ready', version: info.version, percent: 100, message: `Sürüm ${info.version} hazır. Yeniden başlatınca kurulacak.` }));
    autoUpdater.on('error', (err) => setState({ status: 'error', message: 'Güncelleme hatası: ' + (err && err.message) }));
  }

  async function check(manual) {
    const reason = unavailableReason();
    if (reason) {
      setState({ status: manual ? 'unavailable' : 'idle', message: manual ? reason : '' });
      return state;
    }
    wire();
    try {
      autoUpdater.setFeedURL({ provider: 'generic', url: getFeedUrl() });
      await autoUpdater.checkForUpdates();
    } catch (err) {
      setState({ status: 'error', message: 'Güncelleme denetlenemedi: ' + err.message });
    }
    return state;
  }

  function install() {
    if (!autoUpdater || state.status !== 'ready') return false;
    // isSilent=false: NSIS kurulum ekranını göster; isForceRunAfter=true: kurulum
    // bitince programı tekrar aç.
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return true;
  }

  return {
    check,
    install,
    getState: () => state,
    isAvailable: () => !unavailableReason(),
    unavailableReason,
  };
}

module.exports = {
  createLogger,
  attachRendererLogging,
  detectVirtualMachineSync,
  isRemoteSession,
  isPortableBuild,
  createUpdater,
};
