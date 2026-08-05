# GameLink v3.1.5 — Hız, Tema ve Boşluksuz Yollar

> v3.1'in üzerine eklenen bakım sürümü. Yeni bir özellik yok; var olanı hızlandırma,
> güzelleştirme ve kurulumdaki pürüzleri temizleme sürümü.

Sıfırdan kurulum yapacaksanız artık ayrı bir kılavuz var:
**[KURULUM.md](KURULUM.md)** — sunucu, DuckDNS, sertifika, host, client, TURN,
otomatik başlatma, sorun giderme.

---

## 1. Açılış hızı

### Asıl suçlu: her açılışta C# derlemesi

Host'un girdi köprüsü (`input-bridge.ps1`) `SendInput`, `SetCursorPos`, `BlockInput`
gibi Windows API'lerine ulaşmak için içinde bir C# sınıfı taşıyor ve bunu
`Add-Type -TypeDefinition` ile derliyordu. Bu satır, **her açılışta** C# derleyicisini
(csc.exe) ayağa kaldırıyordu. Köprü hazır olana kadar client'tan gelen fare/klavye
komutları işlenemediği için bu doğrudan "programı açtım ama bir süre tepki vermedi"
demekti.

Artık derleme bir kez yapılıp DLL olarak önbelleğe alınıyor:

```
%LOCALAPPDATA%\GameLink\bridge-cache\InputSim-<kaynak-özeti>.dll
```

Dosya adı kaynağın SHA-256 özetini taşıdığı için script değiştiğinde önbellek
kendiliğinden yenilenir — elle temizlik gerekmez.

**Ölçüm** (bu makinede, köprünün açılıp hazır olmasına kadar geçen süre):

| | Süre |
|---|---|
| 1. çalışma (önbellek yok, derliyor) | **974 ms** |
| 2. çalışma (önbellekten) | **274 ms** |
| 3. çalışma (önbellekten) | **271 ms** |

Kalan ~270 ms'nin büyük kısmı PowerShell'in kendi açılışı. Yavaş disklerde ve
antivirüs taraması olan makinelerde ilk rakam 2-3 saniyeye kadar çıkabiliyordu;
kazanç oralarda daha da büyük.

Önbellek yazılamazsa (salt okunur disk, izin sorunu, antivirüs engeli) eski
yönteme sessizce dönülüyor — yavaş ama her koşulda çalışıyor.

### Beyaz "flaş" kaldırıldı

Her iki program da pencereyi artık boş haldeyken göstermiyor (`show: false` +
`ready-to-show`). Pencerenin arka plan rengi de açılmadan önce seçili temaya
ayarlanıyor, böylece koyu tema kullanan biri açılışta bir kare beyaz ekran görmüyor.

### Gereksiz disk okumaları

`config.json` yalnızca programın kendisi tarafından yazılıyor, ama her tepsi
yenilemesinde, her pencere olayında ve her IPC çağrısında **diskten yeniden
okunuyordu**. Artık bellekte tutuluyor, yazarken güncelleniyor.

### Client: donanım kimliği

Client'ın HWID'si `node-machine-id` ile hesaplanıyor ve bu kütüphane senkron bir alt
süreç (`REG QUERY`) çalıştırıyor — ilk çağrıda 150-300 ms, üstelik ana süreci
bloklayarak. Artık bir kez hesaplanıp ayar dosyasına yazılıyor; sonraki açılışlarda
alt süreç hiç çalışmıyor. Ayrıca pencere açıldıktan sonra arka planda "ısıtılıyor",
böylece arayüzün ilk isteği beklemiyor.

### Açılış sırası

Pencere önce oluşturuluyor; tepsi simgesi ve monitör listesi (`desktopCapturer.getSources`,
tek başına birkaç yüz milisaniye sürebiliyor) bir sonraki olay döngüsü turuna bırakıldı.

### Paket boyutu

`renderer.bundle.js` / `.map` ve `dist` klasörü artık kuruluma dahil edilmiyor
(~6 MB). Daha küçük `app.asar` = açılışta daha az disk okuması.

---

## 2. Kurulum yolunda ve program adında boşluk yok

**Sorun:** `C:\Program Files\GameLink Host\GameLink Host.exe` yolundaki boşluklar
tırnaksız `cd` komutlarını, açılışta çalışan `.bat` kısayollarını ve bazı
zamanlanmış görev tanımlarını bozuyordu.

