# GameLink — Kendi Uzak Oyun Erişim Sistemin

Kod + parola ile, onay ekranı olmadan bağlanan, oyun için optimize edilmiş
uzak masaüstü sistemi. WebRTC üzerinden çalışır; görüntü host↔client arasında
**doğrudan (P2P)** akar, sunucu sadece eşleştirme (sinyalleşme) yapar.

**Önceki "etrafında 20 tur dönme" sorunu neden oluyordu?**
Fare hareketi muhtemelen *mutlak koordinat* (SetCursorPos tarzı) olarak
gönderiliyordu. Oyunlar (FPS/TPS kamera kontrolü) fareyi RawInput/DirectInput
ile **göreli (relative) delta** olarak okur. Bu projede client tarafında
tarayıcının **Pointer Lock API**'si kullanılıyor (`movementX/movementY`),
host tarafında da Win32 `SendInput` **`MOUSEEVENTF_MOVE`** (mutlak değil,
göreli) ile enjekte ediliyor. Bu ikisi birbiriyle uyumlu olduğu için sorun
kökünden çözülüyor.

## Bileşenler

| Klasör    | Nerede çalışır              | Görevi |
|-----------|------------------------------|--------|
| `server/` | GCP Debian sunucunuz          | Kod+parola doğrulama, WebRTC eşleştirme, client sayfasını sunma |
| `host/`   | Oyunun oynandığı Windows PC   | Ekranı yayınlar, gelen fare/klavye komutlarını Windows'a enjekte eder |
| `client/` | Bağlanacağınız herhangi bir cihaz | Tek HTML dosyası, kurulum gerektirmez, tarayıcıda açılır |

---

## 1) Sunucu Kurulumu (Debian 13, GCP)

### 1.1 Temel paketler

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y nodejs npm nginx certbot python3-certbot-nginx git
node -v   # v18+ öneririm; çok eskiyse NodeSource ile güncelleyin
```

Node.js çok eskiyse (Debian repo'su bazen geride kalır):
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### 1.2 Projeyi sunucuya kopyalayın

Bu zip'i sunucunuza yükleyin (örn. `scp` ile) ve açın, ya da içeriği kendi
git reponuza koyup `git clone` ile çekin. Sonuçta sunucuda şu yapı olmalı:

```
/home/KULLANICI/gamelink/server/server.js
/home/KULLANICI/gamelink/client/index.html
```

```bash
cd ~/gamelink/server
npm install
node server.js   # test amaçlı elle çalıştırıp "8080 portunda çalışıyor" mesajını görün, sonra Ctrl+C
```

### 1.3 Alan adı (domain) — TLS için gerekli

Tarayıcılar `getDisplayMedia` / Pointer Lock gibi API'leri sadece **güvenli
bağlamda (HTTPS/WSS)** çalıştırır. Bu yüzden düz `ws://IP:8080` yeterli
olmaz, gerçek bir domain + Let's Encrypt sertifikası lazım.

Ücretsiz bir domain yoksa **DuckDNS** (duckdns.org) gibi bir servisle
sunucunuzun statik IP'sine ücretsiz bir alt alan adı (örn.
`benim-pc.duckdns.org`) bağlayabilirsiniz. Kendi domaininiz varsa onu da
kullanabilirsiniz — A kaydını sunucunuzun genel IP'sine yönlendirin.

### 1.4 Nginx + Let's Encrypt (WSS)

`server/nginx.conf.example` dosyasını referans alın:

```bash
sudo cp ~/gamelink/server/nginx.conf.example /etc/nginx/sites-available/gamelink
sudo nano /etc/nginx/sites-available/gamelink   # "sizin-domaininiz.com" kısmını değiştirin
sudo ln -s /etc/nginx/sites-available/gamelink /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d sizin-domaininiz.com
```

Certbot sertifikayı otomatik alıp nginx config'inize işleyecek ve otomatik
yenileme kuracaktır.

### 1.5 Sunucuyu kalıcı servis olarak çalıştırın (systemd)

```bash
sudo cp ~/gamelink/server/gamelink.service.example /etc/systemd/system/gamelink.service
sudo nano /etc/systemd/system/gamelink.service   # KULLANICI_ADINIZ'ı düzenleyin
sudo systemctl daemon-reload
sudo systemctl enable --now gamelink
sudo systemctl status gamelink   # "active (running)" görmelisiniz
```

### 1.6 Güvenlik duvarı

GCP konsolunda VPC firewall kuralları: 80 ve 443 portlarını (TCP) dışarıya
açın. 8080'i **dışarıya açmayın** — nginx zaten 443'ten 127.0.0.1:8080'e
proxy yapıyor, 8080'in doğrudan dışarıdan erişilebilir olmasına gerek yok.

```bash
sudo apt install ufw -y
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

Test: tarayıcıdan `https://sizin-domaininiz.com` adresine gidin, GameLink
giriş ekranını görmelisiniz (henüz host çalışmadığı için bağlanamayacaksınız,
bu normal).

---

## 2) Host Kurulumu (oyunun oynandığı Windows bilgisayar)

### 2.1 Gereksinimler

