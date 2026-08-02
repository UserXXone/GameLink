# GameLink v2 — Kendi Uzak Oyun Erişim Sistemin

Kod ile bağlanan, **onay ekranı olmadan**, HWID ile birbirini tanıyan iki cihaz
arasında çalışan, oyun için optimize edilmiş uzak masaüstü sistemi. Artık hem
**host** hem **client** gerçek Windows programı (GUI'li, .exe olarak
paketlenebilir).

## v2'de neler değişti

| Özellik | v1 | v2 |
|---|---|---|
| Client | Tarayıcıda açılan HTML sayfası | Gerçek Electron programı (GUI'li) |
| Kimlik doğrulama | Sunucu, sabit parola hash'i kontrol ediyordu | **Host** karar veriyor: HWID tanıyorsa otomatik kabul, tanımıyorsa parola ister |
| Tekrar bağlanma | Her seferinde kod+parola | Tanınan cihazlar **tek tıkla**, parolasız bağlanır |
| Ses | Yok | Var (sistem sesi, WASAPI loopback) |
| Klavye güvenilirliği | Fare ile aynı, kayıp toleranslı kanal | Ayrı, **güvenilir** kanal (tuş "yapışık kalma" riski yok) |
| Kalite ayarı | Sabit (kodda) | Client'tan canlı değiştirilebilir: 3 mod × 4 kalite preseti |
| Paketleme | Yok | `electron-builder` ile portable + installer .exe |

**Not:** Kod içindeki e-posta/SMS doğrulama fikirleri bilinçli olarak
uygulanmadı — HWID karşılıklı tanıma zaten aynı "tek tıkla gir" deneyimini
veriyor ve hiçbir dış servise (e-posta/SMS sağlayıcı) bağımlılık yaratmıyor.

## v2.1'de eklenenler

| Özellik | Nerede | Ne işe yarıyor |
|---|---|---|
| Yapışık tuş koruması | host + client | Fare kilidini bırakınca, pencere odağı gidince ya da bağlantı kopunca basılı tuş/butonlar **her iki tarafta** serbest bırakılır |
| Monitör seçimi | host GUI + client paneli | Çok monitörlü PC'de hangi ekranın paylaşılacağı seçilir; bağlıyken değiştirmek görüntüyü kesmez |
| TURN ayarı GUI'de | host GUI | CGNAT için TURN bilgisi host'ta girilir, client'a bağlantı sırasında otomatik iletilir — artık kod düzenlemek gerekmiyor |
| Pano eşitleme | host + client | Kopyaladığınız metin iki cihaz arasında karşılıklı taşınır (kapatılabilir) |
| Canlı istatistik | client | Çözünürlük, FPS, bit hızı, RTT, paket kaybı, jitter |
| Tam ekran | client | Üst baradaki buton ya da F11 |
| Genişletilmiş klavye | client | Win, Menü, PrintScreen, Pause ve `<>` tuşu eklendi (toplam 105 tuş) |
| Blok düzeltmesi | server | nginx arkasında tüm istemciler `127.0.0.1` göründüğü için, bir cihazın 5 hatalı denemesi **herkesi** blokluyordu; artık gerçek IP (`X-Real-IP`) kullanılıyor |
| Sağlık kontrolü | server | `GET /health` (artık gereksiz olan statik dosya sunumunun yerine) |
| Sunucu testleri | server | `npm test` ile 10 uçtan uca protokol testi |

---

## Bileşenler

| Klasör | Nerede çalışır | Görevi |
|---|---|---|
| `server/` | GCP sunucunuz | Oda kodu ile eşleştirme, join isteklerinin host'a iletilmesi, SDP/ICE aktarımı |
| `host/` | Oyunun oynandığı Windows PC | GUI (kod/parola/güvenilir cihazlar), ekran+ses yayını, girdi enjeksiyonu |
| `client/` | Bağlandığınız cihaz | GUI (kayıtlı bağlantılar, mod/kalite paneli), girdi yakalama |

---

## 1) Sunucu kurulumu (Debian, GCP)

v1'den değişen tek şey yok — aynı adımlar geçerli:

```bash
cd ~/GameLink/server
npm install
npm test         # protokol testleri (10 test, birkaç saniye sürer)
node server.js   # test için elle çalıştırıp mesajı görün, sonra Ctrl+C
```

Sunucunun ayakta olduğunu dışarıdan kontrol etmek için basit bir uç var:

```bash
curl https://sizin-domaininiz.com/health
# {"ok":true,"rooms":1,"uptime":38412}
```

Nginx + certbot + systemd + firewall adımları için önceki kurulumda
kullandığınız `nginx.conf.example` ve `gamelink.service.example` dosyaları
aynen geçerli, tekrar etmiyorum. Sunucu zaten ayakta ve çalışıyor.

**Protokol notu:** Sunucu artık parola kontrolü yapmıyor — sadece host'a
"şu HWID'li cihaz bağlanmak istiyor" bilgisini iletiyor, kararı host veriyor.
Bu yüzden `server.js`'i güncellediyseniz (bu zip'teki v2 sürüm), sunucuyu
yeniden başlatmanız yeterli:

