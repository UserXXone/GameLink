# GameLink — Değişiklik Notları

En yeni sürüm en üstte.

---

# v3.0 — Fluent UI React'e Geçiş

Arayüz Microsoft'un resmî bileşen kütüphanesi **Fluent UI v9**
(`@fluentui/react-components`) ile yeniden yazıldı. Bu bir tema değişikliği
değil, mimari değişiklik.

## Görünüm: saf Windows 11

Özel bir tema **yok**. Fluent'in hazır `webDarkTheme`'i olduğu gibi
kullanılıyor — yani Windows 11 uygulamalarının standart görünümü: düz koyu
griler, 4px köşeler, standart mavi vurgu rengi.

Ara aşamada denenen neon renkler ve kapsül (tam yuvarlak) şekiller
**kaldırıldı**. Marka rampası, token değişiklikleri, degradeler, parlama
efektleri ve ortam ışığı katmanları silindi; `src/theme.js` dosyaları
tamamen gitti.

Arayüz artık Fluent'in kendi bileşenlerinden oluşuyor — kendi yazdığımız
kutucuk, açılır liste ve segment kontrolü kodları kalktı:

| Yer | Bileşen |
|---|---|
| Durum göstergesi | `PresenceBadge` (available / away / offline) |
| Açık-kapalı ayarlar | `Switch` |
| Mod ve kalite seçimi | `RadioGroup` + `Radio` |
| Monitör, bağlantı modu, kısayol | `Dropdown` + `Option` |
| Form alanları | `Field` + `Input` |
| Kartlar, düğmeler, ipuçları | `Card`, `Button`, `Tooltip` |

Özel CSS yalnızca Fluent'in karşılamadığı yerlerde kaldı: video sahnesinin
üstündeki katmanların konumlandırılması ve pencere yerleşimi. Onlar da renk
ve köşe değerlerini Fluent token'larından alıyor.

## Neden bir derleme adımı gerekti

Proje şimdiye kadar `<script src="renderer.js">` ile düz JavaScript yüklüyordu,
paketleyici (bundler) yoktu. Fluent UI React; React, JSX ve npm modülleri
gerektiriyor — bunlar tarayıcıya doğrudan verilemez. Bu yüzden **esbuild**
eklendi:

```
src/index.jsx  →  esbuild  →  renderer.bundle.js  →  index.html
```

`npm start` ve `npm run build` artık önce paketlemeyi çalıştırıyor, ayrıca bir
şey yapmanız gerekmiyor. Yalnızca arayüzü derlemek isterseniz `npm run build:ui`.

Paket boyutu 537 KB (host) / 551 KB (client). Kaynak dosyalar ve esbuild
`.exe` paketine dahil edilmiyor.

## Mimari: mantık ve arayüz ayrıldı

En önemli karar bu. Her iki uygulamada da dosyalar şöyle bölündü:

| Dosya | Sorumluluk |
|---|---|
| `src/controller.js` | WebRTC, sinyalleşme, veri kanalları, girdi yakalama, pano, istatistik — **React'ten tamamen bağımsız** |
| `src/App.jsx` | Yalnızca Fluent UI bileşenleri ve görsel durum |
| `src/index.jsx` | React'i `FluentProvider` + `webDarkTheme` ile bağlar |
| `build.js` | esbuild paketleyici ayarı |

**Neden bu ayrım kritik:** client'ta fare hareketi saniyede onlarca olay üretip
veri kanalına yazıyor. Bunlar React state'ine bağlansaydı her fare kıpırdanışı
yeniden render tetikler ve oyun oynanamayacak kadar gecikirdi. Girdi yakalama
doğrudan `document` dinleyicileriyle çalışmaya devam ediyor; React yalnızca
gerçekten değişen arayüz durumuna abone.

Aynı mantıkla, arayüzü gizle/göster durumu yalnızca **gerçekten değiştiğinde**
render tetikliyor — fare hareketi ettikçe değil.

## Kaldırılan dosyalar

`host/renderer.js`, `client/renderer.js` ve iki `src/theme.js` **silindi**.
Renderer'ların mantığı `src/controller.js` dosyalarına taşındı ve artık hiçbir
yerden yüklenmiyorlardı; tema dosyaları ise stok Fluent temasına geçilince
gereksiz kaldı. Bırakılsalardı "burayı düzelttim ama hiçbir şey değişmiyor"
tuzağı olurlardı. İçerikleri git geçmişinde ve elinizdeki v2.5 zip'inde duruyor.