**Çözüm:**

| | Eski | Yeni |
|---|---|---|
| Ürün adı (host) | `GameLink Host` | **`GameLink-Host`** |
| Kurulum yolu (host) | `C:\Program Files\GameLink Host` | **`C:\GameLink\Host`** |
| Kurulum yolu (client) | `C:\Program Files\GameLink` | **`C:\GameLink\Client`** |
| Çalıştırılabilir (host) | `GameLink Host.exe` | **`GameLink-Host.exe`** |

Varsayılan dizin, NSIS kurulumuna eklenen `build/installer.nsh` dosyasındaki
`preInit` makrosuyla belirleniyor. Kurulum sırasında **Gözat** ile başka bir klasör
seçmek hâlâ mümkün.

### Ayarlarınız kaybolmayacak

Electron'un ayar klasörü ürün adından türer; ad değişince ayarlar başka bir klasörde
kalırdı (bağlantı kodu, parola, güvenilir cihazlar). Host ilk açılışında eski
klasörü (`%APPDATA%\GameLink Host`) arayıp ayarları bir kez kopyalıyor.

### Görev Zamanlayıcı yolunu güncelleyin

Otomatik başlatma kurduysanız görevdeki program yolunu düzeltin:

```
Eski: C:\Program Files\GameLink Host\GameLink Host.exe
Yeni: C:\GameLink\Host\GameLink-Host.exe
```

---

## 3. Arayüz: tema desteği ve renkli tasarım

### Açık / Koyu / Sistem

Her iki programda tema seçimi eklendi:

- **Host:** sağ üst köşedeki üç düğme (🖥 Sistem · ☀ Açık · 🌙 Koyu)
- **Client:** sol alt köşedeki aynı üçlü **ve** video sahnesindeki Ayarlar panelinde
  "Tema" bölümü (bağlantı sırasında da değiştirilebilsin diye)

**Sistem** seçiliyken Windows'un açık/koyu ayarı izlenir; Windows'ta temayı
değiştirdiğinizde arayüz anında uyum sağlar.

Tema tercihi, sayfanın ilk satırı çizilmeden önce okunuyor (preload üzerinden
senkron). Bu yüzden koyu tema kullanan biri açılışta bir an açık tema görmüyor —
tema geçişlerinde tipik olan "flaş" hiç oluşmuyor.

### Renkler

Fluent tabanından devam edildi, üzerine renk eklendi:

- Host'ta bağlantı kodu artık gradyanlı, geometrik desenli bir **hero kart**
- Her ayar kartının kendi renkli ikon rozeti var
- Client'ın karşılama ekranında renkli bir arka plan, nokta dokusu ve yüzen
  geometrik şekiller
- Kayıtlı bağlantılar, kodlarından türetilen kendi renklerini alıyor (aynı bağlantı
  her zaman aynı renkte)
- Onay kutuları Fluent tarzı kayar anahtarlara dönüştü

Tüm renkler CSS değişkenlerinden geliyor; `<html data-theme="...">` değiştiğinde
arayüzün tamamı tek seferde yeniden renkleniyor.

Şekillerin hareketi yalnızca `transform` ile yapılıyor (GPU katmanında kalır, ana
iş parçacığını meşgul etmez) ve `prefers-reduced-motion` ayarına saygı gösterir.

### Küçük eklemeler

- Host'ta bağlantı kodunu tek tıkla panoya kopyalama
- Durum göstergesi rozete dönüştü; uzun mesajlarda başlık artık satır kırmıyor

---

## 4. Düzeltmeler

**"Küçültünce tepsiye in" ayarı yanlış görünüyordu.**
Bu alan arayüze gönderilen ayar listesinde yoktu; kutu, kayıtlı değer ne olursa
olsun her açılışta işaretli görünüyordu. (Ayarın kendisi doğru çalışıyordu, yalnızca
gösterim yanlıştı.)

**Ayar dosyası okunamadığında sessizce sıfırlanıyordu.**
`config.json` bozuk ya da okunamaz durumdaysa program yeni bir dosya oluşturup
üzerine yazıyordu — bağlantı kodu, parola ve güvenilir cihaz listesi gidiyordu.
Artık önce yedekleniyor:

