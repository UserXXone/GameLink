const $ = (id) => document.getElementById(id);

let ws;
let pc;
let mouseDc, keysDc, controlDc, filesDc;
let config;
let reconnectTimer;
let connectedDeviceName = null;
let connectedHwid = null;
let connectedAt = 0;
let captureStream = null;
let lastSettings = null;
let clipboardTimer = null;
let lastClipboardText = '';
let statsTimer = null;
let lastStatsSample = null;
let cursorMode = 'single';

// v4.0: dosya aktarımı, kayıt, sistem bilgisi
let fileTransfer = null;
let recorder = null;
let recordHandle = null;
let recordPath = null;
let recordStartedAt = 0;
let recordQueue = Promise.resolve();
let systemStatic = null;

function log(msg) {
  console.log(msg);
  const box = $('logBox');
  const time = new Date().toLocaleTimeString('tr-TR');
  box.textContent += `[${time}] ${msg}\n`;
  box.scrollTop = box.scrollHeight;
  window.hostAPI.setStatus(msg);
}

function setStatus(text, state) {
  $('statusText').textContent = text;
  $('statusDot').className = 'dot' + (state ? ' ' + state : '');
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s == null ? '' : String(s);
  return div.innerHTML;
}

const formatBytes = (n) => window.GLFileTransfer.formatBytes(n);

// ---------------- Sekmeler ----------------

document.querySelectorAll('#tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.panel').forEach((p) => {
      p.classList.toggle('active', p.id === 'panel-' + btn.dataset.tab);
    });
  });
});

// ---------------- Tema ----------------
// Tercih üç değerden biri: 'system' | 'light' | 'dark'. 'system' seçiliyken Windows'un
// açık/koyu ayarı izlenir ve kullanıcı orada geçiş yaparsa arayüz anında uyum sağlar.
// İlk tema, sayfa çizilmeden index.html'deki küçük script tarafından uygulanır;
// burada yalnızca sonraki değişiklikler yönetiliyor.

const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme(pref) {
  const dark = pref === 'dark' || (pref !== 'light' && systemThemeQuery.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelectorAll('#themeSeg button').forEach((b) => {
    b.classList.toggle('active', b.dataset.theme === pref);
  });
}

systemThemeQuery.addEventListener('change', () => {
  if (!config || (config.theme || 'system') === 'system') applyTheme('system');
});

document.querySelectorAll('#themeSeg button').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const theme = btn.dataset.theme;
    applyTheme(theme); // tıklamaya anında tepki ver, kaydı arkadan yap
    await refreshConfigUI(await window.hostAPI.saveSettings({ theme }));
  });
});

// ---------------- GUI: config yükleme / render ----------------

async function refreshConfigUI(cfg) {
  config = cfg;
  applyTheme(cfg.theme || 'system');
  $('versionText').textContent = 'v' + cfg.version + (cfg.portable ? ' · taşınabilir' : '');
  $('codeDisplay').textContent = cfg.hostCode;
  $('urlInput').value = cfg.signalingUrl;
  $('passwordInput').placeholder = cfg.hasPassword ? '•••••••• (ayarlı)' : 'Henüz parola ayarlanmadı';
  $('turnUrlInput').value = cfg.turn.url || '';
  $('turnUserInput').value = cfg.turn.username || '';
  $('turnPassInput').value = cfg.turn.credential || '';
  $('iceModeSelect').value = cfg.iceMode || 'auto';

  $('clipboardToggle').checked = !!cfg.clipboardSync;
  $('trayToggle').checked = cfg.minimizeToTray !== false;
  $('chatToggle').checked = !!cfg.chatEnabled;
  $('fileTransferToggle').checked = !!cfg.fileTransfer;
  $('autoAcceptToggle').checked = !!cfg.autoAcceptFiles;
  $('sysInfoToggle').checked = !!cfg.shareSystemInfo;
  $('allowResolutionToggle').checked = !!cfg.allowRemoteResolution;
  $('allowWindowCaptureToggle').checked = !!cfg.allowWindowCapture;
  $('sessionWindowToggle').checked = !!cfg.sessionWindow;
  $('autoStartToggle').checked = !!cfg.autoStart;
  $('autoUpdateToggle').checked = !!cfg.autoUpdate;
  $('updateUrlInput').value = cfg.updateUrl || '';
  $('vmModeSelect').value = cfg.vmMode || 'auto';
  $('recordBitrateInput').value = cfg.recordBitrate || 12;
  $('codecSelect').value = cfg.videoCodec || 'auto';
  $('downloadDirText').textContent = 'Kayıt klasörü: ' + (cfg.downloadDir || 'İndirilenler\\GameLink (varsayılan)');

  updateIceModeWarning(cfg);
  updateVmBanner(cfg);
  renderDeviceList(cfg.trustedDevices);
}

function updateVmBanner(cfg) {
  const parts = [];
  if (cfg.vmCompatActive) {
    parts.push('Sanal makine / VDS uyumluluk modu etkin — donanım hızlandırma kapalı.');
  } else if (cfg.vmDetected) {
    parts.push('Sanal makine algılandı ama uyumluluk modu kapalı. Görüntü sorunları olursa Program sekmesinden açın.');
  }
  if (cfg.remoteSession) {
    parts.push('Uzak masaüstü (RDP) oturumundasınız: oturumu kapatırsanız masaüstü yok olur ve ekran paylaşımı durur. Oturumu kapatmak yerine pencereyi kapatın.');
  }
  const banner = $('vmBanner');
  banner.classList.toggle('show', parts.length > 0);
  $('vmBannerText').textContent = parts.join(' ');
}