## Doğrulama

Gerçek Electron'da, IPC uçları taklit edilerek:

- Host ve client **sıfır konsol hatasıyla** açılıyor, React monte oluyor
- Düğme köşeleri `4px` ölçüldü — Fluent'in standart değeri, kapsül yok
- Host: kod, güvenilir cihaz listesi, TURN kartı, 2 `Switch`, monitör listesi
- Client bağlantı ekranı: 2 kayıtlı bağlantı, form, video öğesi
- Client sahne: panel, 7 `Radio` (mod + kalite), istatistik kutusu, 4 `Switch`
- Tepsi durumunun akmaya devam ettiği doğrulandı
- Üretim paketinde geliştirme kancasının **tamamen silindiği** doğrulandı
- Dört ekran görüntüsü gözle kontrol edildi

**İki hata yakalandı ve düzeltildi:** kartlar sütun flex kabında büzülüp
içeriklerini kırpıyordu (`flexShrink: 0`); Griffel'in desteklemediği
`borderColor` kısayolu uzun biçime çevrildi.

## Bilinen sınır

Fluent UI bileşenleri Windows 11 görünümünü getiriyor ama uygulama hâlâ kendi
penceresini çiziyor — gerçek Mica/akrilik pencere efekti için Electron'un
`backgroundMaterial` ayarı ayrıca denenebilir.

---

# v2.6 — Neon Kapsül Arayüzü (CSS) — **geçersiz**

Bu sürümdeki özel neon/kapsül CSS teması v3.0'da tamamen kaldırıldı ve
yerini stok Fluent UI aldı. Kayıt için burada bırakılıyor, artık geçerli değil.

---

# v2.5.1 — Hata Düzeltmeleri

v2.5 kodunun satır satır incelenmesinde bulunan **yedi sorun** düzeltildi.
Yeni bir özellik eklenmedi; iki eksik arayüz kutucuğu tamamlandı.

## 1. Client arayüzünün erişilemez hale gelmesi ⚠️ (en ciddi olan)

**Sorun:** "Butonları tamamen gizle" seçeneği açıkken, ilk yakalamadan sonra üst
çubuk `pointer-events: none` oluyordu. Bu yalnızca görsel bir gizleme değildi —
**⚙ Ayarlar, ⛶ Tam Ekran ve Bağlantıyı Kes butonlarına da tıklanamıyordu.**
Fare hareketiyle geri getirme yolu da bu seçenek için kapatılmıştı. Ayar diske
yazıldığı için sonraki açılışlarda da devam ediyordu; tek kurtuluş bağlantıyı
yeniden kurup videoya tıklamadan önce ayarı geri almaktı (ya da
`%APPDATA%\GameLink\config.json` dosyasını elle düzenlemek).

**Düzeltme:** Bu seçenek artık **yalnızca yakalama sırasında** geçerli. Yakalama
bırakıldığı anda (kısayol, ESC, odak kaybı — hepsi) arayüz her zaman geri
geliyor; yakalama yokken fare hareketi de arayüzü açıyor. Böylece butonların
erişilemez kalması yapısal olarak imkânsız hale geldi.

Seçeneğin adı da davranışını yansıtacak şekilde değişti:
*"Butonları tamamen gizle"* → *"Yakalama sırasında butonları anında gizle"*.
İşlevi aynı (oyun oynarken temiz ekran), sadece artık kilitlemiyor.

## 2. Host tepsisinde "Pencereyi Göster" çökmesi ⚠️

**Sorun:** "Küçültünce tepsiye in" **kapalıyken** kapatma (X) düğmesine
basılınca pencere gerçekten yok ediliyordu, ama `mainWindow` referansı
temizlenmiyor ve uygulama da kapanmıyordu. Ardından tepsi menüsünden
"Pencereyi Göster" seçilince `Object has been destroyed` hatası alınıyordu —
host'a bir daha ulaşılamıyor, sadece Çıkış çalışıyordu.

**Düzeltme:** Pencere yok edildiğinde referans temizleniyor
(`mainWindow.on('closed')`), "Pencereyi Göster" ise pencere yoksa yeniden
oluşturuyor. Artık her durumda geri getirilebiliyor.

## 3. Tepsi menüsünün yanlış durum göstermesi

