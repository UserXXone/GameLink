const $ = (id) => document.getElementById(id);

let ws;
let pc;
let mouseDc, keysDc, controlDc;
let config;
let reconnectTimer;
let connectedDeviceName = null;

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
  const dot = $('statusDot');
  dot.className = 'dot' + (state ? ' ' + state : '');
}

// ---------------- GUI: config yükleme / render ----------------

async function refreshConfigUI(cfg) {
  config = cfg;
  $('codeDisplay').textContent = cfg.hostCode;
  $('urlInput').value = cfg.signalingUrl;
  $('passwordInput').placeholder = cfg.hasPassword ? '•••••••• (ayarlı)' : 'Henüz parola ayarlanmadı';
  renderDeviceList(cfg.trustedDevices);
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
      const updated = await window.hostAPI.removeTrustedDevice(d.hwid);
      refreshConfigUI(updated);
      log(`Güvenilir cihaz kaldırıldı: ${d.name}`);
    };
    item.appendChild(removeBtn);
    container.appendChild(item);
  }
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// ---------------- GUI: buton olayları ----------------

$('regenBtn').addEventListener('click', async () => {
  const updated = await window.hostAPI.regenerateCode();
  await refreshConfigUI(updated);
  log('Yeni kod üretildi: ' + updated.hostCode);
  connect(); // yeni kodla sunucuya yeniden kaydol
});

$('savePasswordBtn').addEventListener('click', async () => {
  const val = $('passwordInput').value;
  if (!val) return;
  const updated = await window.hostAPI.saveSettings({ password: val });
  $('passwordInput').value = '';
  await refreshConfigUI(updated);
  $('passwordHint').textContent = 'Kaydedildi.';
  setTimeout(() => ($('passwordHint').textContent = ''), 2000);
});

$('saveUrlBtn').addEventListener('click', async () => {
  const val = $('urlInput').value.trim();
  if (!val) return;
  const updated = await window.hostAPI.saveSettings({ signalingUrl: val });
  await refreshConfigUI(updated);
  $('urlHint').textContent = 'Kaydedildi, yeniden bağlanılıyor...';
  setTimeout(() => ($('urlHint').textContent = ''), 2500);
  if (ws) ws.close();
  connect();
});

// ---------------- Sinyalleşme ----------------

async function main() {
  const cfg = await window.hostAPI.getConfig();
  await refreshConfigUI(cfg);
  connect();
}

function connect() {
  if (!config.signalingUrl) return;
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
  ws.send(JSON.stringify({ type: 'signal', payload }));
}

async function handleJoinRequest(data) {
  const { clientId, hwid, deviceName, passwordHash } = data;
  log(`Bağlantı isteği: ${deviceName} (${hwid ? hwid.slice(0, 8) : 'hwid yok'})`);

  const result = await window.hostAPI.evaluateJoin(hwid, deviceName, passwordHash);
  if (result.config) refreshConfigUI(result.config);

  if (!result.accept) {
    log(`Reddedildi: ${deviceName} — ${result.reason}`);
    ws.send(JSON.stringify({ type: 'join-decision', clientId, accept: false, reason: result.reason }));
    return;
  }

  log(`Kabul edildi: ${deviceName}`);
  connectedDeviceName = deviceName;
  ws.send(JSON.stringify({ type: 'join-decision', clientId, accept: true }));
  await startPeerConnection();
}

// ---------------- WebRTC ----------------

async function startPeerConnection() {
  closePeerConnection();

  pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  });

  pc.onicecandidate = (ev) => { if (ev.candidate) sendSignal({ candidate: ev.candidate }); };
  pc.onconnectionstatechange = () => {
    log('Bağlantı durumu: ' + pc.connectionState);
    if (pc.connectionState === 'connected') {
      setStatus(`Bağlı: ${connectedDeviceName || ''}`, 'connected');
    } else if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
      setStatus('Bekleniyor', 'waiting');
    }
  };

  mouseDc = pc.createDataChannel('mouse', { ordered: false, maxRetransmits: 0 });
  keysDc = pc.createDataChannel('keys'); // güvenilir (ordered, retransmit) - tuş kaybı olmasın
  controlDc = pc.createDataChannel('control'); // güvenilir - mod/kalite ayarları

  mouseDc.onmessage = (ev) => handleInputMessage(safeParse(ev.data));
  keysDc.onmessage = (ev) => handleInputMessage(safeParse(ev.data));
  controlDc.onmessage = (ev) => handleControlMessage(safeParse(ev.data));

  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 30, max: 60 } },
    audio: true, // sistem sesi (loopback), main.js'te ayarlandı
  });
  stream.getTracks().forEach((track) => pc.addTrack(track, stream));

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  sendSignal({ sdp: offer });

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
    case 'w': window.hostAPI.injectWheel(cmd.delta); break;
    case 'k': window.hostAPI.injectKey(cmd.scan, cmd.ext, cmd.down); break;
  }
}

function handleControlMessage(msg) {
  if (!msg) return;
  if (msg.t === 'settings') applySettings(msg);
}

async function applySettings(s) {
  if (!pc) return;
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
  if (payload.sdp) {
    await pc.setRemoteDescription(payload.sdp);
  } else if (payload.candidate) {
    try { await pc.addIceCandidate(payload.candidate); } catch (e) { console.error(e); }
  }
}

function closePeerConnection() {
  if (mouseDc) { mouseDc.close(); mouseDc = null; }
  if (keysDc) { keysDc.close(); keysDc = null; }
  if (controlDc) { controlDc.close(); controlDc = null; }
  if (pc) { pc.close(); pc = null; }
}

main();
