// GameLink v4.0 — Oturum penceresi (host tarafı, AnyDesk'teki bağlantı paneline karşılık)
//
// Burada WebRTC yok. Veri kanalları ana pencerenin renderer'ında; bu pencere ana
// süreç üzerinden olay alıp eylem gönderiyor:
//   ana pencere --('session-push')--> ana süreç --('session-event')--> bu pencere
//   bu pencere --('session-action')--> ana süreç --('session-action')--> ana pencere

const $ = (id) => document.getElementById(id);

let connectedAt = 0;
let activeTab = 'chat';
let unreadChat = 0;
let unreadFiles = 0;
let peer = { name: '-', hwid: '' };

// ---------------- Sekmeler ----------------

function setTab(name) {
  activeTab = name;
  document.querySelectorAll('#tabs button').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === name);
  });
  document.querySelectorAll('.panel').forEach((p) => {
    p.classList.toggle('active', p.id === 'panel-' + name);
  });
  if (name === 'chat') { unreadChat = 0; renderBadges(); }
  if (name === 'files') { unreadFiles = 0; renderBadges(); }
}

document.querySelectorAll('#tabs button').forEach((btn) => {
  btn.addEventListener('click', () => setTab(btn.dataset.tab));
});

function renderBadges() {
  const chat = $('chatBadge');
  chat.textContent = unreadChat;
  chat.classList.toggle('show', unreadChat > 0);
  const files = $('fileBadge');
  files.textContent = unreadFiles;
  files.classList.toggle('show', unreadFiles > 0);
}

// ---------------- Sohbet ----------------

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s == null ? '' : String(s);
  return div.innerHTML;
}

function addMessage(kind, text, who) {
  const log = $('chatLog');
  const el = document.createElement('div');
  el.className = 'msg ' + kind;
  if (kind === 'sys') {
    el.textContent = text;
  } else {
    el.innerHTML = (who ? `<span class="who">${escapeHtml(who)}</span>` : '') + escapeHtml(text);
  }
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  if (kind === 'them' && activeTab !== 'chat') { unreadChat += 1; renderBadges(); }
}

function sendChat() {
  const input = $('chatInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  window.sessionAPI.send({ a: 'chat', text });
  addMessage('me', text);
}

$('chatSendBtn').addEventListener('click', sendChat);
$('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

// ---------------- Dosya aktarımı ----------------
//
// Dosyalar bu pencerede okunmuyor; yalnızca yolları ana pencereye iletiliyor,
// akışı orası yürütüyor.

$('pickFilesBtn').addEventListener('click', async () => {
  const files = await window.sessionAPI.pickFiles();
  if (files && files.length) window.sessionAPI.send({ a: 'send-paths', files });
});

$('clearFilesBtn').addEventListener('click', () => window.sessionAPI.send({ a: 'clear-files' }));

const dropzone = $('dropzone');
['dragenter', 'dragover'].forEach((type) => {
  document.addEventListener(type, (e) => {
    e.preventDefault();
    dropzone.classList.add('hot');
  });
});
['dragleave', 'drop'].forEach((type) => {
  document.addEventListener(type, (e) => {
    e.preventDefault();
    if (type === 'dragleave' && e.relatedTarget) return;
    dropzone.classList.remove('hot');
  });
});
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const files = Array.from(e.dataTransfer.files || [])
    .map((f) => ({ path: f.path, name: f.name, size: f.size }))
    .filter((f) => f.path);
  if (files.length) {
    setTab('files');
    window.sessionAPI.send({ a: 'send-paths', files });
  }
});

const STATE_LABELS = {
  queued: 'sırada', offered: 'onay bekleniyor', sending: 'gönderiliyor',
  receiving: 'alınıyor', flushing: 'tamamlanıyor', done: 'tamamlandı',
  error: 'hata', rejected: 'reddedildi',
};

function formatBytes(n) {
  if (!isFinite(n) || n < 0) return '-';
  if (n < 1024) return n + ' B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return (v < 10 ? v.toFixed(1) : Math.round(v)) + ' ' + units[i];
}

