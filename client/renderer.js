const $ = (id) => document.getElementById(id);

// ---- Fiziksel tuş -> PS/2 Set-1 tarama kodu eşlemesi (host tarafındaki input-bridge.ps1 ile birebir aynı) ----
const KEYMAP = {
  Escape:[0x01,false], Digit1:[0x02,false], Digit2:[0x03,false], Digit3:[0x04,false],
  Digit4:[0x05,false], Digit5:[0x06,false], Digit6:[0x07,false], Digit7:[0x08,false],
  Digit8:[0x09,false], Digit9:[0x0A,false], Digit0:[0x0B,false],
  Minus:[0x0C,false], Equal:[0x0D,false], Backspace:[0x0E,false], Tab:[0x0F,false],
  KeyQ:[0x10,false], KeyW:[0x11,false], KeyE:[0x12,false], KeyR:[0x13,false], KeyT:[0x14,false],
  KeyY:[0x15,false], KeyU:[0x16,false], KeyI:[0x17,false], KeyO:[0x18,false], KeyP:[0x19,false],
  BracketLeft:[0x1A,false], BracketRight:[0x1B,false], Enter:[0x1C,false], ControlLeft:[0x1D,false],
  KeyA:[0x1E,false], KeyS:[0x1F,false], KeyD:[0x20,false], KeyF:[0x21,false], KeyG:[0x22,false],
  KeyH:[0x23,false], KeyJ:[0x24,false], KeyK:[0x25,false], KeyL:[0x26,false],
  Semicolon:[0x27,false], Quote:[0x28,false], Backquote:[0x29,false],
  ShiftLeft:[0x2A,false], Backslash:[0x2B,false],
  KeyZ:[0x2C,false], KeyX:[0x2D,false], KeyC:[0x2E,false], KeyV:[0x2F,false], KeyB:[0x30,false],
  KeyN:[0x31,false], KeyM:[0x32,false], Comma:[0x33,false], Period:[0x34,false], Slash:[0x35,false],
  ShiftRight:[0x36,false], NumpadMultiply:[0x37,false], AltLeft:[0x38,false], Space:[0x39,false],
  CapsLock:[0x3A,false],
  F1:[0x3B,false], F2:[0x3C,false], F3:[0x3D,false], F4:[0x3E,false], F5:[0x3F,false],
  F6:[0x40,false], F7:[0x41,false], F8:[0x42,false], F9:[0x43,false], F10:[0x44,false],
  NumLock:[0x45,false], ScrollLock:[0x46,false],
  Numpad7:[0x47,false], Numpad8:[0x48,false], Numpad9:[0x49,false], NumpadSubtract:[0x4A,false],
  Numpad4:[0x4B,false], Numpad5:[0x4C,false], Numpad6:[0x4D,false], NumpadAdd:[0x4E,false],
  Numpad1:[0x4F,false], Numpad2:[0x50,false], Numpad3:[0x51,false],
  Numpad0:[0x52,false], NumpadDecimal:[0x53,false],
  IntlBackslash:[0x56,false], F11:[0x57,false], F12:[0x58,false],
  ControlRight:[0x1D,true], AltRight:[0x38,true], NumpadEnter:[0x1C,true], NumpadDivide:[0x35,true],
  ArrowUp:[0x48,true], ArrowLeft:[0x4B,true], ArrowRight:[0x4D,true], ArrowDown:[0x50,true],
  Insert:[0x52,true], Delete:[0x53,true], Home:[0x47,true], End:[0x4F,true],
  PageUp:[0x49,true], PageDown:[0x51,true],
  MetaLeft:[0x5B,true], MetaRight:[0x5C,true], ContextMenu:[0x5D,true],
  PrintScreen:[0x37,true], Pause:[0x45,true],
};

// ---- Kalite / mod tanımları ----
const QUALITY_PRESETS = {
  'data-saver': { scaleResolutionDownBy: 2,   maxFramerate: 30, maxBitrate: 1_500_000 },
  'balanced':   { scaleResolutionDownBy: 1.5, maxFramerate: 30, maxBitrate: 3_000_000 },
  'high':       { scaleResolutionDownBy: 1,   maxFramerate: 60, maxBitrate: 8_000_000 },
};
// Her modun kendi önerdiği kalite profili var: mod değişince kalite de otomatik
// oraya geçer (kullanıcı isterse sonrasında kaliteyi elle değiştirebilir).
const MODE_PRESETS = {
  game:   { degradationPreference: 'maintain-framerate', playoutDelayHint: 0,   quality: 'balanced' },
  normal: { degradationPreference: 'maintain-resolution', playoutDelayHint: 0.1, quality: 'high' },
  stream: { degradationPreference: 'balanced',            playoutDelayHint: 0.4, quality: 'high' },
};

// ---- Yakalamadan çıkış kısayolu seçenekleri ----
// Escape artık host'a iletiliyor (oyunlarda menü açmak için gerekli), bu yüzden
// çıkış için ayrı bir kombinasyon kullanılıyor.
const RELEASE_HOTKEYS = {
  'CtrlLeft+AltLeft':      { label: 'Sol Ctrl + Sol Alt', keys: ['ControlLeft', 'AltLeft'] },
  'CtrlLeft+ShiftLeft':    { label: 'Sol Ctrl + Sol Shift', keys: ['ControlLeft', 'ShiftLeft'] },
  'AltLeft+ShiftLeft':     { label: 'Sol Alt + Sol Shift', keys: ['AltLeft', 'ShiftLeft'] },
  'F12':                   { label: 'F12', keys: ['F12'] },
  'Numpad0':               { label: 'Numpad 0', keys: ['Numpad0'] },
  'NumpadMultiply':        { label: 'Numpad *', keys: ['NumpadMultiply'] },
  'ScrollLock':            { label: 'Scroll Lock', keys: ['ScrollLock'] },
  'MouseMiddle':           { label: 'Fare Orta Tuş (basılı tut)', keys: [], mouseButton: 1 },
};

const DEFAULT_ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

let ws, pc, mouseDc, keysDc, controlDc, filesDc;
let hwid, deviceName;
let currentMode = 'game';
let currentQuality = 'balanced';
let pendingCandidates = [];
let remoteDescriptionSet = false;
let statsTimer = null;
let lastStatsSample = null;
let clipboardTimer = null;
let lastClipboardText = '';
let clipboardSync = true;

// v4.0
let fileTransfer = null;
let micTransceiver = null;
let micStream = null;
let recorder = null;
let recordHandle = null;
let recordPath = null;
let recordStartedAt = 0;
let recordQueue = Promise.resolve();
let hostFeatures = { chat: true, files: true, systemInfo: true, resolution: true, recording: true };
let unreadSession = 0;
let activeSessionTab = 'chat';
let hostStatic = null;

// Basılı tuşlar/butonlar: fare kilidi bırakıldığında ya da pencere odağı gidince
// host'ta hiçbir şey basılı kalmasın diye takip ediliyor.
const pressedKeys = new Map(); // e.code -> [scan, ext]
const pressedButtons = new Set();

// Yakalamadan çıkış kısayolunu tespit etmek için o an fiziksel olarak basılı olan
// tuşlar (host'a gönderilenlerden ayrı tutuluyor).
const physicallyDown = new Set();

let prefs = {
  releaseHotkey: 'CtrlLeft+AltLeft',
  autoHideUi: true,
  hideUiCompletely: false,
  mode: 'game',
  quality: 'balanced',
  cursorMode: 'single',
  theme: 'system',
  fitMode: 'contain',
  showQosHud: true,
  micEnabled: false,
  autoAcceptFiles: false,
  recordBitrate: 10,
};
let uiHideTimer = null;
let keyboardLockActive = false;

// ---- İkinci imleç durumu ----
// 'single': klasik mod. Fare kilidi + göreli delta -> host'un GERÇEK imleci sürülür.
//           Oyunlar için tek doğru yol (ham girdi/kamera dönüşü bunu ister).
// 'ghost' : ikinci imleç. Fare kilidi yok; kendi imlecinizin video üzerindeki
//           oransal konumu (0..1) host'a gider. Host'un gerçek imleci yerinde
//           kalır, sahibi çalışmaya devam eder. Masaüstü işleri için.
let ghostEngaged = false;
let pendingGhost = null;
let ghostRafId = 0;
let lastPointer = { x: 0, y: 0 };