```bash
sudo systemctl restart gamelink
sudo systemctl status gamelink
```

---

## 2) Host kurulumu (Windows, oyunun oynandığı PC)

### 2.1 Geliştirme/test modunda çalıştırma

```powershell
cd host
npm install
npm start
```

İlk açılışta program otomatik olarak:
- HWID'inizden sabit bir **Bağlantı Kodu** üretir (örn. `A3F9-K2LX`)
- `config.json` dosyasını şu konumda oluşturur:
  `%APPDATA%\GameLink Host\config.json`
  (Bu, portable/installer fark etmeksizin her zaman kalıcıdır — .exe'nin
  yanına değil, Windows'un kullanıcı veri klasörüne yazılır.)

Açılan pencerede:
1. **Parola** kutusuna bir parola girip **Kaydet**'e basın (ilk bağlantı için gerekli)
2. **Sunucu Adresi** kutusuna `wss://sizin-domaininiz.com` yazıp **Kaydet**'e basın
3. Birden fazla monitörünüz varsa **Paylaşılan Ekran** listesinden hangisinin
   yayınlanacağını seçin (seçim kalıcıdır, bağlıyken de değiştirilebilir)
4. Üstteki nokta yeşile dönüp "Bekleniyor" yazana kadar bekleyin

### 2.2 .exe olarak paketleme (portable + installer)

```powershell
npm run build
```

Bu, `electron-builder`'ı çalıştırır ve `host/dist/` klasörüne şunları üretir:
- `GameLink-Host-Portable.exe` — tek dosya, kurulum gerektirmez
- `GameLink-Host-Kurulum.exe` — klasik Windows kurulum sihirbazı

İlk çalıştırmada `npm run build` bazı ek araçları (nsis vb.) internetten
indirecektir, birkaç dakika sürebilir.

**Not — imzasız uygulama uyarısı:** Kendi derlediğiniz bu programın dijital
imzası olmadığı için Windows Defender SmartScreen "Bilinmeyen yayımcı"
uyarısı gösterebilir. "Diğer bilgiler" → "Yine de çalıştır" ile devam edin,
bu normaldir.

### 2.3 Güvenilir Cihazlar nasıl işler

- İlk bağlantıda client doğru parolayı girerse, host o client'ın HWID'ini
  otomatik olarak **Güvenilir Cihazlar** listesine ekler (GUI'de görünür)
- Bir sonraki bağlantıda o cihaz **parola girmeden**, sadece kod ile
  (client tarafında "kayıtlı bağlantı"ya tıklayarak) otomatik kabul edilir
- İstediğiniz cihazı listeden **Kaldır** ile çıkarabilirsiniz — o andan
  itibaren o cihaz tekrar parola girmek zorunda kalır

### 2.4 Otomatik başlatma (elektrik kesintisi sonrası)

BIOS "Restore on AC Power Loss" ayarınız zaten hallolduğuna göre, kalan iki
adım:

**a) Windows otomatik oturum açma:**
```
Win+R → netplwiz → Enter
```
Kullanıcınızı seçip **"Bu bilgisayarı kullanmak için kullanıcı adı ve parola
girilmesi gerekir"** kutucuğunun işaretini kaldırın → Uygula → parolanızı
girip onaylayın.

**b) Başlangıç kısayolu:**
```
Win+R → shell:startup → Enter
```
Açılan klasöre, `npm run build` ile ürettiğiniz **portable .exe**'nin (ya da
kurulumdan sonra oluşan kısayolun) bir kısayolunu koyun.

Bu ikisi + BIOS ayarınız birlikte: elektrik gelince PC açılır → otomatik
giriş yapar → GameLink Host otomatik başlar → kod hazır olur.

---

## 3) Client kurulumu (bağlandığınız cihaz)

### 3.1 Geliştirme/test modunda çalıştırma

```powershell
cd client
npm install
npm start
```

Açılan pencerede sol tarafta **Kayıtlı Bağlantılar** (ilk seferde boş),
sağda bağlantı formu var.

