// GameLink - Sinyalleşme Sunucusu v2
// Parola/HWID doğrulaması artık HOST tarafında yapılıyor (güvenilir cihaz listesi
// host'un kendi config.json'unda tutuluyor). Bu sunucu sadece:
//   1) host<->client eşleştirmesini (oda kodu ile)
//   2) join isteklerinin host'a iletilmesini / host'un kabul-red kararının client'a iletilmesini
//   3) kabul edilen çiftler arasında SDP/ICE (signal) aktarımını
// yapar. Video verisi buradan hiç geçmez (P2P).

const http = require('http');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const JOIN_TIMEOUT_MS = Number(process.env.JOIN_TIMEOUT_MS) || 12_000;

// v2'de client artık bir Electron programı; sunucunun statik dosya sunmasına gerek yok.
// Geriye kalan tek HTTP ucu, nginx/uptime kontrolü için basit bir sağlık kontrolü.
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, uptime: Math.round(process.uptime()) }));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('GameLink signaling server');
});

const wss = new WebSocket.Server({ server });

// code -> { hostWs, pending: Map(clientId -> {ws, ip, timeout}), activeClientWs, activeClientId }
const rooms = new Map();

// Kaba kuvvet / spam koruması (host'un reddettiği veya zaman aşımına uğrayan denemeler dahil)
const attempts = new Map(); // ip -> { count, blockedUntil }
const MAX_ATTEMPTS = 5;
const BLOCK_MS = 60_000;

const ATTEMPT_TTL_MS = 15 * 60_000;

function isBlocked(ip) {
  const a = attempts.get(ip);
  return !!(a && a.blockedUntil && Date.now() < a.blockedUntil);
}
function registerFail(ip) {
  const a = attempts.get(ip) || { count: 0, blockedUntil: 0 };
  a.count += 1;
  a.updatedAt = Date.now();
  if (a.count >= MAX_ATTEMPTS) {
    a.blockedUntil = Date.now() + BLOCK_MS;
    a.count = 0;
  }
  attempts.set(ip, a);
}
function registerSuccess(ip) {
  attempts.delete(ip);
}
function send(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}
function genId() {
  return crypto.randomBytes(8).toString('hex');
}