const isGhostMode = () => prefs.cursorMode === 'ghost';
const isCapturing = () => (isGhostMode() ? ghostEngaged : document.pointerLockElement === video);
const clamp01 = (n) => (isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const formatBytes = (n) => window.GLFileTransfer.formatBytes(n);

// ---------------- Başlangıç ----------------

async function init() {
  const data = await window.clientAPI.getInitData();
  hwid = data.hwid;
  deviceName = data.deviceName;
  renderConnList(data.savedConnections);
  $('versionText').textContent = 'Sürüm ' + data.version + (data.portable ? ' · taşınabilir' : '');
  $('prefsVersionNote').textContent = `GameLink ${data.version}${data.vmCompatActive ? ' · sanal makine modu etkin' : ''}`;

  prefs = await window.clientAPI.getPrefs();
  applyTheme(prefs.theme || 'system');
  $('autoHideToggle').checked = prefs.autoHideUi;
  $('hideUiToggle').checked = prefs.hideUiCompletely;
  $('qosToggle').checked = prefs.showQosHud !== false;
  populateHotkeySelect();
  renderPrefsModal();
  setupFileTransfer();

  // Kaydedilmiş mod/kalite geri yüklenir (henüz bağlantı yok, host'a gönderme).
  currentMode = prefs.mode || 'game';
  currentQuality = prefs.quality || 'balanced';
  highlightSeg('#modeSeg', 'mode', currentMode);
  highlightSeg('#qualitySeg', 'quality', currentQuality);
  $('customControls').style.display = currentQuality === 'custom' ? 'block' : 'none';

  applyCursorModeLocally(prefs.cursorMode || 'single');
  applyFitMode(prefs.fitMode || 'contain', false);
  applyQosVisibility();

  renderUpdateState(await window.clientAPI.getUpdateState());
  window.clientAPI.onUpdateState(renderUpdateState);
}

// ---------------- Tema ----------------
// Tercih: 'system' | 'light' | 'dark'. 'system' seçiliyken Windows'un açık/koyu
// ayarı izlenir ve orada yapılan değişiklik arayüze anında yansır. İlk tema, sayfa
// çizilmeden önce index.html içindeki küçük script tarafından uygulanıyor; burası
// yalnızca sonraki değişiklikleri yönetir.

const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
const THEME_BUTTONS = '#themeSeg button, #themeSegPanel button';

function applyTheme(pref) {
  const dark = pref === 'dark' || (pref !== 'light' && systemThemeQuery.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelectorAll(THEME_BUTTONS).forEach((b) => {
    b.classList.toggle('active', b.dataset.theme === pref);
  });
}

systemThemeQuery.addEventListener('change', () => {
  if ((prefs.theme || 'system') === 'system') applyTheme('system');
});

document.querySelectorAll(THEME_BUTTONS).forEach((btn) => {
  btn.addEventListener('click', async () => {
    prefs.theme = btn.dataset.theme;
    applyTheme(prefs.theme); // tıklamaya anında tepki ver, kaydı arkadan yap
    await window.clientAPI.savePrefs({ theme: prefs.theme });
  });
});

// Kayıtlı bağlantı listesindeki renkli rozetler. Renk koddan türetiliyor: aynı
// bağlantı her açılışta aynı rengi alır, farklı bağlantılar birbirinden ayrılır.
const AVATAR_COLORS = [
  ['#4f7dff', '#6d5efc'], ['#06b6d4', '#3b82f6'], ['#22c55e', '#14b8a6'],
  ['#f59e0b', '#ef4444'], ['#ec4899', '#8b5cf6'], ['#14b8a6', '#22c55e'],
  ['#8b5cf6', '#4f7dff'], ['#ef4444', '#ec4899'],
];

function connColors(key) {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function renderConnList(list) {
  const container = $('connList');
  container.innerHTML = '';
  if (!list || list.length === 0) {
    container.innerHTML = '<div class="empty-note">Henüz kayıtlı bağlantı yok. Sağdaki formdan ilk bağlantınızı kurun.</div>';
    return;
  }
  for (const c of list) {
    const item = document.createElement('div');
    item.className = 'conn-item';
    const [c1, c2] = connColors(c.code || c.label || '');
    const initials = (c.label || c.code || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase();
    item.innerHTML = `
      <div class="avatar" style="--c1:${c1};--c2:${c2}">${escapeHtml(initials || '?')}</div>
      <div class="label">${escapeHtml(c.label)}</div>
    `;
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('del')) return;
      $('serverUrl').value = c.signalingUrl;
      $('code').value = c.code;
      $('password').value = '';
      connect(); // HWID zaten güvenilirse parolasız bağlanmayı dener
    });
    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '×';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      renderConnList(await window.clientAPI.removeConnection(c.id));
    });
    item.appendChild(del);
    container.appendChild(item);
  }
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s == null ? '' : String(s);
  return div.innerHTML;
}

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function setNote(id, text, kind) {
  const el = $(id);
  el.textContent = text || '';
  el.className = 'note' + (kind ? ' ' + kind : '');
}

// ---------------- Program ayarları penceresi (v4.0) ----------------

function renderPrefsModal() {
  $('trayToggle').checked = prefs.minimizeToTray !== false;
  $('autoStartToggle').checked = !!prefs.autoStart;
  $('autoUpdateToggle').checked = prefs.autoUpdate !== false;
  $('updateUrlInput').value = prefs.updateUrl || '';
  $('autoAcceptToggle').checked = !!prefs.autoAcceptFiles;
  $('recordBitrateInput').value = prefs.recordBitrate || 10;
  $('vmModeSelect').value = prefs.vmMode || 'auto';
  $('downloadDirText').textContent = 'Kayıt klasörü: ' + (prefs.downloadDir || 'İndirilenler\\GameLink (varsayılan)');
}

$('prefsBtn').addEventListener('click', () => $('prefsModal').classList.add('open'));
$('prefsCloseBtn').addEventListener('click', () => $('prefsModal').classList.remove('open'));
$('prefsModal').addEventListener('click', (e) => {
  if (e.target === $('prefsModal')) $('prefsModal').classList.remove('open');
});

async function savePref(patch) {
  prefs = await window.clientAPI.savePrefs(patch);
  return prefs;
}

$('trayToggle').addEventListener('change', () => savePref({ minimizeToTray: $('trayToggle').checked }));

$('autoStartToggle').addEventListener('change', async () => {
  const result = await window.clientAPI.setAutoStart($('autoStartToggle').checked);
  $('autoStartToggle').checked = result.autoStart;
  prefs.autoStart = result.autoStart;
  setNote('autoStartHint',
    result.ok
      ? (result.autoStart ? 'Windows açılışında tepsiye inik olarak başlayacak.' : 'Otomatik başlatma kaldırıldı.')
      : (result.reason || 'Ayarlanamadı.'),
    result.ok ? 'ok' : 'err');
});

$('autoUpdateToggle').addEventListener('change', () => savePref({ autoUpdate: $('autoUpdateToggle').checked }));

$('saveUpdateUrlBtn').addEventListener('click', async () => {
  await savePref({ updateUrl: $('updateUrlInput').value.trim() });
  setNote('updateStatus', prefs.updateUrl ? 'Adres kaydedildi.' : 'Adres boşaltıldı, güncelleme denetimi kapalı.', 'ok');
});

function renderUpdateState(state) {
  if (!state) return;
  const kinds = { error: 'err', unavailable: 'warn', current: 'ok', ready: 'ok' };
  setNote('updateStatus', state.message || '', kinds[state.status] || '');
  $('installUpdateBtn').disabled = state.status !== 'ready';
}

$('checkUpdateBtn').addEventListener('click', async () => renderUpdateState(await window.clientAPI.checkUpdate()));
$('installUpdateBtn').addEventListener('click', () => window.clientAPI.installUpdate());

$('autoAcceptToggle').addEventListener('change', () => savePref({ autoAcceptFiles: $('autoAcceptToggle').checked }));

$('recordBitrateInput').addEventListener('change', () => {
  const value = parseFloat($('recordBitrateInput').value);
  if (isFinite(value) && value > 0) savePref({ recordBitrate: value });
});

$('vmModeSelect').addEventListener('change', async () => {
  await savePref({ vmMode: $('vmModeSelect').value });
  setNote('vmHint', 'Kaydedildi. Programı yeniden başlatınca geçerli olur.', 'warn');
});

$('downloadDirBtn').addEventListener('click', async () => {
  const result = await window.clientAPI.chooseDownloadDir();
  if (result.canceled) return;
  prefs = result.prefs;
  renderPrefsModal();
});

$('openDownloadDirBtn').addEventListener('click', async () => {
  window.clientAPI.fileIO.open(await window.clientAPI.fileIO.targetDir('downloads'));
});
$('openRecordDirBtn').addEventListener('click', async () => {
  window.clientAPI.fileIO.open(await window.clientAPI.fileIO.targetDir('videos'));
});
$('openLogBtn').addEventListener('click', () => window.clientAPI.openLogFolder());

$('exportBtn').addEventListener('click', async () => {
  const result = await window.clientAPI.exportConfig();
  if (result.canceled) return;
  setNote('configHint', result.ok ? 'Kaydedildi: ' + result.path : (result.reason || 'Yazılamadı.'), result.ok ? 'ok' : 'err');
});

$('importBtn').addEventListener('click', async () => {
  const result = await window.clientAPI.importConfig();
  if (result.canceled) return;
  if (!result.ok) { setNote('configHint', result.reason || 'Okunamadı.', 'err'); return; }
  prefs = result.prefs;
  renderConnList(result.savedConnections);
  renderPrefsModal();
  applyTheme(prefs.theme || 'system');
  setNote('configHint', 'Ayarlar içe aktarıldı.', 'ok');
});

