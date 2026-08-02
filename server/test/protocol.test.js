// Sinyalleşme sunucusunun v2 protokol testleri.
// Çalıştırmak için: cd server && npm test
//
// Gerçek bir sunucu süreci başlatılır (rastgele port, kısa join zaman aşımı) ve
// gerçek WebSocket istemcileri ile konuşulur - mock yok.

const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const WebSocket = require('ws');

const PORT = 18099;
const BASE = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}`;
const JOIN_TIMEOUT_MS = 400;

let serverProcess;

function startServer() {
  return new Promise((resolve, reject) => {
    serverProcess = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
      env: { ...process.env, PORT: String(PORT), JOIN_TIMEOUT_MS: String(JOIN_TIMEOUT_MS) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => reject(new Error('sunucu zamanında başlamadı')), 8000);
    serverProcess.stdout.on('data', (d) => {
      if (d.toString().includes('portunda çalışıyor')) {
        clearTimeout(timer);
        resolve();
      }
    });
    serverProcess.on('error', reject);
  });
}

function open(url = WS_URL, headers) {
  const ws = new WebSocket(url, headers ? { headers } : undefined);
  ws.inbox = [];
  ws.waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    const waiter = ws.waiters.shift();
    if (waiter) waiter(msg);
    else ws.inbox.push(msg);
  });
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function next(ws, timeout = 2000) {
  if (ws.inbox.length) return Promise.resolve(ws.inbox.shift());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('mesaj beklenirken zaman aşımı')), timeout);
    ws.waiters.push((msg) => { clearTimeout(timer); resolve(msg); });
  });
}

function send(ws, obj) {
  ws.send(JSON.stringify(obj));
}

async function registerHost(code) {
  const host = await open();
  send(host, { type: 'host-register', code });
  const msg = await next(host);
  assert.strictEqual(msg.type, 'registered');
  return host;
}

test.before(startServer);
test.after(() => serverProcess && serverProcess.kill());

test('sağlık kontrolü ok döner', async () => {
  const res = await fetch(`${BASE}/health`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.ok, true);
  assert.strictEqual(typeof body.rooms, 'number');
});

test('host kaydolur, aynı kod ikinci kez alınamaz', async () => {
  const host = await registerHost('AAAA-0001');
  const other = await open();
  send(other, { type: 'host-register', code: 'AAAA-0001' });
  const msg = await next(other);
  assert.strictEqual(msg.type, 'error');
  assert.match(msg.message, /kullanımda/);
  host.close();
  other.close();
});

test('bilinmeyen koda bağlanma isteği reddedilir', async () => {
  const client = await open();
  send(client, { type: 'client-join', code: 'YOK-YOK', hwid: 'h1', deviceName: 'Test' });
  const msg = await next(client);
  assert.strictEqual(msg.type, 'error');
  assert.match(msg.message, /Kod bulunamadı/);
  client.close();
});

test('join isteği hosta iletilir ve kabul edilince client joined alır', async () => {
  const host = await registerHost('AAAA-0002');
  const client = await open();
  send(client, {
    type: 'client-join', code: 'AAAA-0002',
    hwid: 'hwid-abc', deviceName: 'Dizüstü', passwordHash: 'deadbeef',
  });

  const request = await next(host);
  assert.strictEqual(request.type, 'join-request');
  assert.strictEqual(request.hwid, 'hwid-abc');
  assert.strictEqual(request.deviceName, 'Dizüstü');
  assert.strictEqual(request.passwordHash, 'deadbeef');
  assert.ok(request.clientId);

  send(host, { type: 'join-decision', clientId: request.clientId, accept: true });
  const joined = await next(client);
  assert.strictEqual(joined.type, 'joined');

  host.close();
  client.close();
});

test('host reddederse client gerekçeyi alır', async () => {
  const host = await registerHost('AAAA-0003');
  const client = await open();
  send(client, { type: 'client-join', code: 'AAAA-0003', hwid: 'hwid-x', deviceName: 'Telefon' });

  const request = await next(host);
  send(host, {
    type: 'join-decision', clientId: request.clientId, accept: false, reason: 'Parola hatalı.',
  });

  const msg = await next(client);
  assert.strictEqual(msg.type, 'error');
  assert.strictEqual(msg.message, 'Parola hatalı.');

  host.close();
  client.close();
});

test('sinyal (SDP/ICE) her iki yönde aktarılır', async () => {
  const host = await registerHost('AAAA-0004');
  const client = await open();
  send(client, { type: 'client-join', code: 'AAAA-0004', hwid: 'hwid-1', deviceName: 'PC' });
  const request = await next(host);
  send(host, { type: 'join-decision', clientId: request.clientId, accept: true });
  await next(client); // joined

  // Host, offer'ı ICE sunucu listesiyle birlikte gönderiyor (TURN bilgisi host'ta tutulur).
  send(host, {
    type: 'signal',
    payload: { sdp: { type: 'offer', sdp: 'v=0' }, iceServers: [{ urls: 'turn:example.com' }] },
  });
  const offer = await next(client);
  assert.strictEqual(offer.type, 'signal');
  assert.strictEqual(offer.payload.sdp.type, 'offer');
  assert.deepStrictEqual(offer.payload.iceServers, [{ urls: 'turn:example.com' }]);

  send(client, { type: 'signal', payload: { candidate: { candidate: 'a=x' } } });
  const candidate = await next(host);
  assert.strictEqual(candidate.payload.candidate.candidate, 'a=x');

  host.close();
  client.close();
});

test('host yanıt vermezse istek zaman aşımına uğrar', async () => {
  const host = await registerHost('AAAA-0005');
  const client = await open();
  send(client, { type: 'client-join', code: 'AAAA-0005', hwid: 'hwid-2', deviceName: 'PC' });
  await next(host); // join-request - bilerek yanıtlanmıyor

  const msg = await next(client, JOIN_TIMEOUT_MS + 1500);
  assert.strictEqual(msg.type, 'error');
  assert.match(msg.message, /zaman aşımı/);

  host.close();
  client.close();
});

test('yeni client bağlanınca eski client bilgilendirilir', async () => {
  const host = await registerHost('AAAA-0006');

  const first = await open();
  send(first, { type: 'client-join', code: 'AAAA-0006', hwid: 'h-1', deviceName: 'İlk' });
  const req1 = await next(host);
  send(host, { type: 'join-decision', clientId: req1.clientId, accept: true });
  await next(first); // joined

  const second = await open();
  send(second, { type: 'client-join', code: 'AAAA-0006', hwid: 'h-2', deviceName: 'İkinci' });
  const req2 = await next(host);
  send(host, { type: 'join-decision', clientId: req2.clientId, accept: true });

  const notice = await next(first);
  assert.strictEqual(notice.type, 'error');
  assert.match(notice.message, /Başka bir cihaz/);
  assert.strictEqual((await next(second)).type, 'joined');

  host.close();
  first.close();
  second.close();
});

test('kaba kuvvet bloğu cihaz bazında uygulanır, diğer cihazları etkilemez', async () => {
  // Sunucu ters vekilin arkasında; kimlik X-Real-IP başlığından okunmalı.
  // Aksi halde bir cihazın hatalı denemeleri tüm kullanıcıları bloklardı.
  const attacker = { 'X-Real-IP': '203.0.113.10' };
  const innocent = { 'X-Real-IP': '203.0.113.99' };

  for (let i = 0; i < 5; i++) {
    const ws = await open(WS_URL, attacker);
    send(ws, { type: 'client-join', code: 'YOK-BOYLE', hwid: 'h', deviceName: 'Saldırgan' });
    const msg = await next(ws);
    assert.strictEqual(msg.type, 'error');
    ws.close();
  }

  const blocked = await open(WS_URL, attacker);
  send(blocked, { type: 'client-join', code: 'YOK-BOYLE', hwid: 'h', deviceName: 'Saldırgan' });
  assert.match((await next(blocked)).message, /Çok fazla hatalı deneme/);
  blocked.close();

  const other = await open(WS_URL, innocent);
  send(other, { type: 'client-join', code: 'YOK-BOYLE', hwid: 'h2', deviceName: 'Masum' });
  assert.match((await next(other)).message, /Kod bulunamadı/);
  other.close();
});

test('client ayrılınca host haber alır, host ayrılınca client haber alır', async () => {
  const host = await registerHost('AAAA-0007');
  const client = await open();
  send(client, { type: 'client-join', code: 'AAAA-0007', hwid: 'h-3', deviceName: 'PC' });
  const request = await next(host);
  send(host, { type: 'join-decision', clientId: request.clientId, accept: true });
  await next(client); // joined

  client.close();
  assert.strictEqual((await next(host)).type, 'client-left');

  const client2 = await open();
  send(client2, { type: 'client-join', code: 'AAAA-0007', hwid: 'h-4', deviceName: 'PC2' });
  const req2 = await next(host);
  send(host, { type: 'join-decision', clientId: req2.clientId, accept: true });
  await next(client2); // joined

  host.close();
  assert.strictEqual((await next(client2)).type, 'host-left');
  client2.close();
});
