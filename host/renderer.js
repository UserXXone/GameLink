let ws, pc, dc, config;
let reconnectTimer;

async function main() {
  config = await window.hostAPI.getConfig();
  connect();
}

function connect() {
  ws = new WebSocket(config.signalingUrl);

  ws.onopen = () => {
    log('Sinyal sunucusuna bağlandı, kayıt yapılıyor...');
    ws.send(JSON.stringify({ type: 'host-register', code: config.code, passwordHash: config.passwordHash }));
  };

  ws.onmessage = async (ev) => {
    const data = JSON.parse(ev.data);
    switch (data.type) {
      case 'registered':
        log(`Hazır. Kod: ${config.code} — bağlantı bekleniyor.`);
        break;
      case 'error':
        log('Hata: ' + data.message);
        break;
      case 'client-joined':
        log('Client bağlandı, WebRTC kuruluyor...');
        await startPeerConnection();
        break;
      case 'client-left':
        log('Client ayrıldı, bekleniyor...');
        closePeerConnection();
        break;
      case 'signal':
        await handleSignal(data.payload);
        break;
    }
  };

  ws.onclose = () => {
    log('Sinyal sunucusu bağlantısı kesildi, 3sn sonra tekrar denenecek...');
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 3000);
  };

  ws.onerror = () => ws.close();
}

function sendSignal(payload) {
  ws.send(JSON.stringify({ type: 'signal', payload }));
}

async function startPeerConnection() {
  closePeerConnection();

  pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  });

  pc.onicecandidate = (ev) => { if (ev.candidate) sendSignal({ candidate: ev.candidate }); };
  pc.onconnectionstatechange = () => log('Bağlantı durumu: ' + pc.connectionState);

  dc = pc.createDataChannel('input', { ordered: false, maxRetransmits: 0 });
  setupDataChannel();

  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 60, max: 60 } },
    audio: false,
  });
  stream.getTracks().forEach((track) => pc.addTrack(track, stream));

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  sendSignal({ sdp: offer });

  const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
  if (sender) {
    const params = sender.getParameters();
    if (!params.encodings) params.encodings = [{}];
    params.encodings[0].maxBitrate = 8_000_000;
    params.degradationPreference = 'maintain-framerate';
    try { await sender.setParameters(params); } catch (e) { console.error(e); }
  }
}

function setupDataChannel() {
  dc.onopen = () => log('Veri kanalı açık, girişler dinleniyor.');
  dc.onmessage = (ev) => {
    let cmd;
    try { cmd = JSON.parse(ev.data); } catch { return; }
    switch (cmd.t) {
      case 'm': window.hostAPI.injectMouseMove(cmd.dx, cmd.dy); break;
      case 'b': window.hostAPI.injectMouseButton(cmd.btn, cmd.down); break;
      case 'w': window.hostAPI.injectWheel(cmd.delta); break;
      case 'k': window.hostAPI.injectKey(cmd.scan, cmd.ext, cmd.down); break;
    }
  };
}

async function handleSignal(payload) {
  if (payload.sdp) {
    await pc.setRemoteDescription(payload.sdp);
  } else if (payload.candidate) {
    try { await pc.addIceCandidate(payload.candidate); } catch (e) { console.error(e); }
  }
}

function closePeerConnection() {
  if (dc) { dc.close(); dc = null; }
  if (pc) { pc.close(); pc = null; }
}

function log(msg) {
  console.log(msg);
  window.hostAPI.setStatus(msg);
}

main();