// ---------------- Bağlantı formu ----------------

$('connectBtn').addEventListener('click', connect);
$('password').addEventListener('keydown', (e) => { if (e.key === 'Enter') connect(); });
$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') connect(); });

function setConnectStatus(msg, isErr) {
  $('connectStatus').textContent = msg || '';
  $('connectStatus').className = isErr ? 'err' : '';
}

async function connect() {
  const url = $('serverUrl').value.trim();
  const code = $('code').value.trim();
  const password = $('password').value;

  if (!url || !code) {
    setConnectStatus('Sunucu adresi ve kod gerekli.', true);
    return;
  }

  closeConnection(); // önceki denemeden kalan soket/peer varsa temizle

  $('connectBtn').disabled = true;
  setConnectStatus('Bağlanılıyor...');

  const passwordHash = password ? await sha256Hex(password) : null;

  ws = new WebSocket(url);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'client-join', code, hwid, deviceName, passwordHash }));
  };

  ws.onmessage = async (ev) => {
    const data = JSON.parse(ev.data);
    switch (data.type) {
      case 'joined':
        setConnectStatus('Bağlandı, video bekleniyor...');
        pendingCandidates = [];
        remoteDescriptionSet = false;
        await window.clientAPI.saveConnection({ signalingUrl: url, code, label: code });
        break;
      case 'error':
        handleJoinError(data.message);
        break;
      case 'signal':
        await handleSignal(data.payload);
        break;
      case 'host-left':
        setConnectStatus('Host bağlantıyı kapattı.', true);
        showConnectView();
        break;
    }
  };

  ws.onerror = () => setConnectStatus('Sunucuya bağlanılamadı.', true);
  ws.onclose = () => { $('connectBtn').disabled = false; };
}

function handleJoinError(message) {
  setConnectStatus(message, true);
  $('connectBtn').disabled = false;
  showConnectView();
  // Host bu cihazı tanımıyorsa parola isteniyor demektir - kullanıcıyı doğrudan
  // parola alanına yönlendir.
  if (/parola/i.test(message || '')) {
    $('password').focus();
    $('password').select();
  }
}

// Peer connection, host'un offer'ı ile birlikte gönderdiği ICE sunucu listesi
// kullanılarak kurulur; TURN ayarı sadece host'ta tutulur.
function ensurePeerConnection(iceServers, transportPolicy) {
  if (pc) return;

  // Host "Sadece TURN" modundaysa transportPolicy 'relay' gelir ve doğrudan
  // adaylar hiç toplanmaz; iki taraf da aynı politikayı kullanmalı.
  pc = new RTCPeerConnection({
    iceServers: iceServers && iceServers.length ? iceServers : DEFAULT_ICE,
    iceTransportPolicy: transportPolicy === 'relay' ? 'relay' : 'all',
  });

  pc.onicecandidate = (ev) => { if (ev.candidate) sendSignal({ candidate: ev.candidate }); };

  pc.onconnectionstatechange = () => {
    if (!pc) return;
    if (pc.connectionState === 'connected') {
      setOverlayInfo('Bağlantı kuruldu');
    } else if (['disconnected', 'failed'].includes(pc.connectionState)) {
      releaseAllInputs();
      setOverlayInfo('Bağlantı sorunu: ' + pc.connectionState);
    }
  };

  pc.ontrack = (ev) => {
    if (ev.track.kind !== 'video') return;
    const el = $('remoteVideo');
    el.srcObject = ev.streams[0];
    el.play().catch(() => { /* otomatik oynatma engellenirse kullanıcı tıklayınca başlar */ });
    showStage();
    applyModeLocally(currentMode); // playoutDelayHint için receiver artık hazır
  };

  pc.ondatachannel = (ev) => {
    if (ev.channel.label === 'mouse') mouseDc = ev.channel;
    else if (ev.channel.label === 'keys') keysDc = ev.channel;
    else if (ev.channel.label === 'files') {
      filesDc = ev.channel;
      fileTransfer.attach(filesDc);
    } else if (ev.channel.label === 'control') {
      controlDc = ev.channel;
      controlDc.onmessage = (m) => handleControlMessage(safeParse(m.data));
      controlDc.onopen = () => {
        sendCurrentSettings(); // bağlanınca varsayılan mod/kalite host'a bildirilir
        sendControl({ t: 'hello', version: window.clientAPI.appVersion, deviceName });
        sendControl({ t: 'cursor-mode', mode: prefs.cursorMode || 'single' });
        sendControl({ t: 'get-sources' });
        sendControl({ t: 'get-res' });
        startClipboardSync();
      };
    }
  };
}

function safeParse(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

function sendSignal(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'signal', payload }));
  }
}

// Host, teklife client'ın mikrofonu için boş bir "recvonly" ses yuvası koyuyor.
// Cevabı hazırlamadan önce o yuvayı 'sendonly' yapıp kendi mikrofonumuzu takıyoruz;
// böylece mikrofon sonradan açılıp kapandığında yeniden pazarlık gerekmiyor.
async function prepareMicrophone() {
  micTransceiver = pc.getTransceivers().find(
    (t) => t.receiver && t.receiver.track && t.receiver.track.kind === 'audio' && t.direction === 'sendonly'
  ) || null;
  if (!micTransceiver) return;
  try { micTransceiver.direction = 'sendonly'; } catch { /* tarayıcı izin vermezse boş geç */ }
  if (prefs.micEnabled) await enableMicrophone(true);
  updateMicButton();
}

async function enableMicrophone(silent) {
  if (!micTransceiver) return false;
  try {
    if (!micStream) {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    }
    await micTransceiver.sender.replaceTrack(micStream.getAudioTracks()[0]);
    prefs.micEnabled = true;
    if (!silent) addChatMessage('sys', 'Mikrofon açıldı.');
    return true;
  } catch (err) {
    prefs.micEnabled = false;
    if (!silent) addChatMessage('sys', 'Mikrofon açılamadı: ' + err.message);
    return false;
  }
}

async function disableMicrophone() {
  if (micTransceiver) {
    try { await micTransceiver.sender.replaceTrack(null); } catch { /* kapanmış olabilir */ }
  }
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
  prefs.micEnabled = false;
}

function updateMicButton() {
  const btn = $('micBtn');
  btn.classList.toggle('active', !!prefs.micEnabled);
  btn.textContent = prefs.micEnabled ? '🎤 Mikrofon açık' : '🎤 Mikrofon';
  btn.disabled = !micTransceiver;
}

$('micBtn').addEventListener('click', async () => {
  if (prefs.micEnabled) await disableMicrophone();
  else await enableMicrophone(false);
  await window.clientAPI.savePrefs({ micEnabled: prefs.micEnabled });
  updateMicButton();
});

async function handleSignal(payload) {
  if (payload.sdp) {
    ensurePeerConnection(payload.iceServers, payload.iceTransportPolicy);
    await pc.setRemoteDescription(payload.sdp);
    remoteDescriptionSet = true;
    if (payload.sdp.type === 'offer') {
      await prepareMicrophone();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignal({ sdp: answer });
    }
    await flushPendingCandidates();
  } else if (payload.candidate) {
    // Aday, offer'dan önce gelmiş olabilir; peer hazır olana kadar kuyrukta bekletilir.
    if (!pc || !remoteDescriptionSet) {
      pendingCandidates.push(payload.candidate);
      return;
    }
    try { await pc.addIceCandidate(payload.candidate); } catch (e) { console.error(e); }
  }
}

async function flushPendingCandidates() {
  if (!pc) return;
  const queued = pendingCandidates;
  pendingCandidates = [];
  for (const candidate of queued) {
    try { await pc.addIceCandidate(candidate); } catch (e) { console.error(e); }
  }
}

// ---------------- Görünüm geçişleri ----------------

function showStage() {
  $('connectView').style.display = 'none';
  $('prefsModal').classList.remove('open');
  $('stageView').style.display = 'block';
  startStats();
}
function showConnectView() {
  $('stageView').style.display = 'none';
  $('connectView').style.display = 'flex';
  $('connectBtn').disabled = false;
  $('settingsPanel').classList.remove('open');
  $('sessionPanel').classList.remove('open');
  setFullscreen(false);
  closeConnection();
}

$('disconnectBtn').addEventListener('click', () => {
  setConnectStatus('');
  showConnectView();
});

function closeConnection() {
  stopStats();
  stopClipboardSync();
  releaseAllInputs();
  stopCapture();
  if (recorder) stopRecording(true);
  clearTimeout(uiHideTimer);
  document.body.classList.remove('ui-hidden');
  disableMicrophone();
  micTransceiver = null;
  if (fileTransfer) fileTransfer.detach();
  if (mouseDc) { mouseDc.close(); mouseDc = null; }
  if (keysDc) { keysDc.close(); keysDc = null; }
  if (controlDc) { controlDc.close(); controlDc = null; }
  if (filesDc) { filesDc.close(); filesDc = null; }
  if (pc) { pc.onconnectionstatechange = null; pc.close(); pc = null; }
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
  pendingCandidates = [];
  remoteDescriptionSet = false;
  hostStatic = null;
  $('remoteVideo').srcObject = null;
}

