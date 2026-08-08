// GameLink v4.0 — Dosya aktarım motoru
//
// Bu dosyanın BİREBİR AYNISI host/ ve client/ altında bulunur. İki program ayrı
// Electron uygulamaları olduğu ve paket dosya listesi kendi klasörlerini kapsadığı
// için ortak bir klasörden yüklenemiyor; bilinçli bir kopyadır. Birini
// değiştirirken diğerini de değiştirin.
//
// Taşıma: WebRTC'nin 'files' veri kanalı (sıralı + güvenilir). Aynı kanaldan hem
// JSON denetim satırları hem ikili parçalar geçer. Kanal sıralı olduğu için gelen
// ikili veri her zaman "karşı tarafın başlattığı, benim kabul ettiğim" aktarıma
// aittir — yönde aynı anda tek aktarım çalışır, gerisi kuyrukta bekler.
//
// Akış denetimi iki katmanlı:
//   1) Gönderen tarafta kanalın bufferedAmount'ı: SCTP tamponu şişerse duraklar.
//   2) Alıcı tarafta diske yazma gecikirse 'pause'/'resume' mesajı gönderilir;
//      aksi halde ağ diskten hızlıysa bellekte parça birikirdi.

(function () {
  'use strict';

  const CHUNK = 64 * 1024;             // SCTP'nin 256 KB'lık ileti sınırının altında
  const SEND_HIGH_WATER = 4 * 1024 * 1024;
  const SEND_LOW_WATER = 1 * 1024 * 1024;
  const RECV_HIGH_WATER = 8 * 1024 * 1024;  // diske yazılmayı bekleyen bayt
  const RECV_LOW_WATER = 2 * 1024 * 1024;

  function formatBytes(n) {
    if (!isFinite(n) || n < 0) return '-';
    if (n < 1024) return n + ' B';
    const units = ['KB', 'MB', 'GB', 'TB'];
    let v = n / 1024;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return (v < 10 ? v.toFixed(1) : Math.round(v)) + ' ' + units[i];
  }

  function formatRate(bytesPerSec) {
    return formatBytes(bytesPerSec) + '/sn';
  }

  // io: preload'un sunduğu dosya G/Ç adaptörü (host ve client'ta aynı isimler).
  // onEvent(type, record): 'list-changed' dışındaki tüm olaylar kaydı da taşır.
  // askAccept(record) -> Promise<boolean>: gelen dosya için karar. Verilmezse kabul.
  function create(options) {
    const io = options.io;
    const onEvent = options.onEvent || function () {};
    const askAccept = options.askAccept || null;

    let channel = null;
    // Aktarım kimlikleri iki taraf arasında çakışmasın diye tarafa özgü önek.
    const idPrefix = Math.random().toString(36).slice(2, 6);
    let idCounter = 0;

    const transfers = new Map();   // id -> kayıt (arayüz bunu listeler)
    const outQueue = [];
    let outActive = null;
    let inActive = null;

    let sendPaused = false;        // karşı taraf 'pause' dedi
    let pumping = false;
    let writeChain = Promise.resolve();
    let pendingWriteBytes = 0;
    let recvPauseSent = false;

    function nextId() {
      idCounter += 1;
      return idPrefix + '-' + idCounter;
    }

    function record(fields) {
      const rec = Object.assign({
        id: null, name: '', size: 0, dir: 'out', state: 'queued',
        moved: 0, startedAt: 0, rate: 0, path: null, error: null,
      }, fields);
      transfers.set(rec.id, rec);
      return rec;
    }

    function emit(type, rec) {
      try { onEvent(type, rec, list()); } catch (err) { console.error('[files]', err); }
    }

    function list() {
      return Array.from(transfers.values());
    }

    function isOpen() {
      return !!channel && channel.readyState === 'open';
    }

    function sendJson(obj) {
      if (isOpen()) channel.send(JSON.stringify(obj));
    }

    function updateRate(rec) {
      const seconds = (Date.now() - rec.startedAt) / 1000;
      rec.rate = seconds > 0.2 ? rec.moved / seconds : 0;
    }

    // ---------------- Kanal ----------------

    function attach(dc) {
      channel = dc;
      channel.binaryType = 'arraybuffer';
      channel.bufferedAmountLowThreshold = SEND_LOW_WATER;
      channel.onbufferedamountlow = () => { pump(); };
      channel.onmessage = (ev) => handleMessage(ev.data);
      channel.onclose = () => abortAll('Bağlantı kapandı.');
      pump();
    }

    function detach() {
      abortAll('Bağlantı kapandı.');
      channel = null;
    }

    function abortAll(reason) {
      if (outActive) {
        if (outActive.readHandle != null) io.closeRead(outActive.readHandle);
        failRecord(outActive.rec, reason);
        outActive = null;
      }
      while (outQueue.length) failRecord(outQueue.shift().rec, reason);
      if (inActive) {
        io.abortWrite(inActive.writeHandle);
        failRecord(inActive.rec, reason);
        inActive = null;
      }
      pendingWriteBytes = 0;
      recvPauseSent = false;
      sendPaused = false;
    }

    function failRecord(rec, reason) {
      if (!rec || rec.state === 'done') return;
      rec.state = 'error';
      rec.error = reason;
      emit('error', rec);
    }

    // ---------------- Gönderme ----------------

    // entries: [{path,name,size}] (dosya seçiciden) veya FileList/[File] (sürükle-bırak).
    function sendFiles(entries) {
      const items = Array.from(entries || []);
      for (const item of items) {
        const isDom = typeof File !== 'undefined' && item instanceof File;
        // Electron 31'de sürüklenen File nesnesinin gerçek yolu okunabiliyor; varsa
        // diskten akış olarak okuyoruz (büyük dosyayı belleğe almamak için).
        const path = item.path || null;
        const size = item.size || 0;
        const name = item.name || 'dosya';

        if (!path && !isDom) continue;
        if (size <= 0) {
          // Boş dosya: teklif edilir, hiç parça gitmez, karşıda 0 baytlık dosya oluşur.
          const rec0 = record({ id: nextId(), name, size: 0, dir: 'out' });
          outQueue.push({ rec: rec0, path, file: isDom ? item : null, offset: 0, readHandle: null });
          emit('queued', rec0);
          continue;
        }

        const rec = record({ id: nextId(), name, size, dir: 'out' });
        outQueue.push({ rec, path, file: isDom ? item : null, offset: 0, readHandle: null });
        emit('queued', rec);
      }
      pumpQueue();
    }

    function pumpQueue() {
      if (outActive || !outQueue.length || !isOpen()) return;
      outActive = outQueue.shift();
      outActive.rec.state = 'offered';
      emit('state', outActive.rec);
      sendJson({ k: 'offer', id: outActive.rec.id, name: outActive.rec.name, size: outActive.rec.size });
    }

    async function beginSending() {
      const active = outActive;
      if (!active) return;
      if (active.path) {
        const opened = await io.openRead(active.path);
        if (!opened || opened.error) {
          sendJson({ k: 'cancel', id: active.rec.id, reason: 'Dosya okunamadı.' });
          failRecord(active.rec, 'Dosya okunamadı: ' + ((opened && opened.error) || '?'));
          outActive = null;
          pumpQueue();
          return;
        }
        active.readHandle = opened.handle;
      }
      active.rec.state = 'sending';
      active.rec.startedAt = Date.now();
      emit('state', active.rec);
      pump();
    }

    async function pump() {
      if (pumping) return;
      pumping = true;
      try {
        while (outActive && outActive.rec.state === 'sending' && isOpen() && !sendPaused) {
          if (channel.bufferedAmount > SEND_HIGH_WATER) break;  // onbufferedamountlow uyandırır

          const active = outActive;
          const remaining = active.rec.size - active.offset;
          if (remaining <= 0) {
            if (active.readHandle != null) { io.closeRead(active.readHandle); active.readHandle = null; }
            active.rec.state = 'flushing';
            sendJson({ k: 'end', id: active.rec.id });
            emit('state', active.rec);
            break;
          }

          const want = Math.min(CHUNK, remaining);
          let chunk;
          if (active.readHandle != null) {
            chunk = await io.readChunk(active.readHandle, want);
          } else {
            const slice = active.file.slice(active.offset, active.offset + want);
            chunk = new Uint8Array(await slice.arrayBuffer());
          }
          // await sırasında iptal edilmiş olabilir.
          if (outActive !== active || active.rec.state !== 'sending') break;
          if (!chunk || chunk.length === 0) {
            sendJson({ k: 'cancel', id: active.rec.id, reason: 'Dosya beklenenden kısa.' });
            if (active.readHandle != null) io.closeRead(active.readHandle);
            failRecord(active.rec, 'Dosya beklenenden kısa.');
            outActive = null;
            pumpQueue();
            break;
          }

          channel.send(chunk);
          active.offset += chunk.length;
          active.rec.moved = active.offset;
          updateRate(active.rec);
          emit('progress', active.rec);
        }
      } catch (err) {
        if (outActive) {
          sendJson({ k: 'cancel', id: outActive.rec.id, reason: String(err && err.message) });
          if (outActive.readHandle != null) io.closeRead(outActive.readHandle);
          failRecord(outActive.rec, String(err && err.message));
          outActive = null;
        }
        pumpQueue();
      } finally {
        pumping = false;
      }
    }

    // ---------------- Alma ----------------

    async function handleOffer(msg) {
      const rec = record({ id: msg.id, name: msg.name, size: msg.size, dir: 'in', state: 'offered' });
      emit('incoming', rec);

      // Yönde zaten bir aktarım varsa reddet: karışık ikili akış çözülemez.
      if (inActive) {
        sendJson({ k: 'reject', id: msg.id, reason: 'Başka bir aktarım sürüyor.' });
        failRecord(rec, 'Başka bir aktarım sürüyor.');
        return;
      }

      if (askAccept) {
        let ok = false;
        try { ok = await askAccept(rec); } catch { ok = false; }
        if (!ok) {
          sendJson({ k: 'reject', id: msg.id, reason: 'Karşı taraf reddetti.' });
          rec.state = 'rejected';
          emit('state', rec);
          return;
        }
      }

      const opened = await io.openWrite(msg.name);
      if (!opened || opened.error) {
        sendJson({ k: 'reject', id: msg.id, reason: 'Dosya oluşturulamadı.' });
        failRecord(rec, 'Dosya oluşturulamadı: ' + ((opened && opened.error) || '?'));
        return;
      }

      inActive = { rec, writeHandle: opened.handle, path: opened.path };
      rec.path = opened.path;
      rec.state = 'receiving';
      rec.startedAt = Date.now();
      emit('state', rec);
      sendJson({ k: 'accept', id: msg.id });

      // Boyutu sıfır olan dosya için hiç parça gelmez; 'end' bekleniyor.
    }

    function handleChunk(data) {
      if (!inActive) return;
      const bytes = data.byteLength || data.length || 0;
      const active = inActive;
      active.rec.moved += bytes;
      updateRate(active.rec);
      pendingWriteBytes += bytes;

      // Ağ diskten hızlıysa fren: karşı tarafa duraklama söyle.
      if (!recvPauseSent && pendingWriteBytes > RECV_HIGH_WATER) {
        recvPauseSent = true;
        sendJson({ k: 'pause' });
      }

      writeChain = writeChain.then(async () => {
        if (inActive !== active) return;
        try {
          await io.writeChunk(active.writeHandle, new Uint8Array(data));
        } catch (err) {
          sendJson({ k: 'cancel', id: active.rec.id, reason: 'Diske yazılamadı.' });
          io.abortWrite(active.writeHandle);
          failRecord(active.rec, 'Diske yazılamadı: ' + (err && err.message));
          inActive = null;
          return;
        }
        pendingWriteBytes = Math.max(0, pendingWriteBytes - bytes);
        if (recvPauseSent && pendingWriteBytes < RECV_LOW_WATER) {
          recvPauseSent = false;
          sendJson({ k: 'resume' });
        }
      });

      emit('progress', active.rec);
    }

    function handleEnd(msg) {
      if (!inActive || inActive.rec.id !== msg.id) return;
      const active = inActive;
      writeChain = writeChain.then(async () => {
        const closed = await io.closeWrite(active.writeHandle);
        inActive = null;
        pendingWriteBytes = 0;
        if (recvPauseSent) { recvPauseSent = false; sendJson({ k: 'resume' }); }
        active.rec.state = 'done';
        active.rec.path = (closed && closed.path) || active.path;
        emit('done', active.rec);
        sendJson({ k: 'ok', id: active.rec.id });
      });
    }

    // ---------------- Mesaj dağıtımı ----------------

    function handleMessage(data) {
      if (typeof data !== 'string') { handleChunk(data); return; }

      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      if (!msg || !msg.k) return;

      switch (msg.k) {
        case 'offer':
          handleOffer(msg);
          break;
        case 'accept':
          if (outActive && outActive.rec.id === msg.id) beginSending();
          break;
        case 'reject':
          if (outActive && outActive.rec.id === msg.id) {
            failRecord(outActive.rec, msg.reason || 'Reddedildi.');
            outActive = null;
            pumpQueue();
          }
          break;
        case 'ok':
          if (outActive && outActive.rec.id === msg.id) {
            outActive.rec.state = 'done';
            outActive.rec.moved = outActive.rec.size;
            emit('done', outActive.rec);
            outActive = null;
            pumpQueue();
          }
          break;
        case 'cancel': {
          const rec = transfers.get(msg.id);
          if (outActive && outActive.rec.id === msg.id) {
            if (outActive.readHandle != null) io.closeRead(outActive.readHandle);
            outActive = null;
            pumpQueue();
          }
          if (inActive && inActive.rec.id === msg.id) {
            io.abortWrite(inActive.writeHandle);
            inActive = null;
            pendingWriteBytes = 0;
          }
          failRecord(rec, msg.reason || 'İptal edildi.');
          break;
        }
        case 'end':
          handleEnd(msg);
          break;
        case 'pause':
          sendPaused = true;
          break;
        case 'resume':
          sendPaused = false;
          pump();
          break;
      }
    }

    // ---------------- Dışa açılan API ----------------

    function cancel(id) {
      const rec = transfers.get(id);
      if (!rec) return;
      sendJson({ k: 'cancel', id, reason: 'İptal edildi.' });

      if (outActive && outActive.rec.id === id) {
        if (outActive.readHandle != null) io.closeRead(outActive.readHandle);
        outActive = null;
        pumpQueue();
      } else {
        const queued = outQueue.findIndex((q) => q.rec.id === id);
        if (queued >= 0) outQueue.splice(queued, 1);
      }
      if (inActive && inActive.rec.id === id) {
        io.abortWrite(inActive.writeHandle);
        inActive = null;
        pendingWriteBytes = 0;
      }
      failRecord(rec, 'İptal edildi.');
    }

    function clearFinished() {
      for (const [id, rec] of transfers) {
        if (rec.state === 'done' || rec.state === 'error' || rec.state === 'rejected') transfers.delete(id);
      }
      emit('list-changed', null);
    }

    return { attach, detach, sendFiles, cancel, clearFinished, list, transfers };
  }

  window.GLFileTransfer = { create, formatBytes, formatRate, CHUNK };
})();
