// GameLink Client — mantık katmanı (DOM olaylarına bağlı ama React'ten bağımsız).
//
// Fare/klavye yakalama doğrudan `document` dinleyicileriyle yapılır ve veri
// kanalına yazar. Bu bilinçli: fare hareketi saniyede onlarca olay üretiyor,
// bunları React state'ine sokmak gereksiz render ve gecikme demek olurdu.
// React yalnızca gerçekten değişen arayüz durumuna abone olur.

// ---- Fiziksel tuş -> PS/2 Set-1 tarama kodu eşlemesi (input-bridge.ps1 ile birebir aynı) ----
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

export const QUALITY_PRESETS = {
  'data-saver': { scaleResolutionDownBy: 2,   maxFramerate: 30, maxBitrate: 1_500_000 },
  'balanced':   { scaleResolutionDownBy: 1.5, maxFramerate: 30, maxBitrate: 3_000_000 },
  'high':       { scaleResolutionDownBy: 1,   maxFramerate: 60, maxBitrate: 8_000_000 },
};

// Her modun kendi önerdiği kalite profili var: mod değişince kalite de otomatik
// oraya geçer (kullanıcı isterse sonrasında kaliteyi elle değiştirebilir).
export const MODE_PRESETS = {
  game:   { degradationPreference: 'maintain-framerate',  playoutDelayHint: 0,   quality: 'balanced' },
  normal: { degradationPreference: 'maintain-resolution', playoutDelayHint: 0.1, quality: 'high' },
  stream: { degradationPreference: 'balanced',            playoutDelayHint: 0.4, quality: 'high' },
};

// Escape host'a iletiliyor (oyun menüleri için), bu yüzden yakalamadan çıkış
// ayrı bir kombinasyonla yapılıyor.
export const RELEASE_HOTKEYS = {
  'CtrlLeft+AltLeft':   { label: 'Sol Ctrl + Sol Alt',   keys: ['ControlLeft', 'AltLeft'] },
  'CtrlLeft+ShiftLeft': { label: 'Sol Ctrl + Sol Shift', keys: ['ControlLeft', 'ShiftLeft'] },
  'AltLeft+ShiftLeft':  { label: 'Sol Alt + Sol Shift',  keys: ['AltLeft', 'ShiftLeft'] },
  'F12':                { label: 'F12',                  keys: ['F12'] },
  'Numpad0':            { label: 'Numpad 0',             keys: ['Numpad0'] },
  'NumpadMultiply':     { label: 'Numpad *',             keys: ['NumpadMultiply'] },
  'ScrollLock':         { label: 'Scroll Lock',          keys: ['ScrollLock'] },
  'MouseMiddle':        { label: 'Fare Orta Tuş',        keys: [], mouseButton: 1 },
};

const DEFAULT_ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const listeners = new Set();

let ws, pc, mouseDc, keysDc, controlDc;
let hwid, deviceName;
let video = null;
let pendingCandidates = [];
let remoteDescriptionSet = false;
let statsTimer = null;
let lastStatsSample = null;
let clipboardTimer = null;
let lastClipboardText = '';
let uiHideTimer = null;
let keyboardLockActive = false;

// Basılı tuşlar/butonlar: fare kilidi bırakıldığında ya da pencere odağı gidince
// host'ta hiçbir şey basılı kalmasın diye takip ediliyor.
const pressedKeys = new Map();
const pressedButtons = new Set();
// Çıkış kısayolunu tespit etmek için o an fiziksel olarak basılı olan tuşlar
// (host'a gönderilenlerden ayrı tutuluyor).
const physicallyDown = new Set();

export const state = {
  view: 'connect',            // connect | stage
  savedConnections: [],
  connectStatus: { msg: '', isErr: false },
  connecting: false,
  prefs: {
    releaseHotkey: 'CtrlLeft+AltLeft', autoHideUi: true, hideUiCompletely: false,
    mode: 'game', quality: 'balanced', clipboardSync: true, minimizeToTray: true,
  },
  custom: { scale: 1.5, fps: 30, bitrate: 3 },
  monitors: { list: [], current: null },
  stats: null,
  overlayInfo: '',
  uiHidden: false,
  panelOpen: false,
  statsOpen: false,
  fullscreen: false,
  captured: false,
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  const snapshot = { ...state };
  listeners.forEach((fn) => fn(snapshot));
}

// ---------------- Başlangıç ----------------