// ---------------- Girdi yakalama (Pointer Lock ile RELATIVE fare) ----------------

const video = $('remoteVideo');
video.addEventListener('click', (e) => {
  lastPointer = { x: e.clientX, y: e.clientY };
  startCapture();
});

// Windows tuşu, Alt+Tab, Escape gibi tuşlar normalde işletim sistemi tarafından
// yakalanır ve uygulamaya hiç ulaşmaz — bu yüzden başlat menüsü yerel makinede
// açılıyordu. Keyboard Lock API bu tuşları uygulamaya yönlendirir, ama yalnızca
// tam ekran modunda çalışır. Bu yüzden yakalama = tam ekran + pointer lock +
// keyboard lock üçlüsü olarak başlatılıyor.
async function startCapture() {
  if (isGhostMode()) { startGhostCapture(); return; }

  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    }
  } catch { /* tam ekran reddedilirse yine de devam et */ }

  try {
    if (navigator.keyboard && navigator.keyboard.lock) {
      await navigator.keyboard.lock();
      keyboardLockActive = true;
    }
  } catch { keyboardLockActive = false; }

  try {
    await video.requestPointerLock();
  } catch { /* kullanıcı hızlı çıkış yaptıysa sessizce geç */ }
}

function stopCapture() {
  if (document.pointerLockElement) document.exitPointerLock();
  if (ghostEngaged) stopGhostCapture();
  if (keyboardLockActive && navigator.keyboard && navigator.keyboard.unlock) {
    try { navigator.keyboard.unlock(); } catch { /* yoksay */ }
    keyboardLockActive = false;
  }
  physicallyDown.clear();
  showUi();
}

// ---------------- İkinci imleç: yakalama ----------------
//
// Burada fare kilidi YOK. Sebebi: ikinci imlecin sürüklenmeden, kaymadan tam
// istenen piksele gitmesi gerekiyor; bu da mutlak konum demek. Kendi imleciniz
// videonun üstünde gezinirken konumu oransal (0..1) olarak host'a gidiyor ve
// orada paylaşılan alanın koordinatına çevriliyor.

function startGhostCapture() {
  if (ghostEngaged) return;
  ghostEngaged = true;
  document.body.classList.add('ghost-engaged');

  // Zaten tam ekrandaysak Win/Alt+Tab gibi tuşları da yakalayabiliriz. Tam ekranı
  // zorlamıyoruz: ikinci imleç modunda kullanıcı genelde kendi masaüstüyle
  // birlikte çalışmak ister.
  if (document.fullscreenElement && navigator.keyboard && navigator.keyboard.lock) {
    navigator.keyboard.lock().then(() => { keyboardLockActive = true; }).catch(() => {});
  }

  // İlk konumu hemen bildir ki ilk tıklama doğru yere düşsün.
  queueGhostMove(lastPointer.x, lastPointer.y);
  flushGhostNow();
  scheduleUiHide();
}

function stopGhostCapture() {
  if (!ghostEngaged) return;
  ghostEngaged = false;
  document.body.classList.remove('ghost-engaged');
  if (ghostRafId) { cancelAnimationFrame(ghostRafId); ghostRafId = 0; }
  pendingGhost = null;
}

// Videonun GERÇEK görüntü alanı. Yerleşim moduna göre değişir:
//   contain -> oran korunur, etrafında siyah bant olabilir
//   cover   -> oran korunur, taşan kısım kırpılır
//   fill    -> orana bakılmadan kutuya yayılır
//   actual  -> 1:1, ortalanmış
// Oran hesabı bant/kırpma alanına göre değil, görüntünün kendisine göre yapılmalı;
// aksi halde ikinci imleç kaymış konuma tıklar.
function videoContentRect() {
  const r = video.getBoundingClientRect();
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return { x: r.left, y: r.top, w: r.width, h: r.height };

  const fit = prefs.fitMode || 'contain';
  if (fit === 'fill') return { x: r.left, y: r.top, w: r.width, h: r.height };

  let scale;
  if (fit === 'cover') scale = Math.max(r.width / vw, r.height / vh);
  else if (fit === 'actual') scale = 1;
  else scale = Math.min(r.width / vw, r.height / vh);

  const w = vw * scale;
  const h = vh * scale;
  return { x: r.left + (r.width - w) / 2, y: r.top + (r.height - h) / 2, w, h };
}

// Konum güncellemeleri ekran yenilemesine göre birleştirilir: fare 1000 Hz olsa
// bile veri kanalına saniyede ~60 paket gider.
function queueGhostMove(clientX, clientY) {
  const r = videoContentRect();
  if (!r.w || !r.h) return;
  pendingGhost = {
    u: clamp01((clientX - r.x) / r.w),
    v: clamp01((clientY - r.y) / r.h),
  };
  if (!ghostRafId) ghostRafId = requestAnimationFrame(flushGhost);
}

function flushGhost() {
  ghostRafId = 0;
  if (!pendingGhost) return;
  const { u, v } = pendingGhost;
  pendingGhost = null;
  sendMouse({ t: 'gp', u: Math.round(u * 10000) / 10000, v: Math.round(v * 10000) / 10000 });
}

// Tıklama/tekerlekten hemen önce bekleyen konumu zorla gönder: aksi halde
// hedeflenen noktadan bir kare önceki konuma tıklanabilir.
function flushGhostNow() {
  if (ghostRafId) { cancelAnimationFrame(ghostRafId); ghostRafId = 0; }
  flushGhost();
}

// Seçili kısayolun tamamı basılı mı?
function isReleaseHotkeyPressed() {
  const hk = RELEASE_HOTKEYS[prefs.releaseHotkey];
  if (!hk || !hk.keys.length) return false;
  return hk.keys.every((k) => physicallyDown.has(k));
}

document.addEventListener('mousemove', (e) => {
  lastPointer = { x: e.clientX, y: e.clientY };

  if (isGhostMode()) {
    if (ghostEngaged) queueGhostMove(e.clientX, e.clientY);
    return;
  }
  if (document.pointerLockElement !== video) return;
  if (e.movementX || e.movementY) sendMouse({ t: 'm', dx: e.movementX, dy: e.movementY });
});

const btnName = (n) => (n === 0 ? 'left' : n === 1 ? 'middle' : n === 2 ? 'right' : null);

// Buton olayları moda göre farklı kanaldan gider: 'b' gerçek imleci kullanır,
// 'gb' ise host'ta imleci kısa süre ödünç alıp hayaletin konumuna tıklar.
function sendButton(btn, down) {
  sendMouse(isGhostMode() ? { t: 'gb', btn, down } : { t: 'b', btn, down });
}

document.addEventListener('mousedown', (e) => {
  if (isGhostMode()) {
    if (!ghostEngaged) return;
    // Üst çubuk/panellere tıklanmışsa yakalamayı bırak, tıklama arayüzün olsun.
    if (e.target !== video) { stopGhostCapture(); showUi(); return; }

    const hkG = RELEASE_HOTKEYS[prefs.releaseHotkey];
    if (hkG && hkG.mouseButton != null && e.button === hkG.mouseButton) {
      e.preventDefault();
      releaseAllInputs();
      stopCapture();
      return;
    }

    const bg = btnName(e.button);
    if (!bg) return;
    e.preventDefault();
    queueGhostMove(e.clientX, e.clientY);
    flushGhostNow(); // tıklama kesinlikle imlecin durduğu piksele düşsün
    pressedButtons.add(bg);
    sendButton(bg, true);
    return;
  }

  if (document.pointerLockElement !== video) return;

  // Fare tuşu çıkış kısayolu olarak seçilmişse host'a gönderilmez.
  const hk = RELEASE_HOTKEYS[prefs.releaseHotkey];
  if (hk && hk.mouseButton != null && e.button === hk.mouseButton) {
    e.preventDefault();
    releaseAllInputs();
    stopCapture();
    return;
  }

  const b = btnName(e.button);
  if (!b) return;
  pressedButtons.add(b);
  sendButton(b, true);
});
document.addEventListener('mouseup', (e) => {
  const b = btnName(e.button);
  if (!b) return;

  if (isGhostMode()) {
    // Sürükleme video dışında bitse bile butonu MUTLAKA bırak; yoksa host'ta
    // fare basılı kalır ve gerçek imleç hayalette takılı kalır.
    if (!pressedButtons.has(b)) return;
    e.preventDefault();
    pressedButtons.delete(b);
    sendButton(b, false);
    return;
  }

  if (document.pointerLockElement !== video) return;
  pressedButtons.delete(b);
  sendButton(b, false);
});
document.addEventListener('contextmenu', (e) => {
  if (isCapturing()) e.preventDefault();
});
document.addEventListener('wheel', (e) => {
  if (isGhostMode()) {
    if (!ghostEngaged || e.target !== video) return;
    flushGhostNow(); // tekerlek imlecin ALTINDAKİ pencereye gider
    if (e.deltaY) sendMouse({ t: 'gw', delta: -Math.sign(e.deltaY) * 120 });
    if (e.deltaX) sendMouse({ t: 'gw', delta: Math.sign(e.deltaX) * 120, h: true });
    return;
  }
  if (document.pointerLockElement !== video) return;
  if (e.deltaY) sendMouse({ t: 'w', delta: -Math.sign(e.deltaY) * 120 });
  if (e.deltaX) sendMouse({ t: 'w', delta: Math.sign(e.deltaX) * 120, h: true });
}, { passive: true });