function renderDeviceList(devices) {
  const container = $('deviceList');
  container.innerHTML = '';
  if (!devices || devices.length === 0) {
    container.innerHTML = '<div class="empty-note">Henüz güvenilir cihaz yok. İlk bağlantıda parola ile giren cihaz otomatik eklenir.</div>';
    return;
  }
  for (const d of devices) {
    const item = document.createElement('div');
    item.className = 'device-item';
    const last = d.lastSeen ? new Date(d.lastSeen).toLocaleString('tr-TR') : '-';
    item.innerHTML = `
      <div class="info">
        <div class="name">${escapeHtml(d.name || 'Adsız cihaz')}</div>
        <div class="meta">Son görülme: ${last}</div>
      </div>
    `;
    const removeBtn = document.createElement('button');
    removeBtn.className = 'danger';
    removeBtn.textContent = 'Kaldır';
    removeBtn.onclick = async () => {
      refreshConfigUI(await window.hostAPI.removeTrustedDevice(d.hwid));
      log(`Güvenilir cihaz kaldırıldı: ${d.name}`);
    };
    item.appendChild(removeBtn);
    container.appendChild(item);
  }
}

async function refreshSourceList() {
  const sources = await window.hostAPI.listSources();
  const select = $('sourceSelect');
  select.innerHTML = '';

  if (!sources.length) {
    const opt = document.createElement('option');
    opt.textContent = 'Paylaşılabilir kaynak bulunamadı';
    select.appendChild(opt);
    return sources;
  }

  const groups = [
    { label: 'Ekranlar', kind: 'screen' },
    { label: 'Pencereler', kind: 'window' },
  ];
  for (const group of groups) {
    const items = sources.filter((s) => s.kind === group.kind);
    if (!items.length) continue;
    const optGroup = document.createElement('optgroup');
    optGroup.label = group.label;
    for (const s of items) {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name + (s.primary ? ' (birincil)' : '');
      optGroup.appendChild(opt);
    }
    select.appendChild(optGroup);
  }

  const current = config.captureSourceId && sources.some((s) => s.id === config.captureSourceId)
    ? config.captureSourceId
    : sources[0].id;
  select.value = current;
  return sources;
}

// ---------------- GUI: buton olayları ----------------

const DEFAULT_CODE_HINT = 'Bu kodu bağlanacak cihaza verin.';

function flashCopyHint(text) {
  const el = $('copyHint');
  el.textContent = text;
  clearTimeout(flashCopyHint.timer);
  flashCopyHint.timer = setTimeout(() => { el.textContent = DEFAULT_CODE_HINT; }, 2200);
}

function flashHint(id, text, kind) {
  const el = $(id);
  el.textContent = text;
  el.className = 'save-hint' + (kind ? ' ' + kind : '');
  clearTimeout(flashHint['t_' + id]);
  flashHint['t_' + id] = setTimeout(() => { el.textContent = ''; el.className = 'save-hint'; }, 4000);
}

$('copyCodeBtn').addEventListener('click', () => {
  if (!config || !config.hostCode) return;
  window.hostAPI.writeClipboard(config.hostCode);
  flashCopyHint('✓ Kod panoya kopyalandı.');
});

$('regenBtn').addEventListener('click', async () => {
  const updated = await window.hostAPI.regenerateCode();
  await refreshConfigUI(updated);
  flashCopyHint('✓ Yeni kod üretildi.');
  log('Yeni kod üretildi: ' + updated.hostCode);
  reconnectNow(); // yeni kodla sunucuya yeniden kaydol
});

// Açık bir soket varsa kapat: onclose zaten yeniden bağlanmayı tetikler. Böylece
// aynı anda iki soket açılıp sunucudan "Bu kod zaten kullanımda" hatası alınmaz.
function reconnectNow() {
  if (ws && ws.readyState !== WebSocket.CLOSED) ws.close();
  else connect();
}

$('savePasswordBtn').addEventListener('click', async () => {
  const val = $('passwordInput').value;
  if (!val) return;
  await refreshConfigUI(await window.hostAPI.saveSettings({ password: val }));
  $('passwordInput').value = '';
  flashHint('passwordHint', 'Kaydedildi.');
});

$('clearPasswordBtn').addEventListener('click', async () => {
  await refreshConfigUI(await window.hostAPI.saveSettings({ clearPassword: true }));
  flashHint('passwordHint', 'Parola kaldırıldı — artık yalnızca güvenilir cihazlar bağlanabilir.', 'warn');
});

$('saveUrlBtn').addEventListener('click', async () => {
  const val = $('urlInput').value.trim();
  if (!val) return;
  await refreshConfigUI(await window.hostAPI.saveSettings({ signalingUrl: val }));
  flashHint('urlHint', 'Kaydedildi, yeniden bağlanılıyor...');
  reconnectNow();
});

$('saveTurnBtn').addEventListener('click', async () => {
  const updated = await window.hostAPI.saveSettings({
    turn: {
      url: $('turnUrlInput').value.trim(),
      username: $('turnUserInput').value,
      credential: $('turnPassInput').value,
    },
  });
  await refreshConfigUI(updated);
  flashHint('turnHint', updated.turn.url
    ? 'Kaydedildi. Bir sonraki bağlantıda geçerli olur.'
    : 'TURN kapatıldı (sadece STUN kullanılacak).');
});

// TURN tanımlı değilken "sadece TURN" seçmek işe yaramaz; kullanıcıyı uyar.
function updateIceModeWarning(cfg) {
  const hasTurn = !!(cfg.turn && cfg.turn.url);
  const el = $('iceModeHint');
  if ((cfg.iceMode || 'auto') === 'turn-only' && !hasTurn) {
    el.textContent = 'Uyarı: TURN sunucusu tanımlı değil, bu mod uygulanamaz.';
    el.className = 'save-hint warn';
  } else {
    el.textContent = '';
    el.className = 'save-hint';
  }
}

$('iceModeSelect').addEventListener('change', async () => {
  const updated = await window.hostAPI.saveSettings({ iceMode: $('iceModeSelect').value });
  await refreshConfigUI(updated);
  const labels = {
    'auto': 'Otomatik (STUN + TURN)',
    'stun-only': 'Sadece STUN',
    'turn-only': 'Sadece TURN (röle)',
  };
  log(`Bağlantı modu: ${labels[updated.iceMode]}. Sonraki bağlantıda geçerli olur.`);
});