export async function init(videoEl) {
  video = videoEl;
  video.addEventListener('click', () => startCapture());

  const data = await window.clientAPI.getInitData();
  hwid = data.hwid;
  deviceName = data.deviceName;
  state.savedConnections = data.savedConnections || [];
  state.prefs = await window.clientAPI.getPrefs();
  emit();
}

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function setConnectStatus(msg, isErr) {
  state.connectStatus = { msg: msg || '', isErr: !!isErr };
  emit();
}

// ---------------- Bağlantı ----------------

export async function connect({ url, code, password }) {
  if (!url || !code) {
    setConnectStatus('Sunucu adresi ve kod gerekli.', true);
    return;
  }

  closeConnection(); // önceki denemeden kalan soket/peer varsa temizle

  state.connecting = true;
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
        state.savedConnections =
          await window.clientAPI.saveConnection({ signalingUrl: url, code, label: code });
        emit();
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
  ws.onclose = () => { state.connecting = false; emit(); };
}

// Host bu cihazı tanımıyorsa parola isteniyor demektir — arayüz bunu görüp
// parola alanına odaklanıyor.
function handleJoinError(message) {
  setConnectStatus(message, true);
  state.connecting = false;
  state.needsPassword = /parola/i.test(message || '');
  showConnectView();
}

// Peer connection, host'un offer'ı ile birlikte gönderdiği ICE sunucu listesi
// kullanılarak kurulur; TURN ayarı sadece host'ta tutulur.
function ensurePeerConnection(iceServers, transportPolicy) {
  if (pc) return;

  pc = new RTCPeerConnection({
    iceServers: iceServers && iceServers.length ? iceServers : DEFAULT_ICE,
    iceTransportPolicy: transportPolicy === 'relay' ? 'relay' : 'all',
  });

  pc.onicecandidate = (ev) => { if (ev.candidate) sendSignal({ candidate: ev.candidate }); };

  pc.onconnectionstatechange = () => {
    if (!pc) return;
    if (pc.connectionState === 'connected') {
      state.overlayInfo = 'Bağlantı kuruldu'; emit();
    } else if (['disconnected', 'failed'].includes(pc.connectionState)) {
      releaseAllInputs();
      state.overlayInfo = 'Bağlantı sorunu: ' + pc.connectionState; emit();
    }
  };

  pc.ontrack = (ev) => {
    video.srcObject = ev.streams[0];
    video.play().catch(() => { /* otomatik oynatma engellenirse kullanıcı tıklayınca başlar */ });
    showStage();
    applyModeLocally(state.prefs.mode); // playoutDelayHint için receiver artık hazır
  };

  pc.ondatachannel = (ev) => {
    if (ev.channel.label === 'mouse') mouseDc = ev.channel;
    else if (ev.channel.label === 'keys') keysDc = ev.channel;
    else if (ev.channel.label === 'control') {
      controlDc = ev.channel;
      controlDc.onmessage = (m) => handleControlMessage(safeParse(m.data));
      controlDc.onopen = () => {
        sendCurrentSettings(); // bağlanınca varsayılan mod/kalite host'a bildirilir
        sendControl({ t: 'get-sources' });
        startClipboardSync();
      };
    }
  };
}

function safeParse(raw) { try { return JSON.parse(raw); } catch { return null; } }

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
    // Aday offer'dan önce gelmiş olabilir; peer hazır olana kadar kuyrukta bekletilir.
    if (!pc || !remoteDescriptionSet) { pendingCandidates.push(payload.candidate); return; }
    try { await pc.addIceCandidate(payload.candidate); } catch (e) { console.error(e); }
  }
}

async function flushPendingCandidates() {
  if (!pc) return;
  const queued = pendingCandidates;
  pendingCandidates = [];
  for (const c of queued) {
    try { await pc.addIceCandidate(c); } catch (e) { console.error(e); }
  }
}

// ---------------- Görünüm ----------------

function showStage() {
  state.view = 'stage';
  emit();
  startStats();
}

export function showConnectView() {
  state.view = 'connect';
  state.panelOpen = false;
  state.connecting = false;
  emit();
  exitFullscreen();
  closeConnection();
}

export function closeConnection() {
  stopStats();
  stopClipboardSync();
  releaseAllInputs();
  stopCapture();
  clearTimeout(uiHideTimer);
  setUiHidden(false);
  if (mouseDc) { mouseDc.close(); mouseDc = null; }
  if (keysDc) { keysDc.close(); keysDc = null; }
  if (controlDc) { controlDc.close(); controlDc = null; }
  if (pc) { pc.onconnectionstatechange = null; pc.close(); pc = null; }
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
  pendingCandidates = [];
  remoteDescriptionSet = false;
  state.stats = null;
  state.overlayInfo = '';
  if (video) video.srcObject = null;
  emit();
}