// Sohbet kutusuna yazarken tuşlar host'a gitmemeli.
function typingInField() {
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
}

document.addEventListener('keydown', (e) => {
  const captured = isCapturing();

  if (!captured || typingInField()) {
    if (e.code === 'F11' && !typingInField()) {
      e.preventDefault();
      toggleFullscreen();
    }
    return;
  }

  physicallyDown.add(e.code);

  // Yakalamadan çıkış kısayolu: host'a gönderilmez, yerel olarak kilidi açar.
  if (isReleaseHotkeyPressed()) {
    e.preventDefault();
    releaseAllInputs();
    stopCapture();
    return;
  }

  const m = KEYMAP[e.code];
  if (!m) return;
  e.preventDefault();
  if (e.repeat) return; // host tuşu zaten basılı tutuyor

  pressedKeys.set(e.code, m);
  sendKey({ t: 'k', scan: m[0], ext: m[1], down: true });
});

document.addEventListener('keyup', (e) => {
  physicallyDown.delete(e.code);
  const m = KEYMAP[e.code];
  if (!m) return;
  if (!pressedKeys.has(e.code)) return;
  e.preventDefault();
  pressedKeys.delete(e.code);
  sendKey({ t: 'k', scan: m[0], ext: m[1], down: false });
});

// Fare kilidi bırakıldığında (ESC) ya da pencere odağı kaybedildiğinde, o an basılı
// olan her şeyi host'ta serbest bırak. Aksi halde örneğin gaz tuşu basılı takılır.
document.addEventListener('pointerlockchange', () => {
  if (isGhostMode()) return; // bu modda fare kilidi hiç kullanılmıyor
  if (document.pointerLockElement === video) {
    scheduleUiHide();       // yakalandı: ipuçları/butonlar 5sn sonra kaybolsun
  } else {
    releaseAllInputs();
    physicallyDown.clear();
    showUi();               // yakalama bırakıldı: arayüz geri gelsin
    scheduleUiHide();       // ama hareketsiz kalırsa yine 5sn sonra gizlensin
  }
});

// ---------------- Arayüzün otomatik gizlenmesi ----------------

function showUi() {
  if (prefs.hideUiCompletely) {
    document.body.classList.add('ui-hidden');
    return;
  }
  document.body.classList.remove('ui-hidden');
}

function scheduleUiHide() {
  clearTimeout(uiHideTimer);
  if (!prefs.autoHideUi) return;
  uiHideTimer = setTimeout(() => {
    // Açık bir panel varsa gizleme, kullanıcı onunla uğraşıyor olabilir.
    if ($('settingsPanel').classList.contains('open') || $('sessionPanel').classList.contains('open')) {
      scheduleUiHide();
      return;
    }
    document.body.classList.add('ui-hidden');
  }, 5000);
}

// Fare hareket ederse (yakalama yokken) arayüzü geri getir.
document.addEventListener('mousemove', () => {
  if (isCapturing()) return;
  if (!prefs.hideUiCompletely) {
    document.body.classList.remove('ui-hidden');
    scheduleUiHide();
  }
});
// Pencere odağı giderse ikinci imleç de bırakılsın: sürükleme ortasında Alt+Tab
// yapılırsa host'ta fare basılı kalmasın.
window.addEventListener('blur', () => {
  releaseAllInputs();
  if (ghostEngaged) stopGhostCapture();
});
window.addEventListener('beforeunload', closeConnection);

function releaseAllInputs() {
  for (const [, m] of pressedKeys) sendKey({ t: 'k', scan: m[0], ext: m[1], down: false });
  pressedKeys.clear();
  for (const b of pressedButtons) sendButton(b, false);
  pressedButtons.clear();
  // Host tarafındaki köprüye de "her şeyi bırak" de: tek tek gönderdiklerimiz
  // yolda kaybolsa bile orada basılı hiçbir şey kalmaz.
  sendKey({ t: 'r' });
}

function sendMouse(obj) { if (mouseDc && mouseDc.readyState === 'open') mouseDc.send(JSON.stringify(obj)); }
function sendKey(obj) { if (keysDc && keysDc.readyState === 'open') keysDc.send(JSON.stringify(obj)); }
function sendControl(obj) { if (controlDc && controlDc.readyState === 'open') controlDc.send(JSON.stringify(obj)); }

// ---------------- Host'tan gelen kontrol mesajları ----------------

function handleControlMessage(msg) {
  if (!msg) return;
  switch (msg.t) {
    case 'sources': renderSourceList(msg.list, msg.current); break;
    case 'clip': receiveClipboard(msg.text); break;
    // ---- v4.0 ----
    case 'hello': applyHostFeatures(msg); break;
    case 'chat': receiveChat(msg.text); break;
    case 'sysinfo': renderHostStatic(msg.info); break;
    case 'sys': renderHostTick(msg); break;
    case 'modes': renderRemoteModes(msg); break;
    case 'res-result':
      setPanelNote('resolutionHint', msg.ok ? 'Uygulandı.' : (msg.reason || 'Uygulanamadı.'));
      break;
    case 'rec-state': updateHostRecordNote(msg); break;
    case 'sysinfo-off':
      hostFeatures.systemInfo = false;
      applyHostFeatures({ features: hostFeatures });
      break;
  }
}

function applyHostFeatures(msg) {
  if (msg.features) hostFeatures = { ...hostFeatures, ...msg.features };
  document.querySelector('#sessionTabs button[data-stab="files"]').style.display = hostFeatures.files ? '' : 'none';
  document.querySelector('#sessionTabs button[data-stab="system"]').style.display = hostFeatures.systemInfo ? '' : 'none';
  $('chatInput').disabled = !hostFeatures.chat;
  $('chatSendBtn').disabled = !hostFeatures.chat;
  if (!hostFeatures.chat) addChatMessage('sys', 'Host yazışmayı kapatmış.');
  $('resolutionSection').style.display = hostFeatures.resolution ? 'block' : 'none';
  if (msg.version) addChatMessage('sys', `Host sürümü: ${msg.version}`);
}

function setPanelNote(id, text) {
  $(id).textContent = text || '';
}

function renderSourceList(list, current) {
  const select = $('monitorSelect');
  const wrap = $('monitorSection');
  if (!list || list.length <= 1) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = 'block';
  select.innerHTML = '';

  for (const group of [{ label: 'Ekranlar', kind: 'screen' }, { label: 'Pencereler', kind: 'window' }]) {
    const items = list.filter((s) => (s.kind || 'screen') === group.kind);
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
  if (current) select.value = current;
}

$('monitorSelect').addEventListener('change', () => {
  sendControl({ t: 'set-source', id: $('monitorSelect').value });
});

// ---------------- v4.0: uzaktan çözünürlük ----------------

function renderRemoteModes(msg) {
  const section = $('resolutionSection');
  if (!msg.allowed) {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';
  const select = $('resolutionSelect');
  select.innerHTML = '';
  const modes = Array.isArray(msg.modes) ? msg.modes : [];
  for (const mode of modes) {
    const opt = document.createElement('option');
    opt.value = mode;
    opt.textContent = mode.replace('x', ' × ').replace('@', ' · ') + ' Hz';
    select.appendChild(opt);
  }
  if (msg.current) {
    const key = `${msg.current.w}x${msg.current.h}@${msg.current.hz}`;
    if (modes.includes(key)) select.value = key;
    setPanelNote('resolutionHint', `Şu an: ${msg.current.w} × ${msg.current.h} · ${msg.current.hz} Hz`);
  }
}

$('applyResolutionBtn').addEventListener('click', () => {
  const parsed = /^(\d+)x(\d+)@(\d+)$/.exec($('resolutionSelect').value || '');
  if (!parsed) return;
  setPanelNote('resolutionHint', 'Uygulanıyor...');
  sendControl({ t: 'set-res', w: +parsed[1], h: +parsed[2], hz: +parsed[3] });
});

$('restoreResolutionBtn').addEventListener('click', () => {
  setPanelNote('resolutionHint', 'Geri alınıyor...');
  sendControl({ t: 'set-res', restore: true });
});

// ---------------- Pano senkronizasyonu ----------------

function startClipboardSync() {
  stopClipboardSync();
  window.clientAPI.readClipboard().then((text) => { lastClipboardText = text || ''; });
  clipboardTimer = setInterval(async () => {
    if (!clipboardSync) return;
    const text = (await window.clientAPI.readClipboard()) || '';
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
  if (!clipboardSync || typeof text !== 'string') return;
  if (text === lastClipboardText) return;
  lastClipboardText = text; // yankıyı önle
  window.clientAPI.writeClipboard(text);
}

$('clipboardToggle').addEventListener('change', () => {
  clipboardSync = $('clipboardToggle').checked;
  if (clipboardSync) startClipboardSync();
  else stopClipboardSync();
});

// ---------------- v4.0: oturum paneli (sohbet / dosya / sistem) ----------------

$('sessionBtn').addEventListener('click', () => {
  const open = $('sessionPanel').classList.toggle('open');
  $('sessionBtn').classList.toggle('active', open);
  if (open) {
    $('settingsPanel').classList.remove('open');
    $('settingsBtn').classList.remove('active');
    unreadSession = 0;
    renderSessionBadge();
  }
});

document.querySelectorAll('#sessionTabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    activeSessionTab = btn.dataset.stab;
    document.querySelectorAll('#sessionTabs button').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.spanel').forEach((p) => {
      p.classList.toggle('active', p.id === 'spanel-' + activeSessionTab);
    });
  });
});