```
config.json.bozuk-2026-08-04T21-30-00-000Z
```

**Görünmez BOM işareti dosyayı "bozuk" yapıyordu.**
Not Defteri'nin "UTF-8 BOM'lu" kaydı ve PowerShell'in `Out-File` komutu dosyanın
başına görünmez bir karakter koyar; `JSON.parse` bunu kabul etmez. Yani ayar
dosyasını elle düzenlemek, yukarıdaki sıfırlanmayı tetikleyebiliyordu. Artık bu
işaret okurken kırpılıyor. (Bu iki sorun birlikte, geliştirme sırasında ayar
dosyasının gerçekten sıfırlanmasına yol açtı; ikisi de bu sürümde kapatıldı.)

---

## 5. Değişen dosyalar

```
host/input-bridge.ps1     derleme önbelleği (Initialize-InputSim, Get-SourceHash)
host/main.js              config bellek önbelleği, BOM kırpma, bozuk dosya yedeği,
                          userData taşıma, ready-to-show, tema arka planı,
                          get-initial-theme, publicConfig'e minimizeToTray + theme
host/preload.js           initialTheme (senkron, flaşsız tema)
host/renderer.js          tema mantığı, kod kopyalama, uyarı rengi değişkeni
host/index.html           YENİDEN YAZILDI — token tabanlı çift tema, renkli tasarım
host/package.json         sürüm 3.1.5, productName GameLink-Host, NSIS include,
                          paket dosya listesi
host/build/installer.nsh  YENİ — varsayılan kurulum dizini C:\GameLink\Host

client/main.js            config bellek önbelleği, BOM kırpma, bozuk dosya yedeği,
                          HWID önbelleği, ready-to-show, tema arka planı,
                          get-initial-theme, prefs.theme
client/preload.js         initialTheme
client/renderer.js        tema mantığı, renkli bağlantı rozetleri
client/index.html         YENİDEN YAZILDI — çift tema, renkli karşılama ekranı,
                          panelde tema seçimi
client/package.json       sürüm 3.1.5, NSIS include, paket dosya listesi
client/build/installer.nsh YENİ — varsayılan kurulum dizini C:\GameLink\Client

KURULUM.md                YENİ — sıfırdan kurulum kılavuzu
```

`server/` bu sürümde de değişmedi.

---

## 6. Nasıl güncellenir

```powershell
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"

cd host
npm install
npm run build

cd ..\client
npm install
npm run build
```

Sonra `dist` klasöründeki kurulum dosyalarını çalıştırın.

**Eski sürüm kurulu kalabilir mi?** Kurulum yolu ve ürün adı değiştiği için eski
sürüm ayrı bir program olarak görünür. Karışıklık olmasın diye **önce eskisini
kaldırın** (Ayarlar → Uygulamalar → "GameLink Host" → Kaldır), sonra yenisini kurun.
Ayarlarınız otomatik taşınır.

---

## 7. Test durumu

**Bu ortamda gerçekten çalıştırılıp doğrulananlar:**

- Köprü açılış süresi ölçümü (yukarıdaki tablo, 3 çalışma)
- Host ve client programları başlatıldı, arayüzler **koyu ve açık temada** ekran
  görüntüsüyle kontrol edildi
- Video sahnesindeki ayar paneli ve istatistik kutusu her iki temada kontrol edildi
- Tema tercihinin diskten okunup açılışta doğru uygulandığı
- `config.json`'a BOM eklendiğinde eski davranışın ayarları sıfırladığı
  (sorun bu şekilde bulundu), yeni davranışın dosyayı yedeklediği
- Tüm `.js` dosyalarının söz dizimi, `input-bridge.ps1`'in PowerShell ayrıştırıcısından
  geçtiği, HTML ↔ JS element ID tutarlılığı (host ve client'ta eksik yok)

**Sizin makinenizde ilk kez denenecekler:**

- NSIS kurulumunun gerçekten `C:\GameLink\Host` ve `C:\GameLink\Client` klasörlerine
  kurması
- v3.1'den gelen ayarların yeni klasöre taşınması
- Görev Zamanlayıcı ile otomatik başlatmanın yeni yolla çalışması
- Gerçek bir bağlantıda ikinci imleç, TURN ve pano eşitlemesinin v3.1'deki gibi
  çalışmaya devam etmesi