// ---------------- Yakalama (pointer + keyboard lock + tam ekran) ----------------

// Windows tuşu, Alt+Tab gibi tuşlar normalde işletim sistemince yakalanır ve
// uygulamaya ulaşmaz. Keyboard Lock bunları uygulamaya yönlendirir ama yalnızca
// tam ekranda çalışır — bu yüzden yakalama = tam ekran + pointer lock + keyboard lock.
export async function startCapture() {
  await enterFullscreen();
  try {
    if (navigator.keyboard && navigator.keyboard.lock) {
      await navigator.keyboard.lock();
      keyboardLockActive = true;
    }
  } catch { keyboardLockActive = false; }
  try { await video.requestPointerLock(); } catch { /* hızlı çıkışta sessizce geç */ }
}

function stopCapture() {
  if (document.pointerLockElement) document.exitPointerLock();
  if (keyboardLockActive && navigator.keyboard && navigator.keyboard.unlock) {
    try { navigator.keyboard.unlock(); } catch { /* yoksay */ }
    keyboardLockActive = false;
  }
  physicallyDown.clear();
  showUi();
}

function isReleaseHotkeyPressed() {
  const hk = RELEASE_HOTKEYS[state.prefs.releaseHotkey];
  if (!hk || !hk.keys.length) return false;
  return hk.keys.every((k) => physicallyDown.has(k));
}

// ---------------- Girdi yakalama (React'in dışında, doğrudan document) ----------------

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== video) return;
  if (e.movementX || e.movementY) sendMouse({ t: 'm', dx: e.movementX, dy: e.movementY });
});

const btnName = (n) => (n === 0 ? 'left' : n === 1 ? 'middle' : n === 2 ? 'right' : null);

document.addEventListener('mousedown', (e) => {
  if (document.pointerLockElement !== video) return;
  // Fare tuşu çıkış kısayolu olarak seçilmişse host'a gönderilmez.
  const hk = RELEASE_HOTKEYS[state.prefs.releaseHotkey];
  if (hk && hk.mouseButton != null && e.button === hk.mouseButton) {
    e.preventDefault(); releaseAllInputs(); stopCapture(); return;
  }
  const b = btnName(e.button);
  if (!b) return;
  pressedButtons.add(b);
  sendMouse({ t: 'b', btn: b, down: true });
});

document.addEventListener('mouseup', (e) => {
  if (document.pointerLockElement !== video) return;
  const b = btnName(e.button);
  if (!b) return;
  pressedButtons.delete(b);
  sendMouse({ t: 'b', btn: b, down: false });
});

document.addEventListener('contextmenu', (e) => {
  if (document.pointerLockElement === video) e.preventDefault();
});

document.addEventListener('wheel', (e) => {
  if (document.pointerLockElement !== video) return;
  if (e.deltaY) sendMouse({ t: 'w', delta: -Math.sign(e.deltaY) * 120 });
  if (e.deltaX) sendMouse({ t: 'w', delta: Math.sign(e.deltaX) * 120, h: true });
}, { passive: true });

