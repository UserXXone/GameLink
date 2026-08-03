# GameLink v2.5 — Değişiklik Notları

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