// Basit açma/kapama anahtarları tek bir yerden kaydediliyor.
const TOGGLES = {
  trayToggle: 'minimizeToTray',
  clipboardToggle: 'clipboardSync',
  chatToggle: 'chatEnabled',
  fileTransferToggle: 'fileTransfer',
  autoAcceptToggle: 'autoAcceptFiles',
  sysInfoToggle: 'shareSystemInfo',
  allowResolutionToggle: 'allowRemoteResolution',
  allowWindowCaptureToggle: 'allowWindowCapture',
  sessionWindowToggle: 'sessionWindow',
  autoUpdateToggle: 'autoUpdate',
};

for (const [elementId, key] of Object.entries(TOGGLES)) {
  $(elementId).addEventListener('change', async () => {
    const patch = {};
    patch[key] = $(elementId).checked;
    await refreshConfigUI(await window.hostAPI.saveSettings(patch));

    if (key === 'clipboardSync') {
      if (!config.clipboardSync) stopClipboardSync();
      else if (pc) startClipboardSync();
    }
    if (key === 'allowWindowCapture') await refreshSourceList();
    if (key === 'shareSystemInfo' && !config.shareSystemInfo) {
      sendControl({ t: 'sysinfo-off' });
    }
  });
}

$('sourceSelect').addEventListener('change', async () => {
  await switchSource($('sourceSelect').value);
});

$('refreshSourcesBtn').addEventListener('click', () => refreshSourceList());

// ---------------- v4.0: otomatik başlatma ----------------

$('autoStartToggle').addEventListener('change', async () => {
  const wanted = $('autoStartToggle').checked;
  const result = await window.hostAPI.setAutoStart(wanted);
  $('autoStartToggle').checked = result.autoStart;
  if (result.ok) {
    flashHint('autoStartHint', result.autoStart
      ? 'Görev oluşturuldu: Windows açılışında tepsiye inik olarak başlayacak.'
      : 'Otomatik başlatma kaldırıldı.');
  } else {
    flashHint('autoStartHint', result.reason || 'Ayarlanamadı.', 'err');
  }
});

// ---------------- v4.0: güncelleme ----------------

function renderUpdateState(state) {
  if (!state) return;
  const kinds = { error: 'err', unavailable: 'warn', ready: '', current: '' };
  flashHintPersistent('updateStatus', state.message || '', kinds[state.status] || '');
  $('installUpdateBtn').disabled = state.status !== 'ready';
}

function flashHintPersistent(id, text, kind) {
  const el = $(id);
  el.textContent = text;
  el.className = 'save-hint' + (kind ? ' ' + kind : '');
}

window.hostAPI.onUpdateState(renderUpdateState);

$('saveUpdateUrlBtn').addEventListener('click', async () => {
  await refreshConfigUI(await window.hostAPI.saveSettings({ updateUrl: $('updateUrlInput').value.trim() }));
  flashHint('updateStatus', config.updateUrl ? 'Adres kaydedildi.' : 'Adres boşaltıldı, güncelleme denetimi kapalı.');
});

$('checkUpdateBtn').addEventListener('click', async () => {
  renderUpdateState(await window.hostAPI.checkUpdate());
});

$('installUpdateBtn').addEventListener('click', () => window.hostAPI.installUpdate());

// ---------------- v4.0: sanal makine modu ----------------

$('vmModeSelect').addEventListener('change', async () => {
  await refreshConfigUI(await window.hostAPI.saveSettings({ vmMode: $('vmModeSelect').value }));
  flashHint('vmHint', 'Kaydedildi. Programı yeniden başlatınca geçerli olur.', 'warn');
});

// ---------------- v4.0: ayarları dışa/içe aktarma ----------------

$('exportBtn').addEventListener('click', async () => {
  const result = await window.hostAPI.exportConfig();
  if (result.canceled) return;
  flashHint('configHint', result.ok ? 'Kaydedildi: ' + result.path : (result.reason || 'Yazılamadı.'), result.ok ? '' : 'err');
});

$('importBtn').addEventListener('click', async () => {
  const result = await window.hostAPI.importConfig();
  if (result.canceled) return;
  if (!result.ok) {
    flashHint('configHint', result.reason || 'Okunamadı.', 'err');
    return;
  }
  await refreshConfigUI(result.config);
  await refreshSourceList();
  flashHint('configHint', 'Ayarlar içe aktarıldı, yeniden bağlanılıyor...');
  log('Ayarlar içe aktarıldı.');
  reconnectNow();
});

// ---------------- v4.0: dosya klasörü ----------------

$('downloadDirBtn').addEventListener('click', async () => {
  const result = await window.hostAPI.chooseDownloadDir();
  if (result.canceled) return;
  await refreshConfigUI(result.config);
});

$('openDownloadDirBtn').addEventListener('click', async () => {
  window.hostAPI.fileIO.open(await window.hostAPI.fileIO.targetDir('downloads'));
});

$('openRecordDirBtn').addEventListener('click', async () => {
  window.hostAPI.fileIO.open(await window.hostAPI.fileIO.targetDir('videos'));
});

$('openLogBtn').addEventListener('click', () => window.hostAPI.openLogFolder());

// ---------------- v4.0: ekran çözünürlüğü ----------------

let displayModes = { device: null, current: null, modes: [] };

