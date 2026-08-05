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

let ws, pc, mouseDc, keysDc, controlDc;
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

// ---------------- Başlangıç ----------------

async function init() {
  const data = await window.clientAPI.getInitData();
  hwid = data.hwid;
  deviceName = data.deviceName;
  renderConnList(data.savedConnections);

  prefs = await window.clientAPI.getPrefs();
  applyTheme(prefs.theme || 'system');
  $('autoHideToggle').checked = prefs.autoHideUi;
  $('hideUiToggle').checked = prefs.hideUiCompletely;
  populateHotkeySelect();

  // Kaydedilmiş mod/kalite geri yüklenir (henüz bağlantı yok, host'a gönderme).
  currentMode = prefs.mode || 'game';
  currentQuality = prefs.quality || 'balanced';
  highlightSeg('#modeSeg', 'mode', currentMode);
  highlightSeg('#qualitySeg', 'quality', currentQuality);
  $('customControls').style.display = currentQuality === 'custom' ? 'block' : 'none';

  applyCursorModeLocally(prefs.cursorMode || 'single');
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
      const updated = await window.clientAPI.removeConnection(c.id);
      renderConnList(updated);
    });
    item.appendChild(del);
    container.appendChild(item);
  }
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

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
    const video = $('remoteVideo');
    video.srcObject = ev.streams[0];
    video.play().catch(() => { /* otomatik oynatma engellenirse kullanıcı tıklayınca başlar */ });
    showStage();
    applyModeLocally(currentMode); // playoutDelayHint için receiver artık hazır
  };

  pc.ondatachannel = (ev) => {
    if (ev.channel.label === 'mouse') mouseDc = ev.channel;
    else if (ev.channel.label === 'keys') keysDc = ev.channel;
    else if (ev.channel.label === 'control') {
      controlDc = ev.channel;
      controlDc.onmessage = (m) => handleControlMessage(safeParse(m.data));
      controlDc.onopen = () => {
        sendCurrentSettings(); // bağlanınca varsayılan mod/kalite host'a bildirilir
        sendControl({ t: 'cursor-mode', mode: prefs.cursorMode || 'single' });
        sendControl({ t: 'get-sources' });
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

async function handleSignal(payload) {
  if (payload.sdp) {
    ensurePeerConnection(payload.iceServers, payload.iceTransportPolicy);
    await pc.setRemoteDescription(payload.sdp);
    remoteDescriptionSet = true;
    if (payload.sdp.type === 'offer') {
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
  $('stageView').style.display = 'block';
  startStats();
}
function showConnectView() {
  $('stageView').style.display = 'none';
  $('connectView').style.display = 'flex';
  $('connectBtn').disabled = false;
  $('settingsPanel').classList.remove('open');
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
  clearTimeout(uiHideTimer);
  document.body.classList.remove('ui-hidden');
  if (mouseDc) { mouseDc.close(); mouseDc = null; }
  if (keysDc) { keysDc.close(); keysDc = null; }
  if (controlDc) { controlDc.close(); controlDc = null; }
  if (pc) { pc.onconnectionstatechange = null; pc.close(); pc = null; }
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
  pendingCandidates = [];
  remoteDescriptionSet = false;
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
// orada paylaşılan monitörün koordinatına çevriliyor.

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

// object-fit: contain nedeniyle videonun etrafında siyah bant olabilir; oranı
// bant alanına göre değil, GERÇEK görüntü alanına göre hesaplamak zorundayız.
function videoContentRect() {
  const r = video.getBoundingClientRect();
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return { x: r.left, y: r.top, w: r.width, h: r.height };
  const scale = Math.min(r.width / vw, r.height / vh);
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
    // Üst çubuk/ayarlar paneline tıklanmışsa yakalamayı bırak, tıklama arayüzün olsun.
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

document.addEventListener('keydown', (e) => {
  const captured = isCapturing();

  if (!captured) {
    if (e.code === 'F11') {
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
    // Ayarlar paneli açıkken gizleme, kullanıcı orayla uğraşıyor olabilir.
    if ($('settingsPanel').classList.contains('open')) {
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
    case 'sources': renderMonitorList(msg.list, msg.current); break;
    case 'clip': receiveClipboard(msg.text); break;
  }
}

function renderMonitorList(list, current) {
  const select = $('monitorSelect');
  const wrap = $('monitorSection');
  if (!list || list.length <= 1) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = 'block';
  select.innerHTML = '';
  for (const s of list) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name + (s.primary ? ' (birincil)' : '');
    select.appendChild(opt);
  }
  if (current) select.value = current;
}

$('monitorSelect').addEventListener('change', () => {
  sendControl({ t: 'set-source', id: $('monitorSelect').value });
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

// ---------------- Tam ekran ----------------

let isFullscreen = false;

function setFullscreen(on) {
  isFullscreen = on;
  window.clientAPI.setFullscreen(on);
  $('fullscreenBtn').classList.toggle('active', on);
}
function toggleFullscreen() { setFullscreen(!isFullscreen); }

$('fullscreenBtn').addEventListener('click', toggleFullscreen);

// ---------------- İstatistikler ----------------

function setOverlayInfo(text) {
  $('statsInfo').textContent = text;
}

$('statsBtn').addEventListener('click', () => {
  const shown = $('statsBox').classList.toggle('open');
  $('statsBtn').classList.toggle('active', shown);
});

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
  if (lastStatsSample && now > lastStatsSample.timestamp) {
    const seconds = (now - lastStatsSample.timestamp) / 1000;
    mbps = ((inbound.bytesReceived - lastStatsSample.bytesReceived) * 8) / seconds / 1e6;
    const lostDelta = (inbound.packetsLost || 0) - (lastStatsSample.packetsLost || 0);
    const recvDelta = (inbound.packetsReceived || 0) - (lastStatsSample.packetsReceived || 0);
    const total = lostDelta + recvDelta;
    if (total > 0) lossPct = (lostDelta / total) * 100;
  }
  lastStatsSample = {
    timestamp: now,
    bytesReceived: inbound.bytesReceived,
    packetsLost: inbound.packetsLost,
    packetsReceived: inbound.packetsReceived,
  };

  const rttMs = pair && pair.currentRoundTripTime != null
    ? Math.round(pair.currentRoundTripTime * 1000)
    : null;
  const resolution = inbound.frameWidth ? `${inbound.frameWidth}×${inbound.frameHeight}` : '-';
  const fps = inbound.framesPerSecond != null ? Math.round(inbound.framesPerSecond) : '-';

  $('statsBox').innerHTML = `
    <div><span>Çözünürlük</span><b>${resolution}</b></div>
    <div><span>FPS</span><b>${fps}</b></div>
    <div><span>Bit hızı</span><b>${mbps.toFixed(2)} Mbps</b></div>
    <div><span>Gecikme (RTT)</span><b>${rttMs != null ? rttMs + ' ms' : '-'}</b></div>
    <div><span>Paket kaybı</span><b>${lossPct.toFixed(1)} %</b></div>
    <div><span>Jitter</span><b>${inbound.jitter != null ? Math.round(inbound.jitter * 1000) + ' ms' : '-'}</b></div>
  `;

  setOverlayInfo(`${fps} fps · ${mbps.toFixed(1)} Mbps${rttMs != null ? ' · ' + rttMs + ' ms' : ''}`);
}

// ---------------- Ayarlar paneli (Mod + Kalite) ----------------

$('settingsBtn').addEventListener('click', () => {
  $('settingsPanel').classList.toggle('open');
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