**Sorun:** Günlüğe yazılan **her satır** tepsiye durum olarak gönderiliyordu.
Tepside "Bekleniyor" / "Bağlı: cihaz" yerine son log satırı görünüyordu —
örneğin `Ayarlar uygulandı: ölçek=1.5 fps=30 bitrate=3Mbps...`. Ayrıca her log
satırında config diskten okunup tepsi menüsü baştan kuruluyordu.

**Düzeltme:** Tepsi bildirimi `log()`'tan alınıp `setStatus()`'a taşındı. Artık
yalnızca gerçek durum değişikliklerinde (bağlanılıyor / bekleniyor / bağlı /
bağlantı koptu) güncelleniyor.

## 4. Tam ekranın iki ayrı mekanizmayla yönetilmesi

**Sorun:** Yakalama başlatılırken DOM Fullscreen API'si, F11 ve ⛶ butonu ise
Electron'un `setFullScreen()` metodu kullanılıyordu. İki ayrı "tam ekran"
durumu oluşuyordu: yakalamadan çıktıktan sonra tam ekrandan çıkmak için
**F11'e iki kez** basmak gerekiyordu ve butonun aktif göstergesi gerçeği
yansıtmıyordu.

**Düzeltme:** Her şey DOM Fullscreen API'sinde birleştirildi (Keyboard Lock
zaten bunu şart koşuyor). Buton durumu `fullscreenchange` olayına bağlandı, yani
hangi yoldan girilirse girilsin doğru gösteriyor. Artık gereksiz kalan
`set-fullscreen` IPC kanalı da kaldırıldı.

## 5. Client'ta tepsi ayarının arayüzü yoktu

**Sorun:** `minimizeToTray` tercihi kodda tanımlıydı ve çalışıyordu, ama
client'ta bunu değiştirecek bir kutucuk yoktu — kapatılamıyordu.

**Düzeltme:** Ayarlar paneline **Pencere → "Küçültünce sistem tepsisine in"**
kutucuğu eklendi.

## 6. Client'ta pano ayarının kalıcı olmaması

**Sorun:** "Panoyu host ile eşitle" ayarı yalnızca bellekte tutuluyordu; diğer
tüm ayarlar kalıcıyken bu her açılışta açık konuma dönüyordu.

**Düzeltme:** Ayar artık `config.json` içine yazılıyor ve açılışta geri
yükleniyor.

## 7. Küçük düzeltmeler

- **Kısayol etiketi:** *"Fare Orta Tuş (basılı tut)"* → *"Fare Orta Tuş"*.
  Kod zaten basılı tutmayı değil tek tıklamayı bekliyordu, etiket yanıltıcıydı.
- **`host/config.example.json`** güncellendi: v2.5'te eklenen `iceMode` ve
  `minimizeToTray` alanları örnekte eksikti.
- `host/renderer.js` içinde birleştirmeden kalan çift yorum bloğu temizlendi.

---

## Bu turda gerçekten test edilenler

Öncekilerden farklı olarak bu düzeltmeler **sizin makinenizde, gerçek
Electron ile** çalıştırılarak doğrulandı (gizli pencerede, IPC uçları taklit
edilerek):

- Host ve client renderer'ları **sıfır konsol hatasıyla** tam olarak başlıyor
- Arayüz kilitlenmesi senaryosu: arayüz gizliyken yakalama bırakıldığında ve
  fare hareket ettiğinde butonlar geri geliyor — ikisi de doğrulandı
- Tepsiye giden durumun gerçek bağlantı durumu olduğu doğrulandı
  (`"Sunucuya bağlanılıyor..."`), log satırı değil
- Yeni tepsi kutucuğu ve tam ekran butonu arayüzde mevcut
- `set-fullscreen` kanalının tamamen kalktığı, kalan API'lerin yerinde olduğu
- Tüm `.js` söz dizimi, `config.example.json` geçerliliği
- Arayüz eleman kimlikleri, preload API'leri ve IPC kanal karşılıkları:
  host 22, client 29 referans — eksik veya karşılıksız hiçbir şey yok
- **`asarUnpack` doğrulandı:** `dist/win-unpacked/resources/app.asar.unpacked/`
  altında `input-bridge.ps1` gerçek dosya olarak duruyor, yani paketlenmiş
  .exe'de girdi köprüsü çalışabiliyor