function renderSessionBadge() {
  const badge = $('sessionBadge');
  badge.textContent = unreadSession;
  badge.classList.toggle('show', unreadSession > 0);
}

function bumpSession() {
  if ($('sessionPanel').classList.contains('open')) return;
  unreadSession += 1;
  renderSessionBadge();
}

// ---- Sohbet ----

function addChatMessage(kind, text) {
  const log = $('chatLog');
  const el = document.createElement('div');
  el.className = 'msg ' + kind;
  el.textContent = text;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  while (log.children.length > 300) log.removeChild(log.firstChild);
}

function receiveChat(text) {
  if (typeof text !== 'string' || !text.trim()) return;
  addChatMessage('them', text);
  bumpSession();
}

function sendChat() {
  const input = $('chatInput');
  const text = input.value.trim();
  if (!text) return;
  if (!controlDc || controlDc.readyState !== 'open') {
    addChatMessage('sys', 'Bağlantı yok.');
    return;
  }
  input.value = '';
  sendControl({ t: 'chat', text: text.slice(0, 2000) });
  addChatMessage('me', text);
}

$('chatSendBtn').addEventListener('click', sendChat);
$('chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.stopPropagation(); sendChat(); }
});

// ---- Dosya aktarımı ----

const TRANSFER_STATES = {
  queued: 'sırada', offered: 'onay bekleniyor', sending: 'gönderiliyor',
  receiving: 'alınıyor', flushing: 'tamamlanıyor', done: 'tamamlandı',
  error: 'hata', rejected: 'reddedildi',
};

function setupFileTransfer() {
  fileTransfer = window.GLFileTransfer.create({
    io: window.clientAPI.fileIO,
    onEvent: (type, rec, list) => {
      renderTransfers(list);
      if (type === 'incoming') bumpSession();
      if (type === 'done' && rec) addChatMessage('sys', `${rec.dir === 'in' ? 'Alındı' : 'Gönderildi'}: ${rec.name}`);
      if (type === 'error' && rec) addChatMessage('sys', `Aktarım başarısız (${rec.name}): ${rec.error}`);
    },
    askAccept: async (rec) => {
      if (prefs.autoAcceptFiles) return true;
      return window.clientAPI.askFileAccept({ name: rec.name, size: rec.size });
    },
  });
}

function renderTransfers(list) {
  const box = $('transferList');
  box.innerHTML = '';
  for (const rec of list || []) {
    const item = document.createElement('div');
    item.className = 'transfer' + (rec.state === 'done' ? ' done' : rec.state === 'error' ? ' error' : '');
    const percent = rec.size > 0 ? Math.min(100, (rec.moved / rec.size) * 100) : (rec.state === 'done' ? 100 : 0);
    const rate = rec.rate > 0 && (rec.state === 'sending' || rec.state === 'receiving')
      ? ` · ${formatBytes(rec.rate)}/sn` : '';
    item.innerHTML = `
      <div class="head">
        <span>${rec.dir === 'in' ? '⬇' : '⬆'}</span>
        <span class="name">${escapeHtml(rec.name)}</span>
      </div>
      <div class="meta">${formatBytes(rec.moved)} / ${formatBytes(rec.size)} · ${TRANSFER_STATES[rec.state] || rec.state}${rate}${rec.error ? ' — ' + escapeHtml(rec.error) : ''}</div>
      <div class="bar"><i style="width:${percent}%"></i></div>
    `;
    const actions = document.createElement('div');
    actions.className = 'act';
    if (rec.state === 'done' && rec.dir === 'in' && rec.path) {
      const reveal = document.createElement('button');
      reveal.textContent = 'Klasörde göster';
      reveal.addEventListener('click', () => window.clientAPI.fileIO.reveal(rec.path));
      actions.appendChild(reveal);
    }
    if (['queued', 'offered', 'sending', 'receiving', 'flushing'].includes(rec.state)) {
      const cancel = document.createElement('button');
      cancel.className = 'danger';
      cancel.textContent = 'İptal';
      cancel.addEventListener('click', () => fileTransfer.cancel(rec.id));
      actions.appendChild(cancel);
    }
    if (actions.children.length) item.appendChild(actions);
    box.appendChild(item);
  }
}

$('pickFilesBtn').addEventListener('click', async () => {
  if (!filesDc || filesDc.readyState !== 'open') {
    addChatMessage('sys', 'Dosya kanalı hazır değil.');
    return;
  }
  const files = await window.clientAPI.fileIO.pickFiles();
  if (files && files.length) fileTransfer.sendFiles(files);
});

$('clearFilesBtn').addEventListener('click', () => fileTransfer.clearFinished());

const dropzone = $('dropzone');
['dragenter', 'dragover'].forEach((type) => {
  document.addEventListener(type, (e) => { e.preventDefault(); dropzone.classList.add('hot'); });
});
['dragleave', 'drop'].forEach((type) => {
  document.addEventListener(type, (e) => {
    e.preventDefault();
    if (type === 'dragleave' && e.relatedTarget) return;
    dropzone.classList.remove('hot');
  });
});
document.addEventListener('drop', (e) => {
  e.preventDefault();
  if (!filesDc || filesDc.readyState !== 'open') return;
  const files = Array.from(e.dataTransfer.files || []);
  if (!files.length) return;
  $('sessionPanel').classList.add('open');
  document.querySelector('#sessionTabs button[data-stab="files"]').click();
  fileTransfer.sendFiles(files);
});

// ---- Host sistem bilgisi ----

// Eski bilgisayarlardaki disk/ağ etkinlik ışığı: sabit yanmak yerine etkinlik
// oranıyla orantılı bir olasılıkla titriyor. Sönümlenme, verinin 250 ms'de bir
// gelmesine rağmen ışığın "canlı" görünmesini sağlıyor.
function makeLed(element) {
  let level = 0;
  setInterval(() => {
    if (level <= 0.02) { element.classList.remove('on'); return; }
    element.classList.toggle('on', Math.random() < Math.min(0.92, 0.2 + level * 0.75));
  }, 70);
  return { set: (v) => { level = Math.max(0, Math.min(1, v)); } };
}

const diskLed = makeLed($('diskLed'));
const netLed = makeLed($('netLed'));

function renderHostStatic(info) {
  if (!info) return;
  hostStatic = info;
  $('sysNote').style.display = 'none';

  const disks = Array.isArray(info.disks) ? info.disks : (info.disks ? [info.disks] : []);
  const rows = [];
  if (info.cpu && info.cpu.name) {
    rows.push(['İşlemci', `${String(info.cpu.name).trim()} (${info.cpu.cores}Ç/${info.cpu.threads}İ)`]);
  }
  if (info.gpu && info.gpu.length) rows.push(['Ekran kartı', [].concat(info.gpu).join(', ')]);
  if (info.memTotal) rows.push(['Bellek', formatBytes(info.memTotal)]);
  if (info.os && info.os.name) rows.push(['İşletim sistemi', `${info.os.name} (${info.os.build})`]);
  if (info.machine && info.machine.model && info.machine.model !== 'Default string') {
    rows.push(['Makine', `${info.machine.manufacturer} ${info.machine.model}`]);
  }
  if (info.vm) rows.push(['Ortam', 'Sanal makine']);
  if (info.rdpSession) rows.push(['Oturum', 'Uzak masaüstü (RDP)']);
  for (const d of disks) {
    const used = d.size ? Math.round(((d.size - d.free) / d.size) * 100) : 0;
    rows.push([`Disk ${d.id}`, `${formatBytes(d.free)} boş / ${formatBytes(d.size)} (%${used} dolu)`]);
  }

  $('sysStaticBox').innerHTML = rows
    .map(([k, v]) => `<div class="kv"><span>${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></div>`)
    .join('');
}

