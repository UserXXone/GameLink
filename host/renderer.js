const $ = (id) => document.getElementById(id);

let ws;
let pc;
let mouseDc, keysDc, controlDc;
let config;
let reconnectTimer;
let connectedDeviceName = null;
let captureStream = null;
let lastSettings = null;
let clipboardTimer = null;
let lastClipboardText = '';

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
  $('turnUrlInput').value = cfg.turn.url || '';
  $('turnUserInput').value = cfg.turn.username || '';
  $('turnPassInput').value = cfg.turn.credential || '';
  $('clipboardToggle').checked = !!cfg.clipboardSync;
  $('trayToggle').checked = cfg.minimizeToTray !== false;
  $('iceModeSelect').value = cfg.iceMode || 'auto';
  updateIceModeWarning(cfg);
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

async function refreshSourceList() {
  const sources = await window.hostAPI.listSources();
  const select = $('sourceSelect');
  select.innerHTML = '';
  for (const s of sources) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name + (s.primary ? ' (birincil)' : '');
    select.appendChild(opt);
  }
  const current = config.captureSourceId && sources.some((s) => s.id === config.captureSourceId)
    ? config.captureSourceId
    : (sources[0] && sources[0].id);
  if (current) select.value = current;
  return sources;
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
  $('turnHint').textContent = updated.turn.url
    ? 'Kaydedildi. Bir sonraki bağlantıda geçerli olur.'
    : 'TURN kapatıldı (sadece STUN kullanılacak).';
  setTimeout(() => ($('turnHint').textContent = ''), 3500);
});

// TURN tanımlı değilken "sadece TURN" seçmek işe yaramaz; kullanıcıyı uyar.
function updateIceModeWarning(cfg) {
  const mode = cfg.iceMode || 'auto';
  const hasTurn = !!(cfg.turn && cfg.turn.url);
  const el = $('iceModeHint');
  if (mode === 'turn-only' && !hasTurn) {
    el.textContent = 'Uyarı: TURN sunucusu tanımlı değil, bu mod uygulanamaz.';
    el.style.color = '#ff9f6b';
  } else {
    el.textContent = '';
    el.style.color = '';
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

$('trayToggle').addEventListener('change', async () => {
  const updated = await window.hostAPI.saveSettings({ minimizeToTray: $('trayToggle').checked });
  await refreshConfigUI(updated);
});

$('clipboardToggle').addEventListener('change', async () => {
  const updated = await window.hostAPI.saveSettings({ clipboardSync: $('clipboardToggle').checked });
  await refreshConfigUI(updated);
  if (!updated.clipboardSync) stopClipboardSync();
  else if (pc) startClipboardSync();
});

$('sourceSelect').addEventListener('change', async () => {
  await switchSource($('sourceSelect').value);
});

// ---------------- Sinyalleşme ----------------

async function main() {
  const cfg = await window.hostAPI.getConfig();
  await refreshConfigUI(cfg);
  await refreshSourceList();
  connect();
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
  ws.send(JSON.stringify({ type: 'join-decision', clientId, accept: true }));

  try {
    await startPeerConnection();
  } catch (e) {
    log('Yayın başlatılamadı: ' + e.message);
    closePeerConnection();
  }
}

// ---------------- WebRTC ----------------

async function captureScreen() {
  return navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 60, max: 60 } },
    audio: true, // sistem sesi (loopback), main.js'te ayarlandı
  });
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
    } else if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
      // Bağlantı düştüğünde basılı kalan tuş/butonları serbest bırak.
      window.hostAPI.releaseAllInputs();
      setStatus('Bekleniyor', 'waiting');
    }
  };

  mouseDc = pc.createDataChannel('mouse', { ordered: false, maxRetransmits: 0 });
  keysDc = pc.createDataChannel('keys'); // güvenilir (ordered, retransmit) - tuş kaybı olmasın
  controlDc = pc.createDataChannel('control'); // güvenilir - mod/kalite/monitör/pano

  mouseDc.onmessage = (ev) => handleInputMessage(safeParse(ev.data));
  keysDc.onmessage = (ev) => handleInputMessage(safeParse(ev.data));
  keysDc.onclose = () => window.hostAPI.releaseAllInputs();
  controlDc.onmessage = (ev) => handleControlMessage(safeParse(ev.data));
  controlDc.onopen = () => {
    sendSources();
    if (config.clipboardSync) startClipboardSync();
  };

  captureStream = await captureScreen();
  captureStream.getTracks().forEach((track) => pc.addTrack(track, captureStream));

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  // ICE sunucu listesi offer ile birlikte gider: client, TURN bilgisini host'tan öğrenir.
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

function handleControlMessage(msg) {
  if (!msg) return;
  switch (msg.t) {
    case 'settings': applySettings(msg); break;
    case 'get-sources': sendSources(); break;
    case 'set-source': switchSource(msg.id); break;
    case 'clip': receiveClipboard(msg.text); break;
    case 'cursor-mode': setCursorMode(msg.mode); break;
  }
}

// Client hangi imleç modunda çalıştığını bildirir:
//   'single' -> klasik: host'un gerçek imleci client tarafından sürülür
//   'ghost'  -> ikinci imleç: gerçek imleç host kullanıcısında kalır
function setCursorMode(mode) {
  const ghost = mode === 'ghost';
  window.hostAPI.setGhostMode(ghost);
  $('cursorModeText').textContent = ghost
    ? 'İkinci imleç — kendi farenizi kullanmaya devam edebilirsiniz'
    : 'Tek imleç — uzaktaki kullanıcı fareyi sizinle paylaşıyor';
  log(ghost ? 'İkinci imleç modu açıldı.' : 'Tek imleç moduna geçildi.');
}

function sendControl(obj) {
  if (controlDc && controlDc.readyState === 'open') controlDc.send(JSON.stringify(obj));
}

async function sendSources() {
  const sources = await refreshSourceList();
  sendControl({ t: 'sources', list: sources, current: $('sourceSelect').value });
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

  let newStream;
  try {
    newStream = await captureScreen();
  } catch (e) {
    log('Monitör değiştirilemedi: ' + e.message);
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
  log('Monitör değiştirildi.');
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

// ---------------- Temizlik ----------------

function closePeerConnection() {
  stopClipboardSync();
  window.hostAPI.releaseAllInputs();
  // Bağlantı bitti: ikinci imleç katmanı kapansın, gerçek imleç host'a geri dönsün.
  window.hostAPI.setGhostMode(false);
  $('cursorModeText').textContent = 'Bağlantı yok';
  if (mouseDc) { mouseDc.close(); mouseDc = null; }
  if (keysDc) { keysDc.onclose = null; keysDc.close(); keysDc = null; }
  if (controlDc) { controlDc.close(); controlDc = null; }
  if (captureStream) {
    captureStream.getTracks().forEach((t) => t.stop());
    captureStream = null;
  }
  if (pc) { pc.onconnectionstatechange = null; pc.close(); pc = null; }
  lastSettings = null;
}

window.addEventListener('beforeunload', closePeerConnection);

main();