async function refreshDisplayModes() {
  flashHintPersistent('resolutionHint', 'Modlar okunuyor...', '');
  displayModes = await window.hostAPI.listDisplayModes();
  const select = $('resolutionSelect');
  select.innerHTML = '';

  if (!displayModes.modes.length) {
    const opt = document.createElement('option');
    opt.textContent = 'Mod listesi alınamadı';
    select.appendChild(opt);
    flashHintPersistent('resolutionHint', 'Ekran aygıtı bulunamadı.', 'warn');
    return;
  }

  for (const mode of displayModes.modes) {
    const opt = document.createElement('option');
    opt.value = mode;
    opt.textContent = mode.replace('x', ' × ').replace('@', ' · ') + ' Hz';
    select.appendChild(opt);
  }
  const cur = displayModes.current;
  if (cur) {
    const key = `${cur.w}x${cur.h}@${cur.hz}`;
    if (displayModes.modes.includes(key)) select.value = key;
    flashHintPersistent('resolutionHint', `Şu an: ${cur.w} × ${cur.h} · ${cur.hz} Hz`, '');
  }
}

$('refreshResolutionBtn').addEventListener('click', refreshDisplayModes);

$('applyResolutionBtn').addEventListener('click', async () => {
  const parsed = /^(\d+)x(\d+)@(\d+)$/.exec($('resolutionSelect').value || '');
  if (!parsed) return;
  const result = await window.hostAPI.setDisplayMode(+parsed[1], +parsed[2], +parsed[3]);
  if (result.ok) {
    log(`Çözünürlük ${parsed[1]}×${parsed[2]}@${parsed[3]}Hz olarak ayarlandı.`);
    setTimeout(refreshDisplayModes, 800);
  } else {
    flashHintPersistent('resolutionHint', result.reason || 'Uygulanamadı.', 'err');
  }
});

$('restoreResolutionBtn').addEventListener('click', async () => {
  await window.hostAPI.restoreDisplayMode();
  log('Çözünürlük eski değerine döndürüldü.');
  setTimeout(refreshDisplayModes, 800);
});

// ---------------- v4.0: host tarafı ekran kaydı ----------------

// Tarayıcı hangi kodeği destekliyorsa onu kullan; VP9 en iyi sıkıştırma,
// VP8 her yerde çalışır.
function pickRecorderMime() {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm',
  ];
  for (const mime of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return '';
}

function recordStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function updateRecordUi() {
  const button = $('recordBtn');
  const state = $('recordState');
  if (recorder) {
    button.textContent = '⏹ Kaydı durdur';
    const seconds = Math.round((Date.now() - recordStartedAt) / 1000);
    state.innerHTML = `<span class="rec-dot" style="display:inline-block;margin-right:6px;"></span>Kaydediliyor · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    state.className = 'save-hint';
  } else {
    button.textContent = '⏺ Kaydı başlat';
  }
  sendControl({ t: 'rec-state', on: !!recorder, since: recordStartedAt });
}

async function startRecording() {
  if (recorder) return;
  if (!captureStream) {
    flashHint('recordState', 'Kayıt için önce bir bağlantı olmalı (ekran yakalaması bağlantıyla başlar).', 'warn');
    return;
  }
  const mime = pickRecorderMime();
  const opened = await window.hostAPI.fileIO.openWrite(`GameLink-Host-${recordStamp()}.webm`, 'videos');
  if (!opened || opened.error) {
    flashHint('recordState', 'Kayıt dosyası açılamadı: ' + ((opened && opened.error) || '?'), 'err');
    return;
  }
  recordHandle = opened.handle;
  recordPath = opened.path;
  recordQueue = Promise.resolve();

  try {
    recorder = new MediaRecorder(captureStream, {
      mimeType: mime || undefined,
      videoBitsPerSecond: Math.round((config.recordBitrate || 12) * 1e6),
    });
  } catch (err) {
    window.hostAPI.fileIO.abortWrite(recordHandle);
    recordHandle = null;
    flashHint('recordState', 'Kayıt başlatılamadı: ' + err.message, 'err');
    return;
  }

  recorder.ondataavailable = (ev) => {
    if (!ev.data || !ev.data.size || recordHandle == null) return;
    const handle = recordHandle;
    // Bloklar sırayla yazılıyor: aksi halde IPC yarışında parçalar karışır.
    recordQueue = recordQueue.then(async () => {
      const buffer = new Uint8Array(await ev.data.arrayBuffer());
      await window.hostAPI.fileIO.writeChunk(handle, buffer);
    }).catch((err) => console.error('[kayıt] yazılamadı', err));
  };
  recorder.onerror = (ev) => log('Kayıt hatası: ' + (ev.error && ev.error.message));

  recorder.start(1000);
  recordStartedAt = Date.now();
  log('Ekran kaydı başladı: ' + recordPath);
  updateRecordUi();
}

async function stopRecording(silent) {
  if (!recorder) return;
  const handle = recordHandle;
  const savedPath = recordPath;
  const active = recorder;
  recorder = null;
  recordHandle = null;

  await new Promise((resolve) => {
    active.onstop = resolve;
    try { active.stop(); } catch { resolve(); }
  });
  await recordQueue.catch(() => {});
  await window.hostAPI.fileIO.closeWrite(handle);

  if (!silent) log('Ekran kaydı durdu: ' + savedPath);
  flashHintPersistent('recordState', 'Kaydedildi: ' + savedPath, '');
  updateRecordUi();
}

$('recordBtn').addEventListener('click', () => (recorder ? stopRecording(false) : startRecording()));

$('saveRecordBitrateBtn').addEventListener('click', async () => {
  const value = parseFloat($('recordBitrateInput').value);
  if (!isFinite(value) || value <= 0) return;
  await refreshConfigUI(await window.hostAPI.saveSettings({ recordBitrate: value }));
  flashHint('recordState', 'Bit hızı kaydedildi. Sonraki kayıtta geçerli olur.');
});

$('codecSelect').addEventListener('change', async () => {
  await refreshConfigUI(await window.hostAPI.saveSettings({ videoCodec: $('codecSelect').value }));
  log('Video kodeği: ' + $('codecSelect').value + '. Sonraki bağlantıda geçerli olur.');
});

setInterval(() => { if (recorder) updateRecordUi(); }, 1000);

// ---------------- Sinyalleşme ----------------

async function main() {
  await refreshConfigUI(await window.hostAPI.getConfig());
  await refreshSourceList();
  renderUpdateState(await window.hostAPI.getUpdateState());
  setupFileTransfer();
  connect();
  // Mod listesi ilk açılışta okunmasın (köprünün ısınmasını bekliyoruz).
  setTimeout(refreshDisplayModes, 1500);
}

function connect() {
  if (!config.signalingUrl) return;
  clearTimeout(reconnectTimer);
  setStatus('Sunucuya bağlanılıyor...', 'waiting');
  ws = new WebSocket(config.signalingUrl);

  ws.onopen = () => {
    log('Sinyal sunucusuna bağlandı, kayıt yapılıyor...');
    ws.send(JSON.stringify({ type: 'host-register', code: config.hostCode }));
  };

  ws.onmessage = async (ev) => {
    const data = JSON.parse(ev.data);
    switch (data.type) {
      case 'registered':
        setStatus('Bekleniyor', 'waiting');
        log(`Hazır. Kod: ${config.hostCode}`);
        break;
      case 'error':
        log('Hata: ' + data.message);
        break;
      case 'join-request':
        await handleJoinRequest(data);
        break;
      case 'client-left':
        log('Client ayrıldı.');
        connectedDeviceName = null;
        setStatus('Bekleniyor', 'waiting');
        closePeerConnection();
        break;
      case 'signal':
        await handleSignal(data.payload);
        break;
    }
  };

  ws.onclose = () => {
    setStatus('Bağlantı koptu, yeniden deneniyor...', 'waiting');
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 3000);
  };

  ws.onerror = () => ws.close();
}

function sendSignal(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'signal', payload }));
  }
}

async function handleJoinRequest(data) {
  const { clientId, hwid, deviceName, passwordHash } = data;
  log(`Bağlantı isteği: ${deviceName} (${hwid ? hwid.slice(0, 8) : 'hwid yok'})`);

  const result = await window.hostAPI.evaluateJoin(hwid, deviceName, passwordHash);
  if (result.config) await refreshConfigUI(result.config);

  if (!result.accept) {
    log(`Reddedildi: ${deviceName} — ${result.reason}`);
    ws.send(JSON.stringify({ type: 'join-decision', clientId, accept: false, reason: result.reason }));
    return;
  }

  log(`Kabul edildi: ${deviceName}`);
  connectedDeviceName = deviceName;
  connectedHwid = hwid || '';
  connectedAt = Date.now();
  ws.send(JSON.stringify({ type: 'join-decision', clientId, accept: true }));

  window.hostAPI.sessionStart({ deviceName, hwid: connectedHwid, connectedAt });

  try {
    await startPeerConnection();
  } catch (e) {
    log('Yayın başlatılamadı: ' + e.message);
    closePeerConnection();
  }
}

// ---------------- WebRTC ----------------

// Sanal makinelerde ses aygıtı olmayabiliyor; loopback isteği tüm yakalamayı
// düşürdüğü için sessiz olarak bir kez daha deneniyor.
async function captureScreen() {
  const constraints = { video: { frameRate: { ideal: 60, max: 60 } }, audio: true };
  try {
    window.hostAPI.setCaptureAudio(true);
    return await navigator.mediaDevices.getDisplayMedia(constraints);
  } catch (err) {
    log('Sesli yakalama başarısız (' + err.message + '), ses olmadan deneniyor...');
    window.hostAPI.setCaptureAudio(false);
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: constraints.video });
    log('Ekran sessiz olarak paylaşılıyor (ses aygıtı bulunamadı).');
    return stream;
  }
}

// Kodek tercihi teklifi HAZIRLARKEN uygulanmalı: host teklifi veren taraf olduğu
// için sıralamayı o belirliyor. 'auto' seçiliyse tarayıcının kendi sırası kalır.
function applyCodecPreference(transceiver) {
  const wanted = (config.videoCodec || 'auto').toLowerCase();
  if (wanted === 'auto' || !transceiver || !transceiver.setCodecPreferences) return;
  if (!window.RTCRtpSender || !RTCRtpSender.getCapabilities) return;

  const capabilities = RTCRtpSender.getCapabilities('video');
  if (!capabilities || !capabilities.codecs) return;

  const matches = capabilities.codecs.filter((c) => c.mimeType.toLowerCase() === 'video/' + wanted);
  if (!matches.length) {
    log(`Kodek ${wanted.toUpperCase()} bu sistemde yok, otomatik seçime dönüldü.`);
    return;
  }
  const rest = capabilities.codecs.filter((c) => !matches.includes(c));
  try {
    transceiver.setCodecPreferences(matches.concat(rest));
    log('Video kodeği tercih edildi: ' + wanted.toUpperCase());
  } catch (err) {
    log('Kodek tercihi uygulanamadı: ' + err.message);
  }
}

async function startPeerConnection() {
  closePeerConnection();

  // "Sadece TURN" modunda iceTransportPolicy 'relay' olur: doğrudan (host/srflx)
  // adaylar hiç denenmez, tüm trafik röle üzerinden gider.
  pc = new RTCPeerConnection({
    iceServers: config.iceServers,
    iceTransportPolicy: config.iceTransportPolicy || 'all',
  });

  pc.onicecandidate = (ev) => { if (ev.candidate) sendSignal({ candidate: ev.candidate }); };
  pc.onconnectionstatechange = () => {
    log('Bağlantı durumu: ' + pc.connectionState);
    if (pc.connectionState === 'connected') {
      setStatus(`Bağlı: ${connectedDeviceName || ''}`, 'connected');
      startStats();
    } else if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
      // Bağlantı düştüğünde basılı kalan tuş/butonları serbest bırak.
      window.hostAPI.releaseAllInputs();
      setStatus('Bekleniyor', 'waiting');
    }
  };

  pc.ontrack = (ev) => {
    if (ev.track.kind !== 'audio') return;
    const el = $('micAudio');
    el.srcObject = ev.streams[0] || new MediaStream([ev.track]);
    el.play().catch(() => { /* otomatik oynatma engellenirse sessiz kalır */ });
    log('Client mikrofonu açıldı.');
    ev.track.onended = () => log('Client mikrofonu kapandı.');
  };

  mouseDc = pc.createDataChannel('mouse', { ordered: false, maxRetransmits: 0 });
  keysDc = pc.createDataChannel('keys'); // güvenilir (ordered, retransmit) - tuş kaybı olmasın
  controlDc = pc.createDataChannel('control'); // güvenilir - mod/kalite/monitör/pano/sohbet
  filesDc = pc.createDataChannel('files');     // güvenilir - dosya aktarımı

  mouseDc.onmessage = (ev) => handleInputMessage(safeParse(ev.data));
  keysDc.onmessage = (ev) => handleInputMessage(safeParse(ev.data));
  keysDc.onclose = () => window.hostAPI.releaseAllInputs();
  controlDc.onmessage = (ev) => handleControlMessage(safeParse(ev.data));
  controlDc.onopen = () => {
    sendControl({
      t: 'hello',
      version: window.hostAPI.appVersion,
      features: {
        chat: !!config.chatEnabled,
        files: !!config.fileTransfer,
        systemInfo: !!config.shareSystemInfo,
        resolution: !!config.allowRemoteResolution,
        windowCapture: !!config.allowWindowCapture,
        recording: true,
      },
      hostName: config.hostCode,
    });
    sendSources();
    if (config.clipboardSync) startClipboardSync();
  };

  if (config.fileTransfer) fileTransfer.attach(filesDc);

  captureStream = await captureScreen();
  captureStream.getTracks().forEach((track) => pc.addTrack(track, captureStream));

  // Yakaladığımız hatlardan bir şey ALMIYORUZ; yönü açıkça sendonly yapmak SDP'yi
  // dürüst tutuyor ve aşağıdaki mikrofon yuvasını karışmayacak biçimde ayırıyor.
  for (const transceiver of pc.getTransceivers()) {
    if (transceiver.sender && transceiver.sender.track) {
      try { transceiver.direction = 'sendonly'; } catch { /* tarayıcı izin vermezse varsayılan kalır */ }
    }
  }

  // Client'ın mikrofonu için boş bir alıcı yuva. Bu satır addTrack'ten SONRA
  // olmak zorunda: addTrack, kendi türüne uyan BOŞ bir transceiver bulursa onu
  // yeniden kullanır ve önceden açılmış recvonly yuvayı ele geçirir — o zaman
  // mikrofon için ayrı bir medya hattı hiç oluşmaz.
  pc.addTransceiver('audio', { direction: 'recvonly' });

  const videoTransceiver = pc.getTransceivers().find((t) => t.sender && t.sender.track && t.sender.track.kind === 'video');
  applyCodecPreference(videoTransceiver);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  // ICE sunucu listesi ve transport politikası offer ile birlikte gider:
  // client TURN bilgisini ve seçilen modu host'tan öğrenir.
  sendSignal({
    sdp: offer,
    iceServers: config.iceServers,
    iceTransportPolicy: config.iceTransportPolicy || 'all',
  });

  // Varsayılan: "Dengeli" preset + "Oyun" modu ayarları
  applySettings({
    scaleResolutionDownBy: 1.5,
    maxFramerate: 30,
    maxBitrate: 3_000_000,
    degradationPreference: 'maintain-framerate',
  });
}

function safeParse(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

function handleInputMessage(cmd) {
  if (!cmd) return;
  switch (cmd.t) {
    case 'm': window.hostAPI.injectMouseMove(cmd.dx, cmd.dy); break;
    case 'b': window.hostAPI.injectMouseButton(cmd.btn, cmd.down); break;
    case 'w': window.hostAPI.injectWheel(cmd.delta, cmd.h); break;
    case 'k': window.hostAPI.injectKey(cmd.scan, cmd.ext, cmd.down); break;
    case 'r': window.hostAPI.releaseAllInputs(); break;
    // İkinci imleç: konum oranlı (0..1) gelir, gerçek piksele main process çevirir.
    case 'gp': window.hostAPI.ghostMove(cmd.u, cmd.v); break;
    case 'gb': window.hostAPI.ghostButton(cmd.btn, cmd.down); break;
    case 'gw': window.hostAPI.ghostWheel(cmd.delta, cmd.h); break;
  }
}

async function handleControlMessage(msg) {
  if (!msg) return;
  switch (msg.t) {
    case 'settings': applySettings(msg); break;
    case 'get-sources': sendSources(); break;
    case 'set-source': switchSource(msg.id); break;
    case 'clip': receiveClipboard(msg.text); break;
    case 'cursor-mode': setCursorMode(msg.mode); break;

    // ---- v4.0 ----
    case 'chat': receiveChat(msg.text); break;
    case 'get-res': await sendDisplayModes(); break;
    case 'set-res': await applyRemoteResolution(msg); break;
    case 'rec': if (msg.on) startRecording(); else stopRecording(false); break;
    case 'hello':
      log(`Client sürümü: ${msg.version || 'bilinmiyor'}`);
      break;
  }
}

// Client hangi imleç modunda çalıştığını bildirir:
//   'single' -> klasik: host'un gerçek imleci client tarafından sürülür
//   'ghost'  -> ikinci imleç: gerçek imleç host kullanıcısında kalır
function setCursorMode(mode) {
  cursorMode = mode === 'ghost' ? 'ghost' : 'single';
  window.hostAPI.setGhostMode(cursorMode === 'ghost');
  $('cursorModeText').textContent = cursorMode === 'ghost'
    ? 'İkinci imleç — kendi farenizi kullanmaya devam edebilirsiniz'
    : 'Tek imleç — uzaktaki kullanıcı fareyi sizinle paylaşıyor';
  log(cursorMode === 'ghost' ? 'İkinci imleç modu açıldı.' : 'Tek imleç moduna geçildi.');
  window.hostAPI.sessionPush({ t: 'cursor', mode: cursorMode });
}

function sendControl(obj) {
  if (controlDc && controlDc.readyState === 'open') controlDc.send(JSON.stringify(obj));
}

async function sendSources() {
  const sources = await refreshSourceList();
  sendControl({ t: 'sources', list: sources, current: $('sourceSelect').value });
}

async function sendDisplayModes() {
  if (!config.allowRemoteResolution) {
    sendControl({ t: 'modes', allowed: false, modes: [], current: null });
    return;
  }
  const info = await window.hostAPI.listDisplayModes();
  displayModes = info;
  sendControl({ t: 'modes', allowed: true, modes: info.modes, current: info.current });
}

async function applyRemoteResolution(msg) {
  if (!config.allowRemoteResolution) {
    sendControl({ t: 'res-result', ok: false, reason: 'Host bu izni kapatmış.' });
    return;
  }
  if (msg.restore) {
    await window.hostAPI.restoreDisplayMode();
    log('Client çözünürlüğü eski değerine döndürdü.');
  } else {
    const result = await window.hostAPI.setDisplayMode(msg.w, msg.h, msg.hz);
    if (!result.ok) {
      sendControl({ t: 'res-result', ok: false, reason: result.reason });
      return;
    }
    log(`Client çözünürlüğü ${msg.w}×${msg.h} yaptı.`);
  }
  sendControl({ t: 'res-result', ok: true });
  setTimeout(() => { sendDisplayModes(); refreshDisplayModes(); }, 900);
}

// Monitör değişimi: yeniden pazarlık (renegotiation) yapmadan, sadece gönderilen
// video track'i değiştirilir - görüntü kesilmez, ses akışı bozulmaz.
async function switchSource(sourceId) {
  if (!sourceId) return;
  const updated = await window.hostAPI.setCaptureSource(sourceId);
  await refreshConfigUI(updated);
  $('sourceSelect').value = sourceId;

  if (!pc || !captureStream) return;

  const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
  if (!sender) return;

  // MediaRecorder akıştaki track değişimini izleyemez; kaydı düzgünce kapatıyoruz.
  if (recorder) {
    log('Kaynak değişti, ekran kaydı durduruluyor.');
    await stopRecording(true);
  }

  let newStream;
  try {
    newStream = await captureScreen();
  } catch (e) {
    log('Kaynak değiştirilemedi: ' + e.message);
    return;
  }

  const newVideo = newStream.getVideoTracks()[0];
  if (!newVideo) return;
  // Yeni yakalamanın ses track'ine ihtiyaç yok, mevcut ses akışı korunuyor.
  newStream.getAudioTracks().forEach((t) => t.stop());

  const oldVideo = sender.track;
  await sender.replaceTrack(newVideo);
  if (oldVideo) {
    captureStream.removeTrack(oldVideo);
    oldVideo.stop();
  }
  captureStream.addTrack(newVideo);

  if (lastSettings) applySettings(lastSettings);
  log('Paylaşılan kaynak değiştirildi.');
  sendSources();
}

async function applySettings(s) {
  if (!pc) return;
  lastSettings = { ...lastSettings, ...s };
  const sender = pc.getSenders().find((snd) => snd.track && snd.track.kind === 'video');
  if (!sender) return;
  const params = sender.getParameters();
  if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];

  if (s.maxBitrate) params.encodings[0].maxBitrate = s.maxBitrate;
  if (s.scaleResolutionDownBy) params.encodings[0].scaleResolutionDownBy = s.scaleResolutionDownBy;
  if (s.maxFramerate) params.encodings[0].maxFramerate = s.maxFramerate;
  if (s.degradationPreference) params.degradationPreference = s.degradationPreference;

  try {
    await sender.setParameters(params);
    log(`Ayarlar uygulandı: ölçek=${s.scaleResolutionDownBy || '-'} fps=${s.maxFramerate || '-'} bitrate=${s.maxBitrate ? (s.maxBitrate / 1e6) + 'Mbps' : '-'} mod=${s.degradationPreference || '-'}`);
  } catch (e) {
    console.error(e);
  }
}

async function handleSignal(payload) {
  if (!pc) return; // eşleşme kapandıktan sonra gelen geç sinyalleri yoksay
  if (payload.sdp) {
    await pc.setRemoteDescription(payload.sdp);
  } else if (payload.candidate) {
    try { await pc.addIceCandidate(payload.candidate); } catch (e) { console.error(e); }
  }
}

// ---------------- İstatistikler (oturum penceresi için) ----------------

function startStats() {
  stopStats();
  lastStatsSample = null;
  statsTimer = setInterval(updateStats, 1000);
}

function stopStats() {
  if (statsTimer) { clearInterval(statsTimer); statsTimer = null; }
}

async function updateStats() {
  if (!pc) return;
  let report;
  try { report = await pc.getStats(); } catch { return; }

  let outbound = null;
  let pair = null;
  report.forEach((s) => {
    if (s.type === 'outbound-rtp' && s.kind === 'video') outbound = s;
    if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated !== false) pair = s;
  });
  if (!outbound) return;

  let mbps = null;
  if (lastStatsSample && outbound.timestamp > lastStatsSample.timestamp) {
    const seconds = (outbound.timestamp - lastStatsSample.timestamp) / 1000;
    mbps = ((outbound.bytesSent - lastStatsSample.bytesSent) * 8) / seconds / 1e6;
  }
  lastStatsSample = { timestamp: outbound.timestamp, bytesSent: outbound.bytesSent };

  let transport = '—';
  if (pair) {
    const local = report.get(pair.localCandidateId);
    const remote = report.get(pair.remoteCandidateId);
    const kind = (c) => (c ? c.candidateType : '?');
    transport = (kind(local) === 'relay' || kind(remote) === 'relay') ? 'TURN (röle)' : 'Doğrudan (P2P)';
  }

  window.hostAPI.sessionPush({
    t: 'stats',
    transport,
    rtt: pair && pair.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : null,
    mbps,
    resolution: outbound.frameWidth ? `${outbound.frameWidth}×${outbound.frameHeight}` : null,
  });
}

// ---------------- Pano senkronizasyonu ----------------

function startClipboardSync() {
  stopClipboardSync();
  window.hostAPI.readClipboard().then((text) => { lastClipboardText = text || ''; });
  clipboardTimer = setInterval(async () => {
    if (!config.clipboardSync) return;
    const text = (await window.hostAPI.readClipboard()) || '';
    if (text && text !== lastClipboardText) {
      lastClipboardText = text;
      sendControl({ t: 'clip', text });
    }
  }, 1200);
}

function stopClipboardSync() {
  if (clipboardTimer) { clearInterval(clipboardTimer); clipboardTimer = null; }
}

function receiveClipboard(text) {
  if (!config.clipboardSync || typeof text !== 'string') return;
  if (text === lastClipboardText) return;
  lastClipboardText = text; // kendi yazdığımızı geri göndermemek için
  window.hostAPI.writeClipboard(text);
  log('Pano client\'tan alındı.');
}

// ---------------- v4.0: sohbet ----------------

function receiveChat(text) {
  if (!config.chatEnabled || typeof text !== 'string' || !text.trim()) return;
  window.hostAPI.sessionPush({ t: 'chat', text: text.slice(0, 2000) });
  log('Mesaj alındı.');
}

// ---------------- v4.0: dosya aktarımı ----------------

function setupFileTransfer() {
  fileTransfer = window.GLFileTransfer.create({
    io: window.hostAPI.fileIO,
    onEvent: (type, rec, list) => {
      window.hostAPI.sessionPush({ t: 'files', list, bump: type === 'incoming' });
      if (type === 'done' && rec) log(`Dosya ${rec.dir === 'in' ? 'alındı' : 'gönderildi'}: ${rec.name}`);
      if (type === 'error' && rec) log(`Dosya aktarımı başarısız (${rec.name}): ${rec.error}`);
    },
    // Gelen dosya onayı: ayar açıksa sormadan kabul, değilse yerel bir soru penceresi.
    // Oturum penceresi kapalı olabileceği için soru işletim sistemi diyaloğuyla soruluyor.
    askAccept: async (rec) => {
      if (!config.fileTransfer) return false;
      if (config.autoAcceptFiles) return true;
      return window.hostAPI.askFileAccept({ name: rec.name, size: rec.size });
    },
  });
}

// ---------------- v4.0: sistem bilgisi ----------------

window.hostAPI.onSystemStatic((msg) => {
  systemStatic = msg;
  if (config && config.shareSystemInfo) sendControl({ t: 'sysinfo', info: msg });
});

window.hostAPI.onSystemTick((msg) => {
  if (!config || !config.shareSystemInfo) return;
  sendControl({ t: 'sys', ...msg });
});

// ---------------- v4.0: oturum penceresi köprüsü ----------------

window.hostAPI.onSessionAction(async (action) => {
  if (!action || !action.a) return;
  switch (action.a) {
    case 'hello':
      window.hostAPI.sessionPush({
        t: 'peer', deviceName: connectedDeviceName, hwid: connectedHwid, connectedAt,
      });
      window.hostAPI.sessionPush({ t: 'cursor', mode: cursorMode });
      if (fileTransfer) window.hostAPI.sessionPush({ t: 'files', list: fileTransfer.list() });
      break;
    case 'chat':
      if (!config.chatEnabled) {
        window.hostAPI.sessionPush({ t: 'sys', text: 'Yazışma kapalı (Oturum sekmesinden açabilirsiniz).' });
        return;
      }
      sendControl({ t: 'chat', text: String(action.text || '').slice(0, 2000) });
      break;
    case 'send-paths':
      if (!config.fileTransfer) {
        window.hostAPI.sessionPush({ t: 'sys', text: 'Dosya aktarımı kapalı.' });
        return;
      }
      if (!filesDc || filesDc.readyState !== 'open') {
        window.hostAPI.sessionPush({ t: 'sys', text: 'Dosya kanalı henüz hazır değil.' });
        return;
      }
      fileTransfer.sendFiles(action.files || []);
      break;
    case 'cancel-file':
      if (fileTransfer) fileTransfer.cancel(action.id);
      break;
    case 'clear-files':
      if (fileTransfer) fileTransfer.clearFinished();
      break;
    case 'disconnect':
      log('Oturum penceresinden bağlantı kesildi.');
      closePeerConnection();
      break;
  }
});

// ---------------- Temizlik ----------------

function closePeerConnection() {
  stopClipboardSync();
  stopStats();
  window.hostAPI.releaseAllInputs();
  // Bağlantı bitti: ikinci imleç katmanı kapansın, gerçek imleç host'a geri dönsün.
  window.hostAPI.setGhostMode(false);
  cursorMode = 'single';
  $('cursorModeText').textContent = 'Bağlantı yok';

  if (recorder) stopRecording(true);
  if (fileTransfer) fileTransfer.detach();

  if (mouseDc) { mouseDc.close(); mouseDc = null; }
  if (keysDc) { keysDc.onclose = null; keysDc.close(); keysDc = null; }
  if (controlDc) { controlDc.close(); controlDc = null; }
  if (filesDc) { filesDc.close(); filesDc = null; }
  if (captureStream) {
    captureStream.getTracks().forEach((t) => t.stop());
    captureStream = null;
  }
  if (pc) { pc.onconnectionstatechange = null; pc.close(); pc = null; }
  lastSettings = null;
  connectedDeviceName = null;
  connectedHwid = null;
  connectedAt = 0;

  window.hostAPI.sessionPush({ t: 'closed' });
  window.hostAPI.sessionEnd();
}

window.addEventListener('beforeunload', closePeerConnection);

main();