**İlk bağlantı:**
1. Sunucu Adresi: `wss://sizin-domaininiz.com`
2. Kod: host GUI'sinde gördüğünüz kod (örn. `A3F9-K2LX`)
3. Parola: host'ta ayarladığınız parola
4. **Bağlan**

Bağlantı başarılı olursa bu bilgi otomatik olarak **Kayıtlı Bağlantılar**'a
eklenir — host da bu cihazın HWID'ini güvenilir listesine ekler. Bir
sonraki seferden itibaren sadece listeden tıklamanız yeterli, parola
istenmez.

### 3.2 .exe olarak paketleme

```powershell
npm run build
```

`client/dist/` klasöründe `GameLink-Portable.exe` ve `GameLink-Kurulum.exe`
oluşur. Aynı SmartScreen notu burada da geçerli.

### 3.3 Bağlandıktan sonra: Mod ve Kalite paneli

Video üzerindeki **⚙ Ayarlar** butonuna basınca açılan panelde:

**Mod** (gecikme/akıcılık önceliği):
- 🎮 **Oyun** — en düşük gecikme, kare hızı her şeyden önce korunur
- 💼 **Normal** (Word/Aegisub gibi durağan işler) — görüntü netliği önceliklidir, düşük fps yeterlidir
- 📺 **Streaming** (video izleme) — daha büyük tampon kullanılır, gecikme yerine akıcılık/donmama önceliklidir

**Kalite** (veri/çözünürlük):
- 🐢 Veri Tasarrufu — düşük çözünürlük+bitrate, mobil veri için
- ⚖ Dengeli — orta seviye
- 🚀 Yüksek — kaynak çözünürlük, yüksek bitrate (fiber/wifi için)
- ⚙ Özel — ölçek/FPS/bitrate'i elle girin

İkisi birbirinden bağımsızdır, istediğiniz kombinasyonu seçebilirsiniz
(örn. "Oyun modu + Veri Tasarrufu" mobil veride hızlı tempolu oyun için).
Değişiklik anında, bağlantıyı koparmadan uygulanır.

Aynı panelde ayrıca:
- **Monitör** — host'un birden fazla ekranı varsa buradan seçebilirsiniz
  (host'ta oturmanıza gerek yok, geçiş anında ve görüntü kesilmeden olur)
- **Pano** — panonun host ile eşitlenmesini kapatıp açar

**Video üstüne tıklayın** → fare kilitlenir (Pointer Lock, relative
hareket). **ESC** ile serbest bırakılır.

### 3.4 Üst bardaki diğer butonlar

- **📊 İstatistik** — canlı çözünürlük, FPS, bit hızı, RTT (gecikme), paket
  kaybı ve jitter. Hangi kalite presetinin hattınıza uyduğunu buradan
  görebilirsiniz; RTT'nin sürekli yükselmesi bant genişliğinizin yetmediğini
  gösterir, bir alt presete inin.
- **⛶ Tam Ekran** — F11 ile de açılıp kapanır.
- **Bağlantıyı Kes** — oturumu kapatıp kayıtlı bağlantılar ekranına döner.

---

## 4) Teknik notlar

### Klavye neden ayrı kanalda?

Fare hareketi kayıp toleranslı (`ordered:false, maxRetransmits:0`) bir
kanaldan gider — bir paket kaybolsa da sorun değil, bir sonraki delta zaten
gelir. Ama klavye **"tuş bırakıldı"** olayı kaybolursa (örn. Forza'da gaz
tuşu), o tuş host tarafında **basılı takılı kalır**. Bu yüzden klavye,
varsayılan **güvenilir** (`ordered:true`, otomatik yeniden gönderim) bir
kanaldan gidiyor — biraz daha gecikmeli olabilir ama asla "yapışık tuş"
olmaz.

### Yapışık tuşa karşı üç katmanlı koruma

Güvenilir kanal tek başına yetmiyor: tuş basılıyken **bağlantı tamamen
koparsa** ya da ESC ile fare kilidinden çıkarsanız, tarayıcı "tuş bırakıldı"
olayını hiç üretmez. Bu yüzden üç katman var:

1. **Client** basılı tuşları/butonları kendi tarafında takip eder; fare kilidi
   bırakıldığında, pencere odağı gittiğinde veya bağlantı kesildiğinde hepsi
   için tek tek "bırak" gönderir.
2. **Host**, veri kanalı kapandığında ya da `connectionState` `failed`/
   `disconnected` olduğunda köprüye "her şeyi bırak" komutu verir — client
   hiçbir şey gönderemeden çökse bile çalışır.
3. **`input-bridge.ps1`** kendi bastığı tuşların listesini tutar ve hem bu
   komutta hem de stdin kapandığında (yani Host programı kapandığında/
   çöktüğünde) hepsini bırakır.

ESC ayrıca özel bir durum: fare kilidini yerel olarak açtığı için keyup'ı
gelmeyebilir, bu yüzden host'a **tek dokunuş** (bas-bırak) olarak gönderilir.
Yani oyundaki menü yine açılır, tuş da takılı kalmaz.

### Kalite ayarları nasıl uygulanıyor?

Ekran yakalama her zaman kaynak çözünürlükte/60fps'e kadar başlıyor;
çözünürlük/fps/bitrate değişiklikleri **yeniden yakalama yapılmadan**,
WebRTC'nin `RTCRtpSender.setParameters()` (`scaleResolutionDownBy`,
`maxFramerate`, `maxBitrate`, `degradationPreference`) ile anında
uygulanıyor. Bu sayede mod/kalite değiştirirken ekran hiç kesilmiyor/
yeniden başlamıyor.

