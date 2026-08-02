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
  F11:[0x57,false], F12:[0x58,false],
  ControlRight:[0x1D,true], AltRight:[0x38,true], NumpadEnter:[0x1C,true], NumpadDivide:[0x35,true],
  ArrowUp:[0x48,true], ArrowLeft:[0x4B,true], ArrowRight:[0x4D,true], ArrowDown:[0x50,true],
  Insert:[0x52,true], Delete:[0x53,true], Home:[0x47,true], End:[0x4F,true],
  PageUp:[0x49,true], PageDown:[0x51,true],
};

// ---- Kalite / mod tanımları ----
const QUALITY_PRESETS = {
  'data-saver': { scaleResolutionDownBy: 2,   maxFramerate: 30, maxBitrate: 1_500_000 },
  'balanced':   { scaleResolutionDownBy: 1.5, maxFramerate: 30, maxBitrate: 3_000_000 },
  'high':       { scaleResolutionDownBy: 1,   maxFramerate: 60, maxBitrate: 8_000_000 },
};
const MODE_PRESETS = {
  game:   { degradationPreference: 'maintain-framerate', playoutDelayHint: 0 },
  normal: { degradationPreference: 'maintain-resolution', playoutDelayHint: 0.1 },
  stream: { degradationPreference: 'balanced',            playoutDelayHint: 0.4 },
};

let ws, pc, mouseDc, keysDc, controlDc;
let hwid, deviceName;
let currentMode = 'game';
let currentQuality = 'balanced';

// ---------------- Başlangıç ----------------

async function init() {
  const data = await window.clientAPI.getInitData();
  hwid = data.hwid;
  deviceName = data.deviceName;
  renderConnList(data.savedConnections);
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
    item.innerHTML = `<div class="label">${escapeHtml(c.label)}</div>`;
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
        setupPeerConnection();
        await window.clientAPI.saveConnection({ signalingUrl: url, code, label: code });
        break;
      case 'error':
        setConnectStatus(data.message, true);
        $('connectBtn').disabled = false;
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

function setupPeerConnection() {
  pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  });

  pc.onicecandidate = (ev) => { if (ev.candidate) sendSignal({ candidate: ev.candidate }); };

  pc.ontrack = (ev) => {
    $('remoteVideo').srcObject = ev.streams[0];
    showStage();
    applyModeLocally(currentMode); // playoutDelayHint için receiver artık hazır
  };

  pc.ondatachannel = (ev) => {
    if (ev.channel.label === 'mouse') mouseDc = ev.channel;
    else if (ev.channel.label === 'keys') keysDc = ev.channel;
    else if (ev.channel.label === 'control') {
      controlDc = ev.channel;
      controlDc.onopen = () => sendCurrentSettings(); // bağlanınca varsayılan mod/kalite host'a bildirilir
    }
  };
}

function sendSignal(payload) {
  ws.send(JSON.stringify({ type: 'signal', payload }));
}

async function handleSignal(payload) {
  if (payload.sdp) {
    await pc.setRemoteDescription(payload.sdp);
    if (payload.sdp.type === 'offer') {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignal({ sdp: answer });
    }
  } else if (payload.candidate) {
    try { await pc.addIceCandidate(payload.candidate); } catch (e) { console.error(e); }
  }
}

// ---------------- Görünüm geçişleri ----------------

function showStage() {
  $('connectView').style.display = 'none';
  $('stageView').style.display = 'block';
}
function showConnectView() {
  $('stageView').style.display = 'none';
  $('connectView').style.display = 'flex';
  $('connectBtn').disabled = false;
  closeConnection();
}

$('disconnectBtn').addEventListener('click', () => {
  showConnectView();
});

function closeConnection() {
  if (mouseDc) { mouseDc.close(); mouseDc = null; }
  if (keysDc) { keysDc.close(); keysDc = null; }
  if (controlDc) { controlDc.close(); controlDc = null; }
  if (pc) { pc.close(); pc = null; }
  if (ws) { ws.close(); ws = null; }
}

// ---------------- Girdi yakalama (Pointer Lock ile RELATIVE fare) ----------------

const video = $('remoteVideo');
video.addEventListener('click', () => video.requestPointerLock());

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== video) return;
  if (e.movementX || e.movementY) sendMouse({ t: 'm', dx: e.movementX, dy: e.movementY });
});

const btnName = (n) => (n === 0 ? 'left' : n === 1 ? 'middle' : n === 2 ? 'right' : null);

document.addEventListener('mousedown', (e) => {
  if (document.pointerLockElement !== video) return;
  const b = btnName(e.button);
  if (b) sendMouse({ t: 'b', btn: b, down: true });
});
document.addEventListener('mouseup', (e) => {
  if (document.pointerLockElement !== video) return;
  const b = btnName(e.button);
  if (b) sendMouse({ t: 'b', btn: b, down: false });
});
document.addEventListener('contextmenu', (e) => {
  if (document.pointerLockElement === video) e.preventDefault();
});
document.addEventListener('wheel', (e) => {
  if (document.pointerLockElement !== video) return;
  sendMouse({ t: 'w', delta: -Math.sign(e.deltaY) * 120 });
}, { passive: true });

document.addEventListener('keydown', (e) => {
  if (document.pointerLockElement !== video) return;
  const m = KEYMAP[e.code];
  if (!m) return;
  e.preventDefault();
  sendKey({ t: 'k', scan: m[0], ext: m[1], down: true });
});
document.addEventListener('keyup', (e) => {
  if (document.pointerLockElement !== video) return;
  const m = KEYMAP[e.code];
  if (!m) return;
  e.preventDefault();
  sendKey({ t: 'k', scan: m[0], ext: m[1], down: false });
});

function sendMouse(obj) { if (mouseDc && mouseDc.readyState === 'open') mouseDc.send(JSON.stringify(obj)); }
function sendKey(obj) { if (keysDc && keysDc.readyState === 'open') keysDc.send(JSON.stringify(obj)); }
function sendControl(obj) { if (controlDc && controlDc.readyState === 'open') controlDc.send(JSON.stringify(obj)); }

// ---------------- Ayarlar paneli (Mod + Kalite) ----------------

$('settingsBtn').addEventListener('click', () => {
  $('settingsPanel').classList.toggle('open');
});

document.querySelectorAll('#modeSeg button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#modeSeg button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentMode = btn.dataset.mode;
    applyModeLocally(currentMode);
    sendCurrentSettings();
  });
});

document.querySelectorAll('#qualitySeg button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#qualitySeg button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentQuality = btn.dataset.quality;
    $('customControls').style.display = currentQuality === 'custom' ? 'block' : 'none';
    if (currentQuality !== 'custom') sendCurrentSettings();
  });
});

$('applyCustomBtn').addEventListener('click', () => sendCurrentSettings());

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