**Hâlâ sizin elinizde test edilecekler:** yönetici yetkisiyle Görev Yöneticisi
kontrolü, tepsiye inme davranışı, gerçek bağlantıda relay zorlaması, keyboard
lock (Win tuşu).

> **Not:** `dist/` klasöründeki mevcut .exe dosyaları bu düzeltmelerden **önce**
> derlendi. Değişikliklerin geçerli olması için `npm run build` ile yeniden
> derlemeniz gerekiyor.

> **Test uyarısı:** `npm start` ile geliştirme modunda çalıştırdığınızda host
> **yönetici yetkisi almaz** — `requestedExecutionLevel` yalnızca
> `electron-builder` ile derlenmiş .exe'ye uygulanır. Görev Yöneticisi
> üzerindeki kontrolü test etmek için mutlaka `dist/` içindeki .exe'yi
> kullanın, yoksa sorun devam ediyor gibi görünür.

---

# v2.5

v2.15'in (buton gizleme, kısayol, keyboard lock) üzerine eklenen üç ana özellik.

---

## 1. Bağlantı Modu Seçici (STUN / TURN)

Host GUI'sine **"Bağlantı Modu"** kartı eklendi. Seçim host'ta yapılır ve
bağlantı kurulurken client'a otomatik iletilir — client tarafında ayar yok.

| Mod | Ne yapar | Ne zaman kullanılır |
|---|---|---|
| **Otomatik** (varsayılan) | Önce doğrudan bağlanmayı dener, başaramazsa TURN'e düşer | Neredeyse her zaman en iyisi |
| **Sadece STUN** | TURN hiç kullanılmaz | Ev ağı gibi doğrudan bağlanabilen yerlerde, en düşük gecikme |
| **Sadece TURN** | Tüm trafik röle üzerinden (`iceTransportPolicy: 'relay'`) | Doğrudan bağlantı kararsızsa; sunucu bant genişliği harcar |

**Güvenlik önlemi:** "Sadece TURN" seçiliyken TURN sunucusu tanımlı değilse
bağlantı tamamen kopmaz — sistem STUN'a düşer ve GUI'de turuncu bir uyarı
gösterir. (Bu davranış test edildi.)

Mod değişikliği **bir sonraki bağlantıda** geçerli olur, aktif oturumu kesmez.

---

## 2. Görev Yöneticisi / yükseltilmiş pencerelerde kontrol kaybı

### Sorunun gerçek sebebi

Bu bir hata değil, Windows'un **UIPI** (User Interface Privilege Isolation)
güvenlik mekanizması. UIPI, düşük "bütünlük seviyesindeki" (integrity level)
süreçlerin daha yüksek seviyeli süreçlere girdi mesajı göndermesini engeller —
bu, "shatter attack" denen yetki yükseltme saldırılarına karşı bir önlem.

Görev Yöneticisi yükseltilmiş (high IL) çalışır. GameLink Host ise normal
kullanıcı seviyesinde (medium IL) çalışıyordu, dolayısıyla `SendInput`
çağrıları **sessizce** bloklanıyordu. Sessizce olması işi zorlaştırıyor:
`SendInput` 0 döner ama hata kodu UIPI'yi işaret etmez.

Microsoft'un dokümantasyonu bu konuda net: yükseltilmiş bir pencereyi
`SendInput` ile sürmek istiyorsanız, çağıran sürecin de yükseltilmiş olması
gerekir.

### Düzeltme

`host/package.json` → `win.requestedExecutionLevel: "requireAdministrator"`

Host artık yönetici olarak çalışıyor. Bu sayede Görev Yöneticisi, Kayıt
Defteri Düzenleyicisi, yükseltilmiş PowerShell gibi pencerelerde de kontrol
çalışıyor.

### ⚠️ Bilmeniz gereken iki sınırlama

**a) UAC onay penceresi hâlâ görünmez/kontrol edilemez.**
UAC istemi ayrı bir masaüstünde ("secure desktop") çalışır. Oraya erişmek
yükseltilmiş olmak yetmez — **UIAccess** bayrağı gerekir, o da uygulamanın
Microsoft'un güvendiği bir sertifikayla imzalanmış olmasını ve
`Program Files` altında kurulu olmasını şart koşar. AnyDesk bunu ücretli bir
kod imzalama sertifikası + SYSTEM servisi ile çözüyor. Sertifika almadan bu
mümkün değil, dürüst olmak gerekirse bu bizim için şu an ulaşılabilir değil.
Ekranda UAC çıkarsa host'ta fiziksel olarak onaylamanız gerekir.

