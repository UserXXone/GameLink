// GameLink Host — mantık katmanı (DOM'dan bağımsız).
//
// WebRTC, sinyalleşme, veri kanalları, pano ve monitör mantığı burada durur;
// React yalnızca bu modülün yaydığı duruma abone olur ve eylemlerini çağırır.
// Ayrım bilinçli: girdi enjeksiyonu ve veri kanalı trafiği React'in yeniden
// render döngüsünden tamamen uzak kalsın diye.

const listeners = new Set();

let ws;
let pc;
let mouseDc, keysDc, controlDc;
let reconnectTimer;
let connectedDeviceName = null;
let captureStream = null;
let lastSettings = null;
let clipboardTimer = null;
let lastClipboardText = '';

export const state = {
  config: null,
  sources: [],
  currentSourceId: null,
  status: { text: 'Başlatılıyor...', kind: 'idle' }, // idle | waiting | connected
  logs: [],
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  const snapshot = { ...state };
  listeners.forEach((fn) => fn(snapshot));
}

function log(msg) {
  console.log(msg);
  const time = new Date().toLocaleTimeString('tr-TR');
  // Günlük sınırsız büyümesin; arayüz zaten son satırları gösteriyor.
  state.logs = [...state.logs, `[${time}] ${msg}`].slice(-300);
  emit();
}

// Tepsi menüsünde gösterilecek gerçek bağlantı durumu — her log satırı değil,
// yalnızca burada güncelleniyor.
function setStatus(text, kind) {
  state.status = { text, kind: kind || 'idle' };
  window.hostAPI.setStatus(text);
  emit();
}

function setConfig(cfg) {
  state.config = cfg;
  if (cfg && cfg.captureSourceId) state.currentSourceId = cfg.captureSourceId;
  emit();
}

// ---------------- Ekran kaynakları ----------------

async function refreshSources() {
  const sources = await window.hostAPI.listSources();
  state.sources = sources;
  const cfg = state.config;
  const wanted = cfg && cfg.captureSourceId;
  state.currentSourceId = wanted && sources.some((s) => s.id === wanted)
    ? wanted
    : (sources[0] && sources[0].id) || null;
  emit();
  return sources;
}

// ---------------- Başlangıç ----------------

export async function init() {
  setConfig(await window.hostAPI.getConfig());
  await refreshSources();
  connect();
}

// ---------------- Sinyalleşme ----------------

function connect() {
  const cfg = state.config;
  if (!cfg || !cfg.signalingUrl) return;
  clearTimeout(reconnectTimer);
  setStatus('Sunucuya bağlanılıyor...', 'waiting');
  ws = new WebSocket(cfg.signalingUrl);

  ws.onopen = () => {
    log('Sinyal sunucusuna bağlandı, kayıt yapılıyor...');
    ws.send(JSON.stringify({ type: 'host-register', code: state.config.hostCode }));
  };

  ws.onmessage = async (ev) => {
    const data = JSON.parse(ev.data);
    switch (data.type) {
      case 'registered':
        setStatus('Bekleniyor', 'waiting');
        log(`Hazır. Kod: ${state.config.hostCode}`);
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

// Açık bir soket varsa kapat: onclose zaten yeniden bağlanmayı tetikler. Böylece
// aynı anda iki soket açılıp sunucudan "Bu kod zaten kullanımda" hatası alınmaz.
function reconnectNow() {
  if (ws && ws.readyState !== WebSocket.CLOSED) ws.close();
  else connect();
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
  if (result.config) setConfig(result.config);

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

  const cfg = state.config;

  // "Sadece TURN" modunda iceTransportPolicy 'relay' olur: doğrudan (host/srflx)
  // adaylar hiç denenmez, tüm trafik röle üzerinden gider.
  pc = new RTCPeerConnection({
    iceServers: cfg.iceServers,
    iceTransportPolicy: cfg.iceTransportPolicy || 'all',
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
    if (state.config.clipboardSync) startClipboardSync();
  };

  captureStream = await captureScreen();
  captureStream.getTracks().forEach((track) => pc.addTrack(track, captureStream));

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  // ICE sunucu listesi ve transport politikası offer ile birlikte gider:
  // client TURN bilgisini ve seçilen bağlantı modunu host'tan öğrenir.
  sendSignal({
    sdp: offer,
    iceServers: cfg.iceServers,
    iceTransportPolicy: cfg.iceTransportPolicy || 'all',
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
  }
}

function handleControlMessage(msg) {
  if (!msg) return;
  switch (msg.t) {
    case 'settings': applySettings(msg); break;
    case 'get-sources': sendSources(); break;
    case 'set-source': setCaptureSource(msg.id); break;
    case 'clip': receiveClipboard(msg.text); break;
  }
}

function sendControl(obj) {
  if (controlDc && controlDc.readyState === 'open') controlDc.send(JSON.stringify(obj));
}

async function sendSources() {
  const sources = await refreshSources();
  sendControl({ t: 'sources', list: sources, current: state.currentSourceId });
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
    if (!state.config.clipboardSync) return;
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
  if (!state.config.clipboardSync || typeof text !== 'string') return;
  if (text === lastClipboardText) return;
  lastClipboardText = text; // kendi yazdığımızı geri göndermemek için
  window.hostAPI.writeClipboard(text);
  log('Pano client\'tan alındı.');
}

// ---------------- Temizlik ----------------

function closePeerConnection() {
  stopClipboardSync();
  window.hostAPI.releaseAllInputs();
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

// ---------------- Arayüzün çağırdığı eylemler ----------------

// Monitör değişimi: yeniden pazarlık (renegotiation) yapmadan, sadece gönderilen
// video track'i değiştirilir - görüntü kesilmez, ses akışı bozulmaz.
export async function setCaptureSource(sourceId) {
  if (!sourceId) return;
  setConfig(await window.hostAPI.setCaptureSource(sourceId));
  state.currentSourceId = sourceId;
  emit();

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

export async function regenerateCode() {
  const updated = await window.hostAPI.regenerateCode();
  setConfig(updated);
  log('Yeni kod üretildi: ' + updated.hostCode);
  reconnectNow(); // yeni kodla sunucuya yeniden kaydol
}

export async function savePassword(password) {
  if (!password) return;
  setConfig(await window.hostAPI.saveSettings({ password }));
}

export async function saveSignalingUrl(signalingUrl) {
  if (!signalingUrl) return;
  setConfig(await window.hostAPI.saveSettings({ signalingUrl }));
  reconnectNow();
}

export async function saveTurn(turn) {
  setConfig(await window.hostAPI.saveSettings({ turn }));
}

export async function setIceMode(iceMode) {
  const updated = await window.hostAPI.saveSettings({ iceMode });
  setConfig(updated);
  const labels = {
    'auto': 'Otomatik (STUN + TURN)',
    'stun-only': 'Sadece STUN',
    'turn-only': 'Sadece TURN (röle)',
  };
  log(`Bağlantı modu: ${labels[updated.iceMode]}. Sonraki bağlantıda geçerli olur.`);
}

export async function setClipboardSync(clipboardSync) {
  const updated = await window.hostAPI.saveSettings({ clipboardSync });
  setConfig(updated);
  if (!updated.clipboardSync) stopClipboardSync();
  else if (pc) startClipboardSync();
}

export async function setMinimizeToTray(minimizeToTray) {
  setConfig(await window.hostAPI.saveSettings({ minimizeToTray }));
}

export async function removeTrustedDevice(hwid, name) {
  setConfig(await window.hostAPI.removeTrustedDevice(hwid));
  log(`Güvenilir cihaz kaldırıldı: ${name}`);
}