document.addEventListener('keydown', (e) => {
  const captured = document.pointerLockElement === video;
  if (!captured) {
    if (e.code === 'F11') { e.preventDefault(); toggleFullscreen(); }
    return;
  }
  physicallyDown.add(e.code);

  // Yakalamadan çıkış kısayolu: host'a gönderilmez, yerel olarak kilidi açar.
  if (isReleaseHotkeyPressed()) {
    e.preventDefault(); releaseAllInputs(); stopCapture(); return;
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

// Fare kilidi bırakıldığında ya da odak kaybedildiğinde basılı olan her şeyi
// host'ta serbest bırak; aksi halde örneğin gaz tuşu basılı takılır.
document.addEventListener('pointerlockchange', () => {
  const captured = document.pointerLockElement === video;
  state.captured = captured;
  if (captured) {
    // "Tamamen gizle" seçiliyse anında, değilse 5sn sonra gizle.
    if (state.prefs.hideUiCompletely) setUiHidden(true);
    else scheduleUiHide();
  } else {
    releaseAllInputs();
    physicallyDown.clear();
    showUi();          // yakalama bırakıldı: arayüz her zaman geri gelsin
    scheduleUiHide();  // ama hareketsiz kalırsa yine 5sn sonra gizlensin
  }
  emit();
});

window.addEventListener('blur', releaseAllInputs);
window.addEventListener('beforeunload', closeConnection);

function releaseAllInputs() {
  for (const [, m] of pressedKeys) sendKey({ t: 'k', scan: m[0], ext: m[1], down: false });
  pressedKeys.clear();
  for (const b of pressedButtons) sendMouse({ t: 'b', btn: b, down: false });
  pressedButtons.clear();
  // Host köprüsüne de "her şeyi bırak" de: tek tek gönderdiklerimiz yolda
  // kaybolsa bile orada basılı hiçbir şey kalmaz.
  sendKey({ t: 'r' });
}

function sendMouse(o) { if (mouseDc && mouseDc.readyState === 'open') mouseDc.send(JSON.stringify(o)); }
function sendKey(o) { if (keysDc && keysDc.readyState === 'open') keysDc.send(JSON.stringify(o)); }
function sendControl(o) { if (controlDc && controlDc.readyState === 'open') controlDc.send(JSON.stringify(o)); }

// ---------------- Arayüzün otomatik gizlenmesi ----------------

// ÖNEMLİ: "Butonları tamamen gizle" yalnızca YAKALAMA sırasında geçerlidir.
// Yakalama bırakıldığında arayüz her zaman geri gelir; aksi halde üst çubuğa
// (ve Bağlantıyı Kes'e) bir daha tıklanamıyordu.
function setUiHidden(v) {
  if (state.uiHidden === v) return; // yalnızca gerçek değişimde render tetikle
  state.uiHidden = v;
  emit();
}
function showUi() { setUiHidden(false); }

function scheduleUiHide() {
  clearTimeout(uiHideTimer);
  if (!state.prefs.autoHideUi) return;
  uiHideTimer = setTimeout(() => {
    // Ayarlar paneli açıkken gizleme, kullanıcı orayla uğraşıyor olabilir.
    if (state.panelOpen) { scheduleUiHide(); return; }
    setUiHidden(true);
  }, 5000);
}

// Fare hareket ederse (yakalama yokken) arayüzü geri getir. setUiHidden zaten
// değişim yoksa render tetiklemiyor, bu yüzden mousemove ucuz kalıyor.
document.addEventListener('mousemove', () => {
  if (document.pointerLockElement === video) return;
  showUi();
  scheduleUiHide();
});

// ---------------- Tam ekran (tek mekanizma: DOM Fullscreen API) ----------------

async function enterFullscreen() {
  if (document.fullscreenElement) return;
  try { await document.documentElement.requestFullscreen(); } catch { /* yoksay */ }
}
async function exitFullscreen() {
  if (!document.fullscreenElement) return;
  try { await document.exitFullscreen(); } catch { /* yoksay */ }
}
export function toggleFullscreen() {
  if (document.fullscreenElement) exitFullscreen(); else enterFullscreen();
}
document.addEventListener('fullscreenchange', () => {
  state.fullscreen = !!document.fullscreenElement;
  emit();
});

// ---------------- Host'tan gelen kontrol mesajları ----------------

function handleControlMessage(msg) {
  if (!msg) return;
  switch (msg.t) {
    case 'sources':
      state.monitors = { list: msg.list || [], current: msg.current || null };
      emit();
      break;
    case 'clip': receiveClipboard(msg.text); break;
  }
}

export function setMonitor(id) {
  state.monitors = { ...state.monitors, current: id };
  emit();
  sendControl({ t: 'set-source', id });
}

// ---------------- Pano ----------------

function startClipboardSync() {
  stopClipboardSync();
  window.clientAPI.readClipboard().then((t) => { lastClipboardText = t || ''; });
  clipboardTimer = setInterval(async () => {
    if (!state.prefs.clipboardSync) return;
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
  if (!state.prefs.clipboardSync || typeof text !== 'string') return;
  if (text === lastClipboardText) return;
  lastClipboardText = text; // yankıyı önle
  window.clientAPI.writeClipboard(text);
}

// ---------------- İstatistikler ----------------

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

  let inbound = null, pair = null;
  report.forEach((s) => {
    if (s.type === 'inbound-rtp' && s.kind === 'video') inbound = s;
    if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated !== false) pair = s;
  });
  if (!inbound) return;

  const now = inbound.timestamp;
  let mbps = 0, lossPct = 0;
  if (lastStatsSample && now > lastStatsSample.timestamp) {
    const seconds = (now - lastStatsSample.timestamp) / 1000;
    mbps = ((inbound.bytesReceived - lastStatsSample.bytesReceived) * 8) / seconds / 1e6;
    const lost = (inbound.packetsLost || 0) - (lastStatsSample.packetsLost || 0);
    const recv = (inbound.packetsReceived || 0) - (lastStatsSample.packetsReceived || 0);
    if (lost + recv > 0) lossPct = (lost / (lost + recv)) * 100;
  }
  lastStatsSample = {
    timestamp: now, bytesReceived: inbound.bytesReceived,
    packetsLost: inbound.packetsLost, packetsReceived: inbound.packetsReceived,
  };

  const rttMs = pair && pair.currentRoundTripTime != null
    ? Math.round(pair.currentRoundTripTime * 1000) : null;
  const fps = inbound.framesPerSecond != null ? Math.round(inbound.framesPerSecond) : null;

  state.stats = {
    resolution: inbound.frameWidth ? `${inbound.frameWidth}×${inbound.frameHeight}` : '-',
    fps: fps != null ? fps : '-',
    mbps: mbps.toFixed(2),
    rtt: rttMs != null ? rttMs + ' ms' : '-',
    loss: lossPct.toFixed(1) + ' %',
    jitter: inbound.jitter != null ? Math.round(inbound.jitter * 1000) + ' ms' : '-',
  };
  state.overlayInfo =
    `${fps != null ? fps : '-'} fps · ${mbps.toFixed(1)} Mbps${rttMs != null ? ' · ' + rttMs + ' ms' : ''}`;
  emit();
}

// ---------------- Mod / kalite ----------------

function applyModeLocally(mode) {
  if (!pc) return;
  const receiver = pc.getReceivers().find((r) => r.track && r.track.kind === 'video');
  if (!receiver) return;
  try { receiver.playoutDelayHint = MODE_PRESETS[mode].playoutDelayHint; }
  catch { /* tarayıcı desteklemiyorsa sessizce geç */ }
}

function getQualityValues() {
  if (state.prefs.quality === 'custom') {
    return {
      scaleResolutionDownBy: Number(state.custom.scale) || 1,
      maxFramerate: parseInt(state.custom.fps, 10) || 30,
      maxBitrate: Math.round((Number(state.custom.bitrate) || 3) * 1_000_000),
    };
  }
  return QUALITY_PRESETS[state.prefs.quality];
}

export function sendCurrentSettings() {
  const q = getQualityValues();
  const m = MODE_PRESETS[state.prefs.mode];
  sendControl({
    t: 'settings',
    scaleResolutionDownBy: q.scaleResolutionDownBy,
    maxFramerate: q.maxFramerate,
    maxBitrate: q.maxBitrate,
    degradationPreference: m.degradationPreference,
  });
}

async function savePrefs(partial) {
  state.prefs = await window.clientAPI.savePrefs(partial);
  emit();
}

export async function setQuality(quality, send = true) {
  await savePrefs({ quality });
  if (send && quality !== 'custom') sendCurrentSettings();
}

export async function setMode(mode) {
  await savePrefs({ mode });
  applyModeLocally(mode);
  // Mod, kendi önerdiği kalite profilini de getirir.
  const suggested = MODE_PRESETS[mode].quality;
  if (suggested && state.prefs.quality !== 'custom') await setQuality(suggested, false);
  sendCurrentSettings();
}

export function setCustom(patch) {
  state.custom = { ...state.custom, ...patch };
  emit();
}

export const setReleaseHotkey = (releaseHotkey) => savePrefs({ releaseHotkey });
export const setAutoHideUi = (autoHideUi) => savePrefs({ autoHideUi }).then(() => {
  if (autoHideUi) scheduleUiHide(); else { clearTimeout(uiHideTimer); showUi(); }
});
export const setHideUiCompletely = (hideUiCompletely) =>
  // Ayar yakalama sırasında etkili; kutucuğa tıklarken yakalama zaten yok,
  // o yüzden arayüz açık kalsın ki kullanıcı seçimini geri alabilsin.
  savePrefs({ hideUiCompletely }).then(showUi);
export const setMinimizeToTray = (minimizeToTray) => savePrefs({ minimizeToTray });
export const setClipboardSync = (clipboardSync) => savePrefs({ clipboardSync }).then(() => {
  if (clipboardSync) startClipboardSync(); else stopClipboardSync();
});

export function setPanelOpen(open) { state.panelOpen = open; emit(); }
export function setStatsOpen(open) { state.statsOpen = open; emit(); }

export async function removeConnection(id) {
  state.savedConnections = await window.clientAPI.removeConnection(id);
  emit();
}