function renderHostTick(msg) {
  const cpu = msg.cpu || 0;
  $('sysCpu').textContent = `%${cpu.toFixed(0)}`;
  $('cpuBar').style.width = cpu + '%';
  $('cpuGauge').classList.toggle('warn', cpu >= 85);

  if (msg.mem && msg.mem.total) {
    const pct = (msg.mem.used / msg.mem.total) * 100;
    $('sysMem').textContent = `${formatBytes(msg.mem.used)} / ${formatBytes(msg.mem.total)}`;
    $('memBar').style.width = pct + '%';
    $('memGauge').classList.toggle('warn', pct >= 88);
  }

  if (msg.disk) {
    const throughput = (msg.disk.read || 0) + (msg.disk.write || 0);
    $('sysDisk').textContent = throughput > 1024 ? formatBytes(throughput) + '/sn' : '—';
    // Işık hem meşguliyet yüzdesine hem de veri hızına bakıyor: SSD'lerde yüzde
    // düşük kalsa bile veri akıyorsa ışık yanmalı.
    diskLed.set(Math.max((msg.disk.busy || 0) / 100, Math.min(1, throughput / (60 * 1024 * 1024))));
    $('diskLed').style.display = '';
  } else {
    $('sysDisk').textContent = 'ölçülemiyor';
    diskLed.set(0);
  }

  if (msg.net) {
    const total = (msg.net.rx || 0) + (msg.net.tx || 0);
    $('sysNet').textContent = total > 1024 ? formatBytes(total) + '/sn' : '—';
    netLed.set(Math.min(1, total / (12 * 1024 * 1024)));
  }
}

// ---------------- v4.0: client tarafı ekran kaydı ----------------

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

async function startRecording() {
  if (recorder) return;
  const stream = video.srcObject;
  if (!stream) { addChatMessage('sys', 'Kayıt için görüntü akışı gerekiyor.'); return; }

  const opened = await window.clientAPI.fileIO.openWrite(`GameLink-${recordStamp()}.webm`, 'videos');
  if (!opened || opened.error) {
    addChatMessage('sys', 'Kayıt dosyası açılamadı: ' + ((opened && opened.error) || '?'));
    return;
  }
  recordHandle = opened.handle;
  recordPath = opened.path;
  recordQueue = Promise.resolve();

  try {
    recorder = new MediaRecorder(stream, {
      mimeType: pickRecorderMime() || undefined,
      videoBitsPerSecond: Math.round((prefs.recordBitrate || 10) * 1e6),
    });
  } catch (err) {
    window.clientAPI.fileIO.abortWrite(recordHandle);
    recordHandle = null;
    addChatMessage('sys', 'Kayıt başlatılamadı: ' + err.message);
    return;
  }

  recorder.ondataavailable = (ev) => {
    if (!ev.data || !ev.data.size || recordHandle == null) return;
    const handle = recordHandle;
    // Bloklar sırayla yazılıyor: aksi halde IPC yarışında parçalar karışır.
    recordQueue = recordQueue.then(async () => {
      const buffer = new Uint8Array(await ev.data.arrayBuffer());
      await window.clientAPI.fileIO.writeChunk(handle, buffer);
    }).catch((err) => console.error('[kayıt]', err));
  };

  recorder.start(1000);
  recordStartedAt = Date.now();
  addChatMessage('sys', 'Kayıt başladı.');
  updateRecordButton();
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
  await window.clientAPI.fileIO.closeWrite(handle);
  if (!silent) addChatMessage('sys', 'Kayıt tamamlandı: ' + savedPath);
  updateRecordButton();
}