function renderTransfers(list) {
  const box = $('transferList');
  box.innerHTML = '';
  if (!list || !list.length) return;

  for (const rec of list) {
    const item = document.createElement('div');
    item.className = 'transfer' + (rec.state === 'done' ? ' done' : rec.state === 'error' ? ' error' : '');
    const percent = rec.size > 0 ? Math.min(100, (rec.moved / rec.size) * 100) : (rec.state === 'done' ? 100 : 0);
    const rate = rec.rate > 0 && (rec.state === 'sending' || rec.state === 'receiving')
      ? ` · ${formatBytes(rec.rate)}/sn` : '';

    item.innerHTML = `
      <div class="head">
        <span class="icon">${rec.dir === 'in' ? '⬇' : '⬆'}</span>
        <span class="name">${escapeHtml(rec.name)}</span>
      </div>
      <div class="meta">${formatBytes(rec.moved)} / ${formatBytes(rec.size)} · ${STATE_LABELS[rec.state] || rec.state}${rate}${rec.error ? ' — ' + escapeHtml(rec.error) : ''}</div>
      <div class="bar"><i style="width:${percent}%"></i></div>
    `;

    const actions = document.createElement('div');
    actions.className = 'act';
    if (rec.state === 'done' && rec.dir === 'in' && rec.path) {
      const reveal = document.createElement('button');
      reveal.className = 'secondary';
      reveal.textContent = 'Klasörde göster';
      reveal.addEventListener('click', () => window.sessionAPI.reveal(rec.path));
      actions.appendChild(reveal);
    }
    if (['queued', 'offered', 'sending', 'receiving', 'flushing'].includes(rec.state)) {
      const cancel = document.createElement('button');
      cancel.className = 'danger';
      cancel.textContent = 'İptal';
      cancel.addEventListener('click', () => window.sessionAPI.send({ a: 'cancel-file', id: rec.id }));
      actions.appendChild(cancel);
    }
    if (actions.children.length) item.appendChild(actions);
    box.appendChild(item);
  }
}

// Gelen dosya onayı burada sorulmuyor: bu pencere kapalı ya da arka planda olabilir.
// Host "sormadan kabul et"i kapattıysa soru işletim sistemi diyaloğuyla çıkar
// (bkz. main.js -> 'ask-file-accept').

// ---------------- Bağlantı bilgisi ----------------

function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

setInterval(() => {
  if (!connectedAt) return;
  const text = formatDuration(Date.now() - connectedAt);
  $('infoDuration').textContent = text;
  $('peerMeta').textContent = `Bağlı · ${text}`;
}, 1000);

$('disconnectBtn').addEventListener('click', () => {
  window.sessionAPI.send({ a: 'disconnect' });
});

// ---------------- Ana pencereden gelen olaylar ----------------

window.sessionAPI.onEvent((msg) => {
  if (!msg || !msg.t) return;

  switch (msg.t) {
    case 'peer': {
      peer = { name: msg.deviceName || 'Bilinmeyen cihaz', hwid: msg.hwid || '' };
      connectedAt = msg.connectedAt || Date.now();
      $('peerName').textContent = peer.name;
      $('peerAvatar').textContent = (peer.name.replace(/[^A-Za-z0-9ÇĞİÖŞÜçğıöşü]/g, '').slice(0, 2) || '?').toUpperCase();
      $('infoDevice').textContent = peer.name;
      $('infoHwid').textContent = peer.hwid ? peer.hwid.slice(0, 12) + '…' : '—';
      addMessage('sys', `${peer.name} bağlandı`);
      break;
    }
    case 'chat':
      addMessage('them', msg.text, peer.name);
      break;
    case 'files':
      renderTransfers(msg.list);
      if (activeTab !== 'files' && msg.bump) { unreadFiles += 1; renderBadges(); }
      break;
    case 'ask-file':
      askIncoming(msg.rec);
      break;
    case 'stats':
      $('infoTransport').textContent = msg.transport || '—';
      $('infoRtt').textContent = msg.rtt != null ? msg.rtt + ' ms' : '—';
      $('infoBitrate').textContent = msg.mbps != null ? msg.mbps.toFixed(2) + ' Mbps' : '—';
      $('infoResolution').textContent = msg.resolution || '—';
      break;
    case 'cursor':
      $('infoCursor').textContent = msg.mode === 'ghost' ? 'İkinci imleç' : 'Tek imleç';
      break;
    case 'sys':
      addMessage('sys', msg.text);
      break;
    case 'theme': {
      const dark = msg.theme === 'dark'
        || (msg.theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      break;
    }
    case 'closed':
      connectedAt = 0;
      $('peerMeta').textContent = 'Bağlantı kapandı';
      addMessage('sys', 'Bağlantı kapandı');
      break;
  }
});

// Sistem teması değişirse ("Sistem" seçiliyken) anında uyum sağla.
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  if ((window.sessionAPI.initialTheme || 'system') === 'system') {
    document.documentElement.dataset.theme = e.matches ? 'dark' : 'light';
  }
});

// Açılır açılmaz ana pencereden mevcut durumu iste.
window.sessionAPI.send({ a: 'hello' });