function isLoopback(addr) {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

// Sunucu nginx'in arkasında çalıştığı için soketin adresi hep 127.0.0.1'dir; bu
// haliyle bir cihazın 5 hatalı denemesi HERKESİ bloklardı. Bağlantı gerçekten
// loopback'ten geliyorsa (yani önünde ters vekil varsa) nginx'in eklediği
// X-Real-IP / X-Forwarded-For başlığına güveniyoruz. Dışarıdan doğrudan gelen
// bağlantılarda başlık yok sayılır, sahte IP ile blok atlatılamaz.
function clientIp(req) {
  const socketAddr = req.socket.remoteAddress;
  if (!isLoopback(socketAddr)) return socketAddr;
  const realIp = req.headers['x-real-ip'];
  if (realIp) return realIp.trim();
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return socketAddr;
}

wss.on('connection', (ws, req) => {
  const ip = clientIp(req);
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  ws.on('message', (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    switch (data.type) {
      // ---- Host kendini bir koda kaydeder ----
      case 'host-register': {
        const { code } = data;
        if (!code) return;
        const existing = rooms.get(code);
        if (existing && existing.hostWs && existing.hostWs.readyState === WebSocket.OPEN) {
          send(ws, { type: 'error', message: 'Bu kod zaten kullanımda.' });
          return;
        }
        rooms.set(code, { hostWs: ws, pending: new Map(), activeClientWs: null, activeClientId: null });
        ws.role = 'host';
        ws.code = code;
        console.log(`[HOST] kayıt oldu: ${code}`);
        send(ws, { type: 'registered' });
        break;
      }

      // ---- Client bir koda bağlanmak ister; host'a onay için iletilir ----
      case 'client-join': {
        if (isBlocked(ip)) {
          send(ws, { type: 'error', message: 'Çok fazla hatalı deneme. Biraz bekleyin.' });
          return;
        }
        const { code, hwid, deviceName, passwordHash } = data;
        const room = rooms.get(code);
        if (!room || !room.hostWs || room.hostWs.readyState !== WebSocket.OPEN) {
          registerFail(ip);
          send(ws, { type: 'error', message: 'Kod bulunamadı ya da host çevrimdışı.' });
          return;
        }

        const clientId = genId();
        ws.role = 'client';
        ws.code = code;
        ws.clientId = clientId;

        const timeout = setTimeout(() => {
          if (room.pending.has(clientId)) {
            room.pending.delete(clientId);
            registerFail(ip);
            send(ws, { type: 'error', message: 'Host yanıt vermedi (zaman aşımı).' });
          }
        }, JOIN_TIMEOUT_MS);

        room.pending.set(clientId, { ws, ip, timeout });
        send(room.hostWs, {
          type: 'join-request',
          clientId,
          hwid: hwid || null,
          deviceName: deviceName || 'Bilinmeyen cihaz',
          passwordHash: passwordHash || null,
        });
        break;
      }

      // ---- Host, bekleyen bir isteği kabul/red eder ----
      case 'join-decision': {
        if (ws.role !== 'host') return;
        const room = rooms.get(ws.code);
        if (!room) return;
        const { clientId, accept, reason } = data;
        const pendingEntry = room.pending.get(clientId);
        if (!pendingEntry) return; // zaman aşımına uğramış ya da zaten işlenmiş

        clearTimeout(pendingEntry.timeout);
        room.pending.delete(clientId);

        if (!accept) {
          registerFail(pendingEntry.ip);
          send(pendingEntry.ws, { type: 'error', message: reason || 'Bağlantı reddedildi.' });
          return;
        }

        registerSuccess(pendingEntry.ip);

        if (room.activeClientWs && room.activeClientWs.readyState === WebSocket.OPEN) {
          send(room.activeClientWs, { type: 'error', message: 'Başka bir cihaz bağlandı.' });
        }

        room.activeClientWs = pendingEntry.ws;
        room.activeClientId = clientId;
        send(pendingEntry.ws, { type: 'joined' });
        console.log(`[CLIENT] eşleşti: ${ws.code} (${clientId})`);
        break;
      }

      // ---- SDP/ICE aktarımı (yalnızca aktif çift arasında) ----
      case 'signal': {
        const room = rooms.get(ws.code);
        if (!room) return;
        const target = ws.role === 'host' ? room.activeClientWs : room.hostWs;
        send(target, { type: 'signal', payload: data.payload });
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    if (!ws.code) return;
    const room = rooms.get(ws.code);
    if (!room) return;

    if (ws.role === 'host') {
      send(room.activeClientWs, { type: 'host-left' });
      for (const entry of room.pending.values()) {
        clearTimeout(entry.timeout);
        send(entry.ws, { type: 'error', message: 'Host bağlantıyı kapattı.' });
      }
      rooms.delete(ws.code);
      console.log(`[HOST] ayrıldı: ${ws.code}`);
    } else if (ws.role === 'client') {
      if (room.pending.has(ws.clientId)) {
        clearTimeout(room.pending.get(ws.clientId).timeout);
        room.pending.delete(ws.clientId);
      }
      if (room.activeClientWs === ws) {
        room.activeClientWs = null;
        room.activeClientId = null;
        send(room.hostWs, { type: 'client-left' });
      }
      console.log(`[CLIENT] ayrıldı: ${ws.code}`);
    }
  });
});

// Uzun süre çalışan sunucuda deneme kayıtları birikmesin.
const attemptSweepInterval = setInterval(() => {
  const now = Date.now();
  for (const [ip, a] of attempts) {
    const stale = (a.updatedAt || 0) + ATTEMPT_TTL_MS < now;
    const unblocked = !a.blockedUntil || a.blockedUntil < now;
    if (stale && unblocked) attempts.delete(ip);
  }
}, 5 * 60_000);

const keepAliveInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);
wss.on('close', () => {
  clearInterval(keepAliveInterval);
  clearInterval(attemptSweepInterval);
});

server.listen(PORT, () => {
  console.log(`GameLink sinyalleşme sunucusu ${PORT} portunda çalışıyor`);
});