function updateRecordButton() {
  const btn = $('recordBtn');
  btn.classList.toggle('recording', !!recorder);
  if (recorder) {
    const seconds = Math.round((Date.now() - recordStartedAt) / 1000);
    btn.textContent = `⏹ ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  } else {
    btn.textContent = '⏺ Kaydet';
  }
}

setInterval(() => { if (recorder) updateRecordButton(); }, 1000);

$('recordBtn').addEventListener('click', () => (recorder ? stopRecording(false) : startRecording()));

function updateHostRecordNote(msg) {
  if (msg.on) addChatMessage('sys', 'Host kendi tarafında kayda başladı.');
}

// ---------------- Tam ekran / pencere ----------------

let isFullscreen = false;

function setFullscreen(on) {
  isFullscreen = on;
  window.clientAPI.setFullscreen(on);
  $('fullscreenBtn').classList.toggle('active', on);
}
function toggleFullscreen() { setFullscreen(!isFullscreen); }

$('fullscreenBtn').addEventListener('click', toggleFullscreen);

function applyFitMode(mode, save = true) {
  prefs.fitMode = mode;
  document.body.dataset.fit = mode;
  highlightSeg('#fitSeg', 'fit', mode);
  if (save) window.clientAPI.savePrefs({ fitMode: mode });
}

document.querySelectorAll('#fitSeg button').forEach((btn) => {
  btn.addEventListener('click', () => applyFitMode(btn.dataset.fit));
});

document.querySelectorAll('#windowSeg button').forEach((btn) => {
  btn.addEventListener('click', async () => {
    switch (btn.dataset.win) {
      case 'windowed': setFullscreen(false); break;
      case 'maximize': setFullscreen(false); window.clientAPI.toggleMaximize(); break;
      case 'fullscreen': setFullscreen(true); break;
      case 'native':
        if (!video.videoWidth) return;
        await window.clientAPI.fitWindowTo(video.videoWidth, video.videoHeight);
        applyFitMode('actual');
        break;
    }
  });
});

// ---------------- İstatistikler + ağ kalitesi göstergesi ----------------

function setOverlayInfo(text) {
  $('statsInfo').textContent = text;
}

$('statsBtn').addEventListener('click', () => {
  const shown = $('statsBox').classList.toggle('open');
  $('statsBtn').classList.toggle('active', shown);
});

$('qosToggle').addEventListener('change', async () => {
  prefs.showQosHud = $('qosToggle').checked;
  applyQosVisibility();
  await window.clientAPI.savePrefs({ showQosHud: prefs.showQosHud });
});

function applyQosVisibility() {
  $('qosHud').classList.toggle('show', prefs.showQosHud !== false);
}

function startStats() {
  stopStats();
  lastStatsSample = null;
  statsTimer = setInterval(updateStats, 1000);
}

function stopStats() {
  if (statsTimer) { clearInterval(statsTimer); statsTimer = null; }
}

// Ping ve paket kaybına göre 0-4 arası bir kalite puanı. HUD'daki çubuklar ve
// renkler bundan besleniyor.
function qualityScore(rttMs, lossPct) {
  let score = 4;
  if (rttMs == null) score -= 1;
  else if (rttMs > 150) score -= 3;
  else if (rttMs > 80) score -= 2;
  else if (rttMs > 40) score -= 1;
  if (lossPct > 5) score -= 2;
  else if (lossPct > 1) score -= 1;
  return Math.max(0, Math.min(4, score));
}

function qualityClass(score) {
  return score >= 3 ? 'good' : score >= 2 ? 'fair' : 'bad';
}

async function updateStats() {
  if (!pc) return;
  let report;
  try { report = await pc.getStats(); } catch { return; }

  let inbound = null;
  let pair = null;
  report.forEach((s) => {
    if (s.type === 'inbound-rtp' && s.kind === 'video') inbound = s;
    if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated !== false) pair = s;
  });
  if (!inbound) return;

  const now = inbound.timestamp;
  let mbps = 0;
  let lossPct = 0;
  let decodeMs = null;
  if (lastStatsSample && now > lastStatsSample.timestamp) {
    const seconds = (now - lastStatsSample.timestamp) / 1000;
    mbps = ((inbound.bytesReceived - lastStatsSample.bytesReceived) * 8) / seconds / 1e6;
    const lostDelta = (inbound.packetsLost || 0) - (lastStatsSample.packetsLost || 0);
    const recvDelta = (inbound.packetsReceived || 0) - (lastStatsSample.packetsReceived || 0);
    const total = lostDelta + recvDelta;
    if (total > 0) lossPct = (lostDelta / total) * 100;
    // Ortalama kare çözme süresi: donmaların CPU kaynaklı mı ağ kaynaklı mı
    // olduğunu ayırt etmenin en doğrudan yolu.
    const decodedDelta = (inbound.framesDecoded || 0) - (lastStatsSample.framesDecoded || 0);
    const timeDelta = (inbound.totalDecodeTime || 0) - (lastStatsSample.totalDecodeTime || 0);
    if (decodedDelta > 0) decodeMs = (timeDelta / decodedDelta) * 1000;
  }
  lastStatsSample = {
    timestamp: now,
    bytesReceived: inbound.bytesReceived,
    packetsLost: inbound.packetsLost,
    packetsReceived: inbound.packetsReceived,
    framesDecoded: inbound.framesDecoded,
    totalDecodeTime: inbound.totalDecodeTime,
  };

  const rttMs = pair && pair.currentRoundTripTime != null
    ? Math.round(pair.currentRoundTripTime * 1000)
    : null;
  const resolution = inbound.frameWidth ? `${inbound.frameWidth}×${inbound.frameHeight}` : '-';
  const fps = inbound.framesPerSecond != null ? Math.round(inbound.framesPerSecond) : '-';

  const codecStat = inbound.codecId ? report.get(inbound.codecId) : null;
  const codecName = codecStat ? String(codecStat.mimeType || '').replace('video/', '') : '-';
  let transport = '-';
  if (pair) {
    const local = report.get(pair.localCandidateId);
    const remote = report.get(pair.remoteCandidateId);
    const relay = (local && local.candidateType === 'relay') || (remote && remote.candidateType === 'relay');
    transport = relay ? 'TURN (röle)' : 'Doğrudan';
  }

  $('statsBox').innerHTML = `
    <div><span>Çözünürlük</span><b>${resolution}</b></div>
    <div><span>FPS</span><b>${fps}</b></div>
    <div><span>Kodek</span><b>${escapeHtml(codecName)}</b></div>
    <div><span>Bit hızı</span><b>${mbps.toFixed(2)} Mbps</b></div>
    <div><span>Gecikme (RTT)</span><b>${rttMs != null ? rttMs + ' ms' : '-'}</b></div>
    <div><span>Paket kaybı</span><b>${lossPct.toFixed(1)} %</b></div>
    <div><span>Jitter</span><b>${inbound.jitter != null ? Math.round(inbound.jitter * 1000) + ' ms' : '-'}</b></div>
    <div><span>Kare çözme</span><b>${decodeMs != null ? decodeMs.toFixed(1) + ' ms' : '-'}</b></div>
    <div><span>Donma</span><b>${inbound.freezeCount != null ? inbound.freezeCount : '-'}</b></div>
    <div><span>Bağlantı</span><b>${transport}</b></div>
  `;

  setOverlayInfo(`${fps} fps · ${mbps.toFixed(1)} Mbps${rttMs != null ? ' · ' + rttMs + ' ms' : ''}`);

  // ---- Ağ kalitesi göstergesi ----
  const score = qualityScore(rttMs, lossPct);
  const cls = qualityClass(score);
  const barColor = cls === 'good' ? '#4ade80' : cls === 'fair' ? '#fbbf24' : '#f87171';
  const bars = $('qosBars').children;
  for (let i = 0; i < bars.length; i++) {
    bars[i].classList.toggle('on', i < score);
    bars[i].style.background = barColor;
  }
  const ping = $('qosPing');
  ping.textContent = rttMs != null ? rttMs + 'ms' : '—';
  ping.className = cls;
  const loss = $('qosLoss');
  loss.textContent = lossPct.toFixed(1) + '%';
  loss.className = lossPct > 5 ? 'bad' : lossPct > 1 ? 'fair' : 'good';
  $('qosBitrate').textContent = mbps.toFixed(1);
  $('qosFps').textContent = fps;
}

// ---------------- Ayarlar paneli (Mod + Kalite) ----------------

$('settingsBtn').addEventListener('click', () => {
  const open = $('settingsPanel').classList.toggle('open');
  $('settingsBtn').classList.toggle('active', open);
  if (open) {
    $('sessionPanel').classList.remove('open');
    $('sessionBtn').classList.remove('active');
  }
});

function highlightSeg(selector, dataKey, value) {
  document.querySelectorAll(selector + ' button').forEach((b) => {
    b.classList.toggle('active', b.dataset[dataKey] === value);
  });
}

function setQuality(quality, send = true) {
  currentQuality = quality;
  highlightSeg('#qualitySeg', 'quality', quality);
  $('customControls').style.display = quality === 'custom' ? 'block' : 'none';
  window.clientAPI.savePrefs({ quality });
  if (send && quality !== 'custom') sendCurrentSettings();
}

function setMode(mode, send = true) {
  currentMode = mode;
  highlightSeg('#modeSeg', 'mode', mode);
  applyModeLocally(mode);
  window.clientAPI.savePrefs({ mode });
  // Mod, kendi önerdiği kalite profilini de getirir.
  const suggested = MODE_PRESETS[mode].quality;
  if (suggested && currentQuality !== 'custom') {
    setQuality(suggested, false);
  }
  if (send) sendCurrentSettings();
}

document.querySelectorAll('#modeSeg button').forEach((btn) => {
  btn.addEventListener('click', () => setMode(btn.dataset.mode));
});

document.querySelectorAll('#qualitySeg button').forEach((btn) => {
  btn.addEventListener('click', () => setQuality(btn.dataset.quality));
});

// ---------------- Tercihler (kısayol + arayüz) ----------------

function populateHotkeySelect() {
  const select = $('releaseHotkeySelect');
  select.innerHTML = '';
  for (const [key, def] of Object.entries(RELEASE_HOTKEYS)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = def.label;
    select.appendChild(opt);
  }
  select.value = prefs.releaseHotkey;
  updateHotkeyHint();
}

function updateHotkeyHint() {
  const def = RELEASE_HOTKEYS[prefs.releaseHotkey];
  const label = escapeHtml(def ? def.label : '-');
  $('hint').innerHTML = isGhostMode()
    ? `İkinci imleç · Başlatmak için görüntüye tıklayın · <b>${label}</b> ile ya da arayüze tıklayarak çıkın`
    : `Yakalamak için tıklayın · <b>${label}</b> ile çıkış · F11 tam ekran`;
}

$('releaseHotkeySelect').addEventListener('change', async () => {
  prefs.releaseHotkey = $('releaseHotkeySelect').value;
  await window.clientAPI.savePrefs({ releaseHotkey: prefs.releaseHotkey });
  updateHotkeyHint();
});

$('autoHideToggle').addEventListener('change', async () => {
  prefs.autoHideUi = $('autoHideToggle').checked;
  await window.clientAPI.savePrefs({ autoHideUi: prefs.autoHideUi });
  if (prefs.autoHideUi) scheduleUiHide();
  else { clearTimeout(uiHideTimer); showUi(); }
});

$('hideUiToggle').addEventListener('change', async () => {
  prefs.hideUiCompletely = $('hideUiToggle').checked;
  await window.clientAPI.savePrefs({ hideUiCompletely: prefs.hideUiCompletely });
  showUi();
});

$('applyCustomBtn').addEventListener('click', () => sendCurrentSettings());

// ---------------- İmleç modu ----------------

const CURSOR_HINTS = {
  single: 'Host\'un kendi imlecini sürersiniz — oyunlar için gerekli olan mod. '
    + 'Host kullanıcısı aynı anda fareyi kullanamaz.',
  ghost: 'Ekranda size ait ikinci bir imleç belirir; host kullanıcısı kendi faresiyle '
    + 'çalışmaya devam eder. Tıkladığınız an gerçek imleç birkaç milisaniye ödünç alınır. '
    + 'Oyunlarda (ham girdi kullanan) çalışmaz, masaüstü işleri içindir.',
};

function applyCursorModeLocally(mode) {
  prefs.cursorMode = mode;
  document.body.classList.toggle('ghost-mode', mode === 'ghost');
  highlightSeg('#cursorSeg', 'cursor', mode);
  $('cursorHint').textContent = CURSOR_HINTS[mode] || '';
  updateHotkeyHint();
}

function setCursorMode(mode) {
  if (mode !== 'single' && mode !== 'ghost') return;
  if (mode === prefs.cursorMode) return;

  // Mod değişmeden ÖNCE her şeyi eski moda uygun kanaldan bırak; sonra yakalamayı
  // kapat. Aksi halde host'ta ters kanalda basılı buton/tuş kalır.
  releaseAllInputs();
  stopCapture();

  applyCursorModeLocally(mode);
  window.clientAPI.savePrefs({ cursorMode: mode });
  sendControl({ t: 'cursor-mode', mode });
}

document.querySelectorAll('#cursorSeg button').forEach((btn) => {
  btn.addEventListener('click', () => setCursorMode(btn.dataset.cursor));
});

function applyModeLocally(mode) {
  if (!pc) return;
  const receiver = pc.getReceivers().find((r) => r.track && r.track.kind === 'video');
  if (!receiver) return;
  const hint = MODE_PRESETS[mode].playoutDelayHint;
  try { receiver.playoutDelayHint = hint; } catch (e) { /* tarayıcı desteklemiyorsa sessizce geç */ }
}

function getQualityValues() {
  if (currentQuality === 'custom') {
    return {
      scaleResolutionDownBy: parseFloat($('customScale').value) || 1,
      maxFramerate: parseInt($('customFps').value, 10) || 30,
      maxBitrate: Math.round((parseFloat($('customBitrate').value) || 3) * 1_000_000),
    };
  }
  return QUALITY_PRESETS[currentQuality];
}

function sendCurrentSettings() {
  const quality = getQualityValues();
  const mode = MODE_PRESETS[currentMode];
  sendControl({
    t: 'settings',
    scaleResolutionDownBy: quality.scaleResolutionDownBy,
    maxFramerate: quality.maxFramerate,
    maxBitrate: quality.maxBitrate,
    degradationPreference: mode.degradationPreference,
  });
}

init();
