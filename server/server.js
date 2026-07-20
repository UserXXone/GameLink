// GameLink - Sinyalleşme Sunucusu
// Bu sunucu SADECE eşleştirme (SDP/ICE değişimi) yapar.
// Görüntü (video) verisi buradan geçmez, host<->client arasında doğrudan (P2P) akar.

const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const CLIENT_DIR = path.join(__dirname, '..', 'client');

// ---- Basit statik dosya sunucusu (client/index.html'i servis eder) ----
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(CLIENT_DIR, path.normalize(filePath).replace(/^(\.\.[\/\\])+/, ''));

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });

// code -> { hostWs, passwordHash, clientWs }
const rooms = new Map();

// Basit kaba kuvvet (brute-force) koruması
const attempts = new Map(); // ip -> { count, blockedUntil }
const MAX_ATTEMPTS = 5;
const BLOCK_MS = 60_000;

function isBlocked(ip) {
  const a = attempts.get(ip);
  return !!(a && a.blockedUntil && Date.now() < a.blockedUntil);
}

function registerFail(ip) {
  const a = attempts.get(ip) || { count: 0, blockedUntil: 0 };
  a.count += 1;
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

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  ws.on('message', (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return; // geçersiz JSON'u sessizce yoksay
    }

    switch (data.type) {
      case 'host-register': {
        const { code, passwordHash } = data;
        if (!code || !passwordHash) return;
        const existing = rooms.get(code);
        if (existing && existing.hostWs && existing.hostWs.readyState === WebSocket.OPEN) {
          send(ws, { type: 'error', message: 'Bu kod zaten kullanımda.' });
          return;
        }
        rooms.set(code, { hostWs: ws, passwordHash, clientWs: null });
        ws.role = 'host';
        ws.code = code;
        console.log(`[HOST] kayıt oldu: ${code}`);
        send(ws, { type: 'registered' });
        break;
      }

      case 'client-join': {
        if (isBlocked(ip)) {
          send(ws, { type: 'error', message: 'Çok fazla hatalı deneme. Biraz bekleyin.' });
          return;
        }
        const { code, passwordHash } = data;
        const room = rooms.get(code);
        if (!room || !room.hostWs || room.hostWs.readyState !== WebSocket.OPEN) {
          registerFail(ip);
          send(ws, { type: 'error', message: 'Kod bulunamadı ya da host çevrimdışı.' });
          return;
        }
        if (room.passwordHash !== passwordHash) {
          registerFail(ip);
          send(ws, { type: 'error', message: 'Parola hatalı.' });
          return;
        }
        if (room.clientWs && room.clientWs.readyState === WebSocket.OPEN) {
          send(ws, { type: 'error', message: 'Bu host zaten başka bir client ile bağlı.' });
          return;
        }
        registerSuccess(ip);
        room.clientWs = ws;
        ws.role = 'client';
        ws.code = code;
        console.log(`[CLIENT] bağlandı: ${code}`);
        send(ws, { type: 'joined' });
        send(room.hostWs, { type: 'client-joined' });
        break;
      }

      case 'signal': {
        const room = rooms.get(ws.code);
        if (!room) return;
        const target = ws.role === 'host' ? room.clientWs : room.hostWs;
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
      send(room.clientWs, { type: 'host-left' });
      rooms.delete(ws.code);
      console.log(`[HOST] ayrıldı: ${ws.code}`);
    } else if (ws.role === 'client') {
      room.clientWs = null;
      send(room.hostWs, { type: 'client-left' });
      console.log(`[CLIENT] ayrıldı: ${ws.code}`);
    }
  });
});

// Ölü bağlantıları periyodik temizle (30 sn)
const keepAliveInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => clearInterval(keepAliveInterval));

server.listen(PORT, () => {
  console.log(`GameLink sinyalleşme sunucusu ${PORT} portunda çalışıyor`);
});