### Gecikme (mod) ayarı nasıl uygulanıyor?

`degradationPreference` **host**'ta (encoder) ayarlanıyor.
`playoutDelayHint` ise **client**'ta, `RTCRtpReceiver` üzerinde
ayarlanıyor (jitter buffer hedefi) — Oyun modunda 0 (en düşük gecikme),
Streaming modunda ~0.4s (daha akıcı, gecikme önemsiz).

---

### Monitör değişimi neden görüntüyü kesmiyor?

Yeni ekran ayrı bir `getDisplayMedia` çağrısıyla yakalanıp `RTCRtpSender.
replaceTrack()` ile mevcut göndericiye takılıyor. SDP yeniden pazarlığı
(renegotiation) yapılmadığı için bağlantı hiç kopmuyor; ses akışı da
etkilenmiyor (yeni yakalamanın ses track'i kullanılmadan kapatılıyor).
Eski video track'i `stop()` ile kapatıldığı için Windows'ta arka planda iki
ekran birden yakalanmıyor.

---

## 5) NAT/CGNAT ve TURN (gerekirse)

Mobil veri genelde CGNAT arkasındadır, STUN bazen yetmez. Bu durumda
sunucunuza `coturn` kurup **sadece Host programındaki** "TURN Sunucusu"
kartını doldurmanız yeterli:

- **URL:** `turn:sizin-domaininiz.com:3478`
- **kullanıcı / parola:** coturn'de tanımladığınız bilgiler

Host, bu listeyi bağlantı kurulurken client'a SDP teklifiyle birlikte
gönderir; client tarafında ayrıca bir şey ayarlamanız (ya da kod düzenlemeniz)
gerekmez. Alanı boş bırakırsanız yalnızca STUN kullanılır. Önce STUN ile
deneyin, bağlantı kurulamıyorsa TURN'e geçin.

---

## Test durumu

- `server/server.js` (v2 protokol): gerçek bir Node.js süreci olarak
  çalıştırılıp **10 otomatik testle** doğrulandı — sağlık kontrolü, host
  kaydı, kodun ikinci kez alınamaması, bilinmeyen kod, join-request akışı,
  host'un kabul/red kararı, iki yönlü sinyal aktarımı (TURN listesi dahil),
  zaman aşımı, yeni client bağlanınca eskisinin bilgilendirilmesi,
  kaba kuvvet bloğunun cihaz bazında çalışması, ayrılma bildirimleri.
  `cd server && npm test` ile siz de çalıştırabilirsiniz. **Hepsi geçiyor.**
- Kod üretimi (HWID→kod) ve parola hash karşılaştırma mantığı izole
  şekilde test edildi, doğru çalışıyor.
- `host/` ve `client/` altındaki tüm `.js` dosyalarının söz dizimi
  kontrol edildi; ayrıca arayüz eleman kimlikleri, preload API'leri ve IPC
  kanallarının karşılıkları otomatik olarak doğrulandı (eksik referans yok).
  Klavye haritasındaki 105 tuşun tarama kodları çakışmıyor.
- Electron'a özgü kısımlar (GUI, `getDisplayMedia`, `SendInput` köprüsü,
  monitör değiştirme, pano eşitleme, `electron-builder` paketleme) Linux
  sandbox'ta çalıştırılıp uçtan uca test **edilemedi** (Windows/Electron
  gerektiriyor). `input-bridge.ps1` de PowerShell olmadığı için sadece elle
  gözden geçirildi. İlk gerçek testte bir hata çıkarsa konsol/log çıktısını
  paylaşın, birlikte düzeltiriz.