**b) Otomatik başlatma artık kısayolla çalışmaz.**
Yönetici gerektiren bir program `shell:startup` klasöründen başlatılamaz (her
açılışta UAC istemi çıkar ve kimse onaylamaz). Bunun yerine **Görev
Zamanlayıcı** kullanın:

1. `Win+R` → `taskschd.msc`
2. Sağda **Create Task** (Create Basic Task değil!)
3. **General** sekmesi:
   - Name: `GameLink Host`
   - ✅ **Run with highest privileges** ← bu kritik
   - Configure for: Windows 10/11
4. **Triggers** → New → Begin the task: **At log on** → kendi kullanıcınızı seçin
5. **Actions** → New → Start a program → kurulu `.exe`'nin yolu
   (örn. `C:\Program Files\GameLink Host\GameLink Host.exe`)
6. **Conditions** sekmesi: "Start the task only if the computer is on AC power"
   işaretini **kaldırın** (masaüstünde sorun olmaz ama garanti olsun)
7. OK

Bu, oturum açılınca host'u UAC istemi olmadan yönetici yetkisiyle başlatır.
BIOS'taki "Restore on AC Power Loss" + otomatik oturum açma ayarlarınızla
birlikte elektrik kesintisi senaryosu tam çalışır.

---

## 3. Sistem tepsisi (system tray)

Hem host hem client artık küçültülünce **görev çubuğunda yer kaplamıyor**,
sistem tepsisine iniyor.

**Host tepsi menüsü:**
- Bağlantı kodu ve anlık durum (Bekleniyor / Bağlı: cihaz adı) — canlı güncellenir
- Pencereyi Göster
- Kodu Panoya Kopyala
- Çıkış

**Önemli davranış değişikliği:** Host'ta **kapatma (X) düğmesi artık programı
sonlandırmıyor**, tepsiye indiriyor. Sebebi: host kapanırsa uzaktan
bağlanamazsınız — yanlışlıkla kapatıp bağlantıyı kaybetmeyi önlüyor. Gerçekten
çıkmak için tepsi simgesine sağ tıklayıp **Çıkış** deyin.

Bu davranış host GUI'sindeki **"Pencere"** kartından kapatılabilir.

Tepsi simgesine **çift tıklamak** pencereyi geri getirir.

---

## Nasıl Güncellenir

### Sunucu — değişiklik yok
`server/server.js` bu turda da değişmedi. Sunucunuza dokunmanıza gerek yok.

### Host + Client

```powershell
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"

cd host
npm install
npm run build

cd ..\client
npm install
npm run build
```

**Host'u kurduktan sonra:** artık her açılışta UAC istemi çıkacak (yönetici
gerektirdiği için). Bu beklenen davranış. Otomatik başlatma için yukarıdaki
Görev Zamanlayıcı adımlarını uygulayın.

---

## Test Durumu

**Bu ortamda gerçekten çalıştırılıp doğrulananlar:**
- Sunucu protokolü: 10/10 test geçti
- ICE modu mantığı, 5 senaryo:
  - `auto` → STUN + TURN, policy `all`
  - `stun-only` → TURN tanımlı olsa bile listeye sızmıyor
  - `turn-only` → sadece TURN, policy `relay`, kimlik bilgileri taşınıyor
  - `turn-only` ama TURN tanımsız → güvenli şekilde STUN'a düşüyor (bağlantı ölmüyor)
  - `iceMode` tanımsız → `auto` gibi davranıyor
- HTML ↔ JS element ID tutarlılığı (host 22, client 28 ID — eksik yok)
- Tray ikonunun geçerli bir PNG olduğu (görsel olarak doğrulandı)
- Tüm `.js` / `.json` söz dizimi

**Sizin makinenizde ilk kez test edilecekler:**
- Yönetici yetkisiyle Görev Yöneticisi üzerinde kontrol
- Tepsiye inme / tepsi menüsü / çift tıkla geri getirme
- Sadece-TURN modunun gerçek bağlantıda relay'e zorlaması
- v2.15'ten gelen keyboard lock (Win tuşu) ve buton gizleme

Sorun çıkarsa host penceresindeki **Günlük** bölümünü paylaşın.
