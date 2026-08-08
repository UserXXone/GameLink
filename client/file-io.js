// GameLink v4.0 — Ana süreç dosya G/Ç'si (dosya aktarımı ve ekran kaydı için)
//
// Bu dosyanın BİREBİR AYNISI host/ ve client/ altında bulunur; bkz. file-transfer.js
// başındaki not.
//
// Renderer'a fs verilmiyor (contextIsolation açık). Bunun yerine burada tutulan
// açık dosya tanıtıcıları üzerinden sıralı okuma/yazma yapılıyor: aktarılan dosya
// hiçbir zaman bütün olarak belleğe alınmıyor, 64 KB'lık parçalar hâlinde akıyor.

const fs = require('fs');
const path = require('path');
const { ipcMain, dialog, shell, app } = require('electron');

const handles = new Map();   // numara -> { fd, path, mode, written }
let nextHandle = 1;

// Gelen dosyanın adını KARŞI TARAF belirliyor. Doğrudan kullanmak dizin dışına
// yazmaya (..\..\Windows\System32\...) izin verirdi; ad tamamen sterilize ediliyor.
const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i;

function safeName(name) {
  let base = path.basename(String(name == null ? '' : name));
  // Denetim karakterleri (0-31) dosya adinda gecersizdir; kacis dizisi yerine
  // kod noktasina bakarak eliyoruz.
  base = Array.from(base).filter((ch) => ch.charCodeAt(0) >= 32).join('');
  base = base.replace(/[<>:"/\\|?*]/g, '_');
  base = base.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
  if (!base) base = 'dosya';
  if (RESERVED.test(base)) base = '_' + base;
  if (base.length > 180) {
    const ext = path.extname(base).slice(0, 20);
    base = base.slice(0, 180 - ext.length) + ext;
  }
  return base;
}

function uniquePath(dir, name) {
  const ext = path.extname(name);
  const stem = path.basename(name, ext);
  let candidate = path.join(dir, name);
  let i = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${stem} (${i})${ext}`);
    i += 1;
    if (i > 9999) break;
  }
  return candidate;
}

function closeHandle(id) {
  const h = handles.get(id);
  if (!h) return null;
  handles.delete(id);
  try { fs.closeSync(h.fd); } catch { /* zaten kapalı olabilir */ }
  return h;
}

function closeAll() {
  for (const id of Array.from(handles.keys())) {
    const h = handles.get(id);
    closeHandle(id);
    // Yarım kalmış indirmeyi bırakma: parçalı dosya kullanıcıyı yanıltır.
    if (h && h.mode === 'w') { try { fs.unlinkSync(h.path); } catch { /* yok sayılır */ } }
  }
}

// options.folderName: indirilenler/videolar altında açılacak alt klasör adı.
// options.getDownloadDir: kullanıcı özel bir klasör seçtiyse onu döndüren işlev.
function register(options) {
  const opts = options || {};
  const folderName = opts.folderName || 'GameLink';
  const getDownloadDir = opts.getDownloadDir || (() => null);

  function targetDir(kind) {
    let base;
    if (kind === 'videos') {
      base = path.join(app.getPath('videos'), folderName);
    } else {
      base = getDownloadDir() || path.join(app.getPath('downloads'), folderName);
    }
    fs.mkdirSync(base, { recursive: true });
    return base;
  }

  ipcMain.handle('file-pick', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Gönderilecek dosyaları seçin',
      properties: ['openFile', 'multiSelections'],
    });
    if (res.canceled) return [];
    return res.filePaths.map((p) => {
      let size = 0;
      try { size = fs.statSync(p).size; } catch { /* erişilemiyorsa 0 kalır */ }
      return { path: p, name: path.basename(p), size };
    });
  });

  ipcMain.handle('file-open-read', (_e, filePath) => {
    try {
      const size = fs.statSync(filePath).size;
      const fd = fs.openSync(filePath, 'r');
      const id = nextHandle++;
      handles.set(id, { fd, path: filePath, mode: 'r' });
      return { handle: id, size };
    } catch (err) {
      return { error: err.message };
    }
  });

  // Sıralı okuma: konum tutulmuyor, fs.read akışı kendisi ilerletiyor.
  ipcMain.handle('file-read-chunk', (_e, { handle, len }) => {
    const h = handles.get(handle);
    if (!h || h.mode !== 'r') return new Uint8Array(0);
    const buf = Buffer.allocUnsafe(Math.max(0, Math.min(len | 0, 1024 * 1024)));
    let read = 0;
    try { read = fs.readSync(h.fd, buf, 0, buf.length, null); } catch { read = 0; }
    // Tam boyutlu bir kopya döndürülüyor: yapılandırılmış kopyalama (IPC) bir
    // görünümü değil altındaki ArrayBuffer'ın tamamını taşır.
    return new Uint8Array(buf.subarray(0, read));
  });

  ipcMain.on('file-close-read', (_e, handle) => { closeHandle(handle); });

  ipcMain.handle('file-open-write', (_e, arg) => {
    const req = typeof arg === 'string' ? { name: arg } : (arg || {});
    try {
      const dir = targetDir(req.dir);
      const full = uniquePath(dir, safeName(req.name));
      const fd = fs.openSync(full, 'w');
      const id = nextHandle++;
      handles.set(id, { fd, path: full, mode: 'w', written: 0 });
      return { handle: id, path: full };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('file-write-chunk', (_e, { handle, data }) => {
    const h = handles.get(handle);
    if (!h || h.mode !== 'w') return { error: 'Geçersiz dosya tanıtıcısı.' };
    try {
      const buf = Buffer.from(data.buffer || data, data.byteOffset || 0, data.byteLength || data.length);
      fs.writeSync(h.fd, buf, 0, buf.length, null);
      h.written += buf.length;
      return { ok: true, written: h.written };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('file-close-write', (_e, handle) => {
    const h = closeHandle(handle);
    return h ? { path: h.path, size: h.written } : { error: 'Geçersiz dosya tanıtıcısı.' };
  });

  ipcMain.on('file-abort-write', (_e, handle) => {
    const h = closeHandle(handle);
    if (h) { try { fs.unlinkSync(h.path); } catch { /* yok sayılır */ } }
  });

  ipcMain.handle('file-target-dir', (_e, kind) => {
    try { return targetDir(kind); } catch { return null; }
  });

  ipcMain.on('reveal-path', (_e, p) => {
    if (typeof p === 'string' && p) shell.showItemInFolder(p);
  });

  ipcMain.on('open-path', (_e, p) => {
    if (typeof p === 'string' && p) shell.openPath(p);
  });
}

module.exports = { register, closeAll, safeName, uniquePath };