- [Node.js](https://nodejs.org) (LTS sürüm) kurulu olmalı
- Windows 10/11

### 2.2 Kurulum

`host/` klasörünü Windows makinenize kopyalayın, PowerShell veya CMD ile
içine girin:

```powershell
cd host
npm install
copy .env.example .env
notepad .env
```

`.env` dosyasında:
```
HOST_CODE=istediğiniz_bir_kod
HOST_PASSWORD=güçlü_bir_parola
SIGNALING_URL=wss://sizin-domaininiz.com
```

### 2.3 Çalıştırma

```powershell
npm start
```

Terminalde `Hazır. Kod: ... — bağlantı bekleniyor.` mesajını görünce host
hazırdır. Bu terminal penceresini açık bırakın (istersen simge durumuna
küçültebilirsiniz).

**Not — Windows Defender / Güvenlik Duvarı:** İlk çalıştırmada Windows,
Node/Electron'un ağ erişimi için izin isteyebilir; "İzin Ver" deyin.
SmartScreen bir uyarı gösterirse "Yine de çalıştır" ile devam edin (kendi
yazdığınız/derlediğiniz bir uygulama olduğu için imzasızdır, bu normaldir).

**PowerShell çalıştırma politikası:** `main.js`, `input-bridge.ps1`'i zaten
`-ExecutionPolicy Bypass` bayrağıyla başlattığı için sistem genelinde bir
politika değişikliği yapmanıza gerek yok.

### 2.4 Bilgisayar açılışında otomatik başlatma (opsiyonel)

Ekran yakalama, oturum açık ve etkileşimli (aktif) olmalıdır — bu yüzden
Görev Zamanlayıcı'nın "oturum açılmamış olsa da çalıştır" seçeneği **işe
yaramaz** (o mod masaüstü yakalayamaz). Bunun yerine:

1. `Win+R` → `shell:startup` yazıp Enter'a basın
2. Açılan klasöre, host'u başlatan bir `.bat` dosyasının kısayolunu koyun:
   ```bat
   @echo off
   cd /d "C:\yol\gamelink\host"
   npm start
   ```

Bu, siz Windows'a giriş yaptığınızda host'u otomatik başlatır.

---

## 3) Client Kullanımı (bağlandığınız cihaz)

1. Herhangi bir güncel tarayıcıda `https://sizin-domaininiz.com` adresine
   gidin
2. Sunucu adresini (`wss://sizin-domaininiz.com`), kodu ve parolayı girin
3. "Bağlan"a tıklayın — host çalışıyorsa birkaç saniye içinde ekran
   görünecektir
4. Video üzerine **tıklayın** → fare kilitlenir (Pointer Lock), artık fare
   hareketiniz doğrudan göreli delta olarak host'a gider (dönme sorunu yok)
5. **ESC** tuşu fareyi serbest bırakır (tarayıcı güvenliği gereği bu
   davranışı değiştiremiyoruz) — tekrar tıklayarak kilitleyebilirsiniz

---

## 4) Bağlantı kurulamıyorsa (NAT/CGNAT sorunları)

Bu sistem görüntüyü doğrudan P2P gönderir ve NAT arkasından çıkmak için
STUN sunucusu kullanır (varsayılan: Google'ın herkese açık STUN'u).
Çoğu ev ağında bu yeterlidir. Ama host veya client özellikle kısıtlayıcı
bir ağdaysa (mobil operatör CGNAT'ı, bazı kurumsal ağlar, "symmetric NAT")
STUN yetmeyebilir ve bir **TURN** (röle) sunucusuna ihtiyaç duyulur.

Zaten bir GCP sunucunuz olduğu için üzerine kendi TURN sunucunuzu (coturn)
kurabilirsiniz:

```bash
sudo apt install coturn -y
# /etc/turnserver.conf içinde realm, kullanıcı/parola, external-ip ayarlayın
sudo systemctl enable --now coturn
```

Sonra hem `client/index.html` hem `host/renderer.js` içindeki
`iceServers` listesine TURN sunucunuzu ekleyin:
```js
{ urls: 'turn:sizin-domaininiz.com:3478', username: '...', credential: '...' }
```

Bu isteğe bağlı bir gelişmiş adımdır — önce STUN ile deneyin, bağlanamazsanız
bu yönteme geçin.

---

## 5) Performans / gecikme ipuçları

- `host/renderer.js` içinde `maxBitrate` (varsayılan 8 Mbps) ve
  `frameRate` (varsayılan 60) değerlerini ağınıza göre ayarlayın
- Aynı şehir/bölgedeki bir GCP bölgesi seçmek sinyalleşme gecikmesini
  azaltır (görüntü zaten P2P gittiği için asıl önemli olan host↔client
  arası fiziksel mesafe ve ağ kalitesidir)
- Host bilgisayarınızda donanım hızlandırmalı kodlama (GPU) varsa Chromium/
  Electron bunu otomatik kullanır

---

## 6) Güvenlik notları

- Bu sistemi **sadece kendi cihazlarınız için** kullanın
- `.env` dosyasını kimseyle paylaşmayın, git'e commit etmeyin
- Güçlü bir `HOST_PASSWORD` seçin (parola sunucuya SHA-256 hash'i olarak
  gönderilir, ayrıca WSS zaten uçtan uca şifreli taşır)
- Sunucu 5 hatalı denemeden sonra o IP'yi 1 dakika engeller (kaba kuvvet
  koruması) — `server/server.js` içindeki `MAX_ATTEMPTS`/`BLOCK_MS` ile
  ayarlanabilir

---

## Test edildi

`server/server.js`, gerçek bir Node.js süreci olarak çalıştırılıp otomatik
uçtan uca testlerle doğrulandı: kayıt, yanlış parola reddi, doğru parola ile
eşleşme, çift yönlü sinyal iletimi, statik dosya sunumu ve ayrılma
bildirimleri — hepsi başarılı. `host/` ve `client/` tarafındaki JS
dosyalarının söz dizimi kontrol edildi. `input-bridge.ps1` Windows'a özgü
olduğu için (PowerShell burada mevcut değil) çalıştırılarak test edilemedi;
mantık standart, belgelenmiş Win32 `SendInput` kalıbını izliyor. Kendi
makinenizde ilk çalıştırmada bir sorun çıkarsa (özellikle scan code/klavye
düzeni uyuşmazlığı gibi) bana loglarla birlikte yazın, birlikte
düzeltelim.
