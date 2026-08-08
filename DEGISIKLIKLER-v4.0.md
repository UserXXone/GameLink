# GameLink v4.0 — Oturum, Dosya, Sistem ve Dağıtım

> v3.1.5'in üzerine gelen büyük sürüm. v3.x "ekranı ve girdiyi taşımak" üzerineydi;
> v4.0 bunun etrafına **bir oturumu birlikte yönetmek** için gereken her şeyi ekliyor:
> dosya aktarımı, yazışma, karşı bilgisayarın durumu, kayıt, ve programın kendini
> kurup güncelleyebilmesi.

Sıfırdan kurulum yapacaksanız: **[KURULUM.md](KURULUM.md)**

---

## İçindekiler

1. [Dosya aktarımı](#1-dosya-aktarımı)
2. [Yazışma ve oturum penceresi](#2-yazışma-ve-oturum-penceresi)
3. [Host bilgisayarın durumu](#3-host-bilgisayarın-durumu)
4. [Ağ kalitesi göstergesi](#4-ağ-kalitesi-göstergesi)
5. [Ekran kaydı](#5-ekran-kaydı)
6. [Pencere yakalama](#6-pencere-yakalama)
7. [Çözünürlük ve pencere yönetimi](#7-çözünürlük-ve-pencere-yönetimi)
8. [Otomatik başlatma ve tek örnek](#8-otomatik-başlatma-ve-tek-örnek)
9. [Ayarları dışa/içe aktarma](#9-ayarları-dışaiçe-aktarma)
10. [Otomatik güncelleme](#10-otomatik-güncelleme)
11. [Sanal makine / VDS desteği](#11-sanal-makine--vds-desteği)
12. [Güvenlik: parola artık düz metin değil](#12-güvenlik-parola-artık-düz-metin-değil)
13. [Mikrofon, kodek seçimi, genişletilmiş istatistikler](#13-mikrofon-kodek-seçimi-genişletilmiş-istatistikler)
14. [Düzeltmeler](#14-düzeltmeler)
15. [Protokol eklentileri](#15-protokol-eklentileri)
16. [Değişen dosyalar](#16-değişen-dosyalar)
17. [Nasıl güncellenir](#17-nasıl-güncellenir)
18. [Test durumu](#18-test-durumu)
19. [Bilinen sınırlar](#19-bilinen-sınırlar)

---

## 1. Dosya aktarımı

İki yönlü, sürükle-bırak destekli dosya aktarımı. Client'ta **Oturum → Dosyalar**,
host'ta bağlantıyla açılan **oturum penceresi → Dosyalar**.

Taşıma, WebRTC'nin yeni `files` veri kanalından yapılıyor — yani **doğrudan P2P**,
sunucudan geçmiyor, TURN kullanılmıyorsa hiçbir aracıya uğramıyor.

**Dosya belleğe alınmıyor.** 64 KB'lık parçalar hâlinde diskten okunup diske
yazılıyor; 40 GB'lık bir dosya da 40 KB'lık bir dosya da aynı bellekle aktarılıyor.

**İki katmanlı akış denetimi** var, çünkü tek katman yetmiyor:

| Katman | Neyi çözer |
|---|---|
| Gönderende `bufferedAmount` eşiği | Ağ diskten yavaşsa SCTP tamponunun şişmesini |
| Alıcıdan `pause`/`resume` mesajı | Ağ diskten hızlıysa yazılmayı bekleyen parçaların bellekte birikmesini |

İkincisi olmadan hızlı bir bağlantıda yavaş bir diske yazarken bellek şişiyordu.

**Güvenlik.** Gelen dosyanın adını karşı taraf belirliyor; olduğu gibi kullanmak
`..\..\Windows\System32\` gibi bir yola yazmaya izin verirdi. Ad tamamen sterilize
ediliyor: dizin bileşenleri atılıyor, `< > : " / \ | ? *` ve denetim karakterleri
temizleniyor, Windows'un ayrılmış adları (`CON`, `NUL`, `COM1`…) öne alt çizgi
alıyor, aynı adlı dosya varsa `(1)`, `(2)` eklenerek yeni dosya açılıyor.

Varsayılan olarak gelen dosya **sorulur** (host tarafında işletim sistemi
penceresiyle — oturum penceresi kapalı ya da arkada olabilir). "Sormadan kabul et"
her iki tarafta ayrı bir seçenek. Kayıt klasörü varsayılan olarak
`İndirilenler\GameLink`, değiştirilebilir.

Aynı anda yönde tek aktarım çalışır, gerisi kuyrukta bekler: kanal sıralı olduğu
için gelen ikili verinin hangi dosyaya ait olduğu böylece belirsiz kalmıyor.

## 2. Yazışma ve oturum penceresi

**Yazışma** `control` kanalından gidiyor (güvenilir, sıralı). Client'ta oturum
panelinde, host'ta oturum penceresinde.

**Oturum penceresi** — AnyDesk'te bağlantı kurulunca çıkan panelin karşılığı.
Host'ta bir cihaz bağlandığında kendiliğinden açılıyor:

- Kim bağlandı, ne kadar süredir bağlı
- Sohbet
- Dosya aktarımı (sürükle-bırak dahil)
- Bağlantı türü (doğrudan / TURN), gecikme, gönderilen bit hızı, çözünürlük
- **Bağlantıyı kes** düğmesi

Pencereyi kapatmak oturumu kesmez. Hiç açılmamasını isterseniz ana penceredeki
**Oturum** sekmesinden kapatabilirsiniz.

WebRTC bağlantısı ana pencerenin renderer'ında yaşadığı için oturum penceresi
ana süreç üzerinden köprüleniyor; kendisi hiçbir veri kanalına dokunmuyor.

## 3. Host bilgisayarın durumu

Client'ta **Oturum → Host PC** sekmesi: karşı bilgisayarın anlık durumu.

- İşlemci ve bellek kullanımı (çubuklu gösterge)
- **Disk ve ağ etkinlik ışıkları** — eski bilgisayarların ön panelindeki LED'ler
  gibi, etkinlikle orantılı bir olasılıkla titreyerek yanıp sönüyor
- Disk ve ağ hızı (bayt/sn)
- İşlemci adı, çekirdek/iş parçacığı sayısı, ekran kartı, işletim sistemi ve
  yapı numarası, toplam bellek, makine üreticisi/modeli
- Disklerin boş/toplam alanı ve doluluk yüzdesi
- Sanal makine ve uzak masaüstü oturumu rozetleri

Host tarafında **Oturum → Sistem Bilgisi** ile kapatılabilir. Bilgi yalnızca bağlı
cihaza, yalnızca oturum boyunca gider; hiçbir yere kaydedilmez.

### Nasıl ölçülüyor

CPU ve bellek **Electron tarafında** hesaplanıyor (`os.cpus()` tik farkları,
`os.freemem`): alt süreç maliyeti yok ve dilden bağımsız.

Disk ve ağ için ayrı bir PowerShell köprüsü (`sysinfo-bridge.ps1`) var ve yalnızca
bir client bilgi istediğinde başlatılıyor. Girdi köprüsüne eklenmedi: orası
gecikmeye duyarlı, WMI sorgusu fare paketlerinin önünü tıkardı.

**Yerelleştirme tuzağı.** .NET'in `PerformanceCounter` sınıfı kategori adlarını
**yerelleştirilmiş** olarak bekler: bu makinede `PhysicalDisk` değil `FizikselDisk`,
`% Disk Time` değil `% Disk Zamanı`. İngilizce ad yazmak Türkçe Windows'ta sessizce
çalışmamaya yol açıyordu. Windows sayaç adlarını kayıt defterinde indeks→ad olarak
tutuyor (`Perflib\009` İngilizce, `Perflib\CurrentLanguage` yerel dil); ikisi indeks
üzerinden eşleştirilip İngilizce addan yerel ada çeviri yapılıyor. Bu çeviri bir kez
yapılıyor.

Sayaç kaydı bozuksa (bazı kısıtlı VDS şablonlarında oluyor) WMI'nin ham sayaçlarına
düşülüyor — yavaş ama çalışıyor. O da yoksa disk ışığı gizleniyor.

**Ölçüm** (bu makinede): 250 ms hedef aralık, gerçekleşen **267 ms**, tek çekirdeğin
**%3.3'ü**, ~99 MB bellek. Yalnızca oturum sürerken çalışıyor.

## 4. Ağ kalitesi göstergesi

Oyun sırasında da görünen küçük bir HUD (sol alt): **sinyal çubukları**, ping,
paket kaybı, bit hızı, FPS. Çubuklar ve renkler gecikme + kayıptan hesaplanan
0-4 arası bir puana göre yeşil/sarı/kırmızı oluyor.

Ayarlar panelinden kapatılabilir.

Ayrıntılı istatistik kutusuna (📊) eklenenler: **kullanılan kodek**, ortalama
**kare çözme süresi**, **donma sayısı** ve bağlantının **doğrudan mı TURN mü**
olduğu. Kare çözme süresi, takılmanın ağdan mı yoksa client'ın CPU'sundan mı
kaynaklandığını ayırt etmenin en doğrudan yolu.

## 5. Ekran kaydı

İki taraf da bağımsız kayıt alabiliyor:

| | Client tarafı | Host tarafı |
|---|---|---|
| Ne kaydeder | Gördüğünüz akış | Ham yakalama |
| Kalite | Ağ kalitesi kadar (sıkıştırılmış görüntü) | Tam kalite, ağdan etkilenmez |
| Maliyet | Sizin CPU'nuz | Host'un CPU/diski |
| Nereye | Sizin `Videolar\GameLink` | Host'un `Videolar\GameLink` |

Client'ta üst çubuktaki **⏺ Kaydet** (basılıyken süre sayar), host'ta **Ekran**
sekmesindeki kayıt kartı. Bit hızı ayarlanabiliyor (client 10, host 12 Mbps
varsayılan). Biçim WebM; VP9 varsa VP9, yoksa VP8.

Kayıt diske parça parça yazılıyor, bellekte birikmiyor. Host tarafında paylaşılan
kaynak değiştirilirse kayıt düzgünce kapatılıyor — `MediaRecorder` akıştaki track
değişimini izleyemiyor, yarım bir dosya bırakmaktansa kapatmak doğru davranış.

## 6. Pencere yakalama

Artık tüm ekran yerine **tek bir pencere** paylaşılabiliyor. Liste host'ta
**Ekran → Paylaşılan Kaynak** altında ekranlar ve pencereler olarak gruplanıyor;
client de kendi ayar panelinden aynı listeden seçim yapabiliyor.

Pencere paylaşımında yalnızca o pencerenin içeriği gider — üstünü kapatan başka
pencereler görüntüye girmez.

### İkinci imleç pencere modunda nasıl hizalanıyor

İkinci imlecin oranlı (0..1) konumu artık ekranın değil **paylaşılan pencerenin**
sınırlarına oturuyor. Windows'ta `desktopCapturer`'ın pencere kimliği
`window:<HWND>:<n>` biçiminde — yani pencere tanıtıcısı kimliğin içinde. Bu
tanıtıcı köprüye gönderiliyor, köprü `DwmGetWindowAttribute` ile pencerenin
**görünen** çerçeve sınırlarını döndürüyor (`GetWindowRect` DWM'in görünmez gölge
kenarlığını da içerdiği için doğrudan kullanılmıyor).

Sınır 400 ms önbellekleniyor: her fare paketinde sormak köprüyü boğardı, pencere
taşındığında da en fazla 400 ms sonra hizalanıyor.

Host'ta pencere paylaşımı tamamen kapatılabiliyor.

## 7. Çözünürlük ve pencere yönetimi

### Host'un ekran çözünürlüğü

Host'ta **Ekran → Ekran Çözünürlüğü**, client'ta ayar panelinde **Host Çözünürlüğü**.
Desteklenen modlar gerçek sürücüden okunuyor (`EnumDisplaySettings`), değişiklik
`ChangeDisplaySettingsEx` ile uygulanıyor.

Kullanımı: oyun için host'u 1080p'ye düşürüp bant genişliğini ve kodlama yükünü
azaltmak; ya da 4K bir hosta 1440p'lik bir client'tan bakarken görüntüyü okunur
yapmak.

**İlk değişiklikten önceki mod saklanıyor** ve bağlantı bitince, program kapanırken
ya da "Eski çözünürlüğe dön" denince geri konuyor. Client'ın çözünürlük
değiştirmesi host tarafından tek bir anahtarla kapatılabiliyor.

### İzleme penceresi (client)

- **Yerleşim:** Sığdır (oran korunur) · Doldur (kırpar) · Esnet · 1:1
- **Pencere:** Pencereli · Büyüt · Tam ekran · **Gerçek boyut** (pencereyi host'un
  görüntü boyutuna oturtur, ekrana sığmıyorsa oranı koruyarak küçültür)
- Pencere boyutu ve konumu hatırlanıyor

İkinci imlecin oran hesabı yerleşim moduna göre yapılıyor; "Doldur" modunda kırpılan
alan hesaba katılmasa imleç kaymış konuma tıklardı.

### Host penceresi

Artık **yeniden boyutlandırılabilir** (v3.1.5'te 460×760 sabitti) ve boyutu
hatırlanıyor. Arayüz dört sekmeye ayrıldı: **Bağlantı · Ekran · Oturum · Program**.

## 8. Otomatik başlatma ve tek örnek

**Windows açılışında başlat**, her iki programda tek bir anahtar.

Host yönetici yetkisi istediği için başlangıç klasörü işe yaramaz — her açılışta UAC
istemi çıkar. Bunun yerine **Görev Zamanlayıcı**'da "en yüksek ayrıcalıklarla"
çalışan bir `ONLOGON` görevi oluşturuluyor (`schtasks /Create … /RL HIGHEST`).
KURULUM.md'de elle anlatılan adımlar artık tek düğmeye indi. Client'ta ise Electron'un
kendi oturum açma öğesi kullanılıyor.

İkisi de `--hidden` ile başlatılıyor: açılışta pencere hiç görünmüyor, doğrudan
tepsiye iniyor.

**Tek örnek kilidi.** Arka planda iki host çalışırsa ikisi de aynı kodla sunucuya
kaydolmaya çalışır, sunucu ikincisini "Bu kod zaten kullanımda" ile reddeder ve
kullanıcı neden bağlanamadığını anlamaz; üstelik iki girdi köprüsü aynı fareyi
sürer. Artık ikinci örnek başlatıldığında var olanın penceresi öne getirilip yeni
örnek kapanıyor. Client'ta da aynısı var (iki pencere aynı ayar dosyasına yazıyordu).

## 9. Ayarları dışa/içe aktarma

Her iki programda **Dışa aktar / İçe aktar**.

Host'ta taşınanlar: sunucu adresi, bağlantı kodu, parola, TURN bilgileri, bağlantı
modu, güvenilir cihaz listesi ve tüm tercihler. Client'ta: kayıtlı bağlantılar ve
tercihler (donanım kimliği ve pencere konumu makineye özgü olduğu için taşınmaz).

**Parola düz metin olarak dışa aktarılmıyor.** Taşınabilir scrypt kaydı (tuz + özet)
gidiyor: dosyayı ele geçiren parolayı öğrenemiyor, ama hedef makinede aynı parola
çalışmaya devam ediyor.

İçe aktarmada yalnızca tanınan alanlar alınıyor, dosyadaki fazlalıklar yok sayılıyor.

## 10. Otomatik güncelleme

`electron-updater` ile, **generic** sağlayıcı üzerinden. Kurulum dosyalarını ve
electron-builder'ın ürettiği `latest.yml` dosyasını kendi sunucunuzdaki bir dizine
koyuyorsunuz, adresi programa giriyorsunuz. Açılışta denetleniyor, yeni sürüm varsa
indiriliyor ve **Yeniden başlat ve kur** ile kuruluyor (ya da program kapanırken).

Adres boşken güncelleme tamamen sessizce kapalı. Taşınabilir (portable) sürüm
kendini güncelleyemez — kurulum dizini yoktur — ve bunu açıkça söylüyor.

Sunucu tarafı için nginx örneği KURULUM.md'de.

## 11. Sanal makine / VDS desteği

> "VDS kullanımında çöküyor" sorununun karşılığı.

Sanal makinelerde ve VDS'lerde GPU ya hiç yoktur ya da yazılım öykünmesidir;
Chromium'un donanım hızlandırması orada GPU sürecini çökertip programın hiç
açılmamasına yol açar. v4.0'da:

**1. Sanal makine algılama.** Kayıt defterinden BIOS bilgisi okunup (`SystemManufacturer`,
`SystemProductName`, `BIOSVendor`) VMware, VirtualBox, QEMU/KVM, Xen, Hyper-V,
Parallels, Proxmox, EC2, Google Compute gibi imzalar aranıyor. Sonuç ayar dosyasına
yazılıyor; sonraki açılışlarda hiç çalışmıyor. Karar `app.whenReady()`'den **önce**
verilmek zorunda, çünkü donanım hızlandırma Chromium ayağa kalkmadan kapatılmalı.

**2. Uyumluluk modu.** Etkinken `disableHardwareAcceleration` + `--disable-gpu` +
`--disable-gpu-compositing`. Otomatik / her zaman açık / kapalı olarak ayarlanabiliyor.

**3. GPU çökerse kendi kendine toparlama.** GPU süreci ölürse uyumluluk modu kalıcı
olarak açılıp program **bir kez** yeniden başlatılıyor. Ayar diske yazıldığı için
bu bir döngüye girmiyor.

**4. Sessiz yakalama yedeği.** Sanal makinelerde çoğu zaman ses aygıtı yoktur ve
`getDisplayMedia`'nın loopback ses isteği **tüm yakalamayı** düşürür — ekran hiç
paylaşılmaz. Artık sesli deneme başarısız olursa sessiz olarak yeniden deneniyor ve
durum günlüğe yazılıyor.

**5. Uzak masaüstü uyarısı.** Host bir RDP oturumunda çalışıyorsa arayüzde uyarı
şeridi çıkıyor: **oturumu kapatırsanız masaüstü yok olur**, ekran paylaşımı ve girdi
enjeksiyonu sessizce durur. Oturumu kapatmak yerine pencereyi kapatın.

**6. Günlük dosyası.** Program hiç açılmadığında ekran görüntüsü işe yaramıyor.
Konsol çıktısı, yakalanmamış hatalar, **renderer'daki hatalar**, GPU/renderer süreç
ölümleri ve sayfa yükleme hataları artık diske yazılıyor:

```
%APPDATA%\GameLink-Host\logs\host.log
%APPDATA%\GameLink\logs\client.log
```

Arayüzden tek tıkla açılıyor. 2 MB'ı geçince bir önceki dosyanın üzerine dönüyor.

## 12. Güvenlik: parola artık düz metin değil

v3.1.5'e kadar host parolası `config.json` içinde **düz metin** duruyordu. Artık
yalnızca tuzlanmış **scrypt** özeti saklanıyor.

Tel üzerindeki protokol değişmedi: client hâlâ `sha256(parola)` gönderiyor, host o
özeti tuzlayıp scrypt'ten geçirerek karşılaştırıyor. Karşılaştırma
`timingSafeEqual` ile yapılıyor.

Var olan düz metin parola **ilk açılışta bir kez** özete çevrilip dosyadan siliniyor
ve dosya hemen yeniden yazılıyor — düz metin bir sonraki ayar değişikliğine kadar
diskte kalmıyor. Parolanızı yeniden girmeniz gerekmiyor.

Ayrıca arayüze **Parolayı kaldır** düğmesi eklendi (yalnızca güvenilir cihazların
bağlanabildiği durum).

## 13. Mikrofon, kodek seçimi, genişletilmiş istatistikler

### Mikrofon (client → host)

Client'ın mikrofonu host'ta çalıyor; üst çubuktaki **🎤 Mikrofon** ile açılıp
kapanıyor. Yankı engelleme, gürültü bastırma ve otomatik kazanç açık.

**Yeniden pazarlık yok.** Host, teklife mikrofon için boş bir `recvonly` ses yuvası
koyuyor; client cevabı hazırlarken o yuvayı `sendonly` yapıp kendi mikrofonunu
takıyor. Mikrofon sonradan açılıp kapandığında sadece `replaceTrack` çağrılıyor —
SDP alışverişi tekrarlanmıyor, görüntü kesilmiyor.

Bu yuvanın **`addTrack`'ten sonra** açılması gerekiyor: `addTrack`, kendi türüne
uyan boş bir transceiver bulursa onu yeniden kullanıyor ve önceden açılmış yuvayı
ele geçiriyor — o zaman mikrofon için ayrı bir medya hattı hiç oluşmuyor. (Bu hata
geliştirme sırasında yazılan uçtan uca SDP testiyle yakalandı; bkz. Test durumu.)

### Video kodeği

Host'ta **Ekran → Video Kodeği**: Otomatik · H.264 · VP9 · VP8 · AV1. Kodeği teklifi
veren taraf belirlediği için ayar host'ta. Seçilen kodek sistemde yoksa sessizce
otomatik seçime dönülüyor ve günlüğe yazılıyor. Bir sonraki bağlantıda geçerli olur.

Client'ın istatistik kutusunda o an **hangi kodeğin kullanıldığı** görünüyor.

### İstatistikler

Eklenenler: kodek, ortalama kare çözme süresi, donma sayısı, bağlantı türü
(doğrudan / TURN röle).

## 14. Düzeltmeler

**Client'ta tepsi menüsü çökebiliyordu.** `showMainWindow` yok edilmiş bir pencereye
dokunuyordu — host'ta v3.1'de düzeltilen hata client'a taşınmamıştı. Artık
`isDestroyed()` kontrolü var ve pencere yok edildiğinde referans bırakılıyor.

**Client'ta "tepsiye in" ayarının anahtarı yoktu.** Tercih tanımlıydı ve
çalışıyordu ama arayüzde açıp kapatacak bir kontrol yoktu. Program ayarları
penceresine eklendi.

**Ölü paket dosyaları.** `client/renderer.bundle.js` (563 KB), `.map` (5.2 MB) ve
`host/renderer.bundle.js` (549 KB) klasörde duruyordu ama hiçbir HTML bunları
yüklemiyordu — ikisi de `renderer.js` çağırıyor. Silindi.

**`DEGISIKLIKLER-v3.0.md`'nin başlığı** `# GameLink v2.5` yazıyordu (dosya v2.5'ten
yeniden adlandırılmış, içeriği güncellenmemiş). Düzeltildi.

**Sohbet kutusuna yazarken tuşlar host'a gidiyordu.** Girdi yakalama, odak bir metin
alanındayken artık devreye girmiyor.

**Boş `hostPassword` alanı** ayar dosyasında kalıyordu; artık temizleniyor.

## 15. Protokol eklentileri

`control` veri kanalı (güvenilir):

| Mesaj | Yön | Anlamı |
|---|---|---|
| `{t:'hello', version, features}` | ↔ | Sürüm ve yetenek bildirimi (hangi özellikler açık) |
| `{t:'chat', text}` | ↔ | Yazışma |
| `{t:'sysinfo', info}` | host→client | Statik sistem bilgisi (bir kez) |
| `{t:'sys', cpu, mem, disk, net}` | host→client | Anlık kullanım (250 ms) |
| `{t:'sysinfo-off'}` | host→client | Host paylaşımı kapattı |
| `{t:'get-res'}` / `{t:'modes', allowed, modes, current}` | ↔ | Ekran modu listesi |
| `{t:'set-res', w, h, hz}` / `{t:'set-res', restore:true}` | client→host | Çözünürlük değiştir / geri al |
| `{t:'res-result', ok, reason}` | host→client | Sonuç |
| `{t:'rec', on}` / `{t:'rec-state', on, since}` | ↔ | Host tarafı kayıt |

`sources` mesajındaki her girdiye `kind` alanı eklendi (`'screen'` \| `'window'`).

`files` veri kanalı (**yeni**, güvenilir + sıralı) — JSON denetim satırları ve ikili
parçalar aynı kanaldan:

| Mesaj | Anlamı |
|---|---|
| `{k:'offer', id, name, size}` | Dosya teklifi |
| `{k:'accept', id}` / `{k:'reject', id, reason}` | Karar |
| *(ikili)* | 64 KB'lık parça |
| `{k:'end', id}` / `{k:'ok', id}` | Gönderim bitti / yazma bitti |
| `{k:'cancel', id, reason}` | İptal |
| `{k:'pause'}` / `{k:'resume'}` | Alıcı tarafı akış denetimi |

`input-bridge.ps1` yeni stdin komutları (yanıtları stdout'a JSON satırı olarak
yazılıyor, `id` ile eşleştiriliyor):

| Komut | Yanıt |
|---|---|
| `{t:'wr', id, hwnd}` | `{t:'wr', id, r:[x,y,w,h]}` — pencere sınırı (fiziksel piksel) |
| `{t:'dm', id, x, y}` | `{t:'dm', id, dev, cur, modes}` — ekran modları |
| `{t:'ds', id, dev, w, h, hz}` | `{t:'ds', id, code}` — çözünürlük ayarla (0 = başarılı) |

`sysinfo-bridge.ps1` (**yeni**) stdout'a: `{t:'static',…}` bir kez,
`{t:'tick', disk, net}` 250 ms'de bir, `{t:'disks',…}` 30 saniyede bir.

## 16. Değişen dosyalar

```
YENİ
host/sysinfo-bridge.ps1     sistem sayaçları köprüsü (yerelleştirme çevirisiyle)
host/session.html           oturum penceresi
host/session.js             oturum penceresi mantığı
host/session-preload.js     oturum penceresi köprüsü
host/theme.css              ortak tema tokenleri (ana pencere + oturum penceresi)
host/file-transfer.js       dosya aktarım motoru
host/file-io.js             ana süreç dosya G/Ç'si
host/platform.js            günlük, sanal makine tespiti, güncelleyici
client/file-transfer.js     (host'takinin birebir kopyası)
client/file-io.js           (host'takinin birebir kopyası)
client/platform.js          (host'takinin birebir kopyası)
DEGISIKLIKLER-v4.0.md       bu dosya

DEĞİŞEN
host/input-bridge.ps1       GetWindowRect/DwmGetWindowAttribute, EnumDisplaySettings,
                            ChangeDisplaySettingsEx, JSON yanıt kanalı
host/main.js                tek örnek kilidi, günlük, VM modu, oturum penceresi,
                            sysinfo köprüsü, pencere yakalama, çözünürlük,
                            otomatik başlatma, dışa/içe aktarma, güncelleyici,
                            scrypt parola, pencere boyutu hafızası
host/preload.js             yeni API yüzeyi + fileIO
host/renderer.js            sekmeler, sohbet, dosya, kayıt, kodek, mikrofon yuvası,
                            oturum köprüsü, çözünürlük, istatistik
host/index.html             YENİDEN YAZILDI — sekmeli düzen, yeni kartlar
host/package.json           4.0.0, electron-updater, sysinfo-bridge asarUnpack, publish

client/main.js              tek örnek kilidi, günlük, VM modu, otomatik başlatma,
                            dışa/içe aktarma, güncelleyici, pencere boyutu/oturma,
                            tepsi düzeltmesi
client/preload.js           yeni API yüzeyi + fileIO
client/renderer.js          oturum paneli (sohbet/dosya/sistem), QoS HUD, kayıt,
                            yerleşim ve pencere modları, uzak çözünürlük, mikrofon,
                            genişletilmiş istatistik, program ayarları penceresi
client/index.html           YENİDEN YAZILDI — oturum paneli, HUD, ayar penceresi
client/package.json         4.0.0, electron-updater, publish

SİLİNEN
client/renderer.bundle.js, client/renderer.bundle.js.map, host/renderer.bundle.js
```

`server/` bu sürümde de değişmedi. Sunucunuza dokunmanıza gerek yok.

## 17. Nasıl güncellenir

```powershell
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"

cd host
npm install
npm run build

cd ..\client
npm install
npm run build
```

`npm install` bu sürümde **gerekli**: `electron-updater` yeni bir bağımlılık.

Sonra `dist` klasöründeki kurulum dosyalarını çalıştırın. Kurulum yolu ve ürün adı
v3.1.5'ten beri aynı, ayarlarınız yerinde kalır ve parolanız ilk açılışta
kendiliğinden özete taşınır.

**Görev Zamanlayıcı görevini elle kurduysanız** artık gerek yok: eskisini silip
Program sekmesindeki anahtarı kullanabilirsiniz (görev adı `GameLink-Host`).

## 18. Test durumu

### Bu ortamda gerçekten çalıştırılıp doğrulananlar

**PowerShell köprüleri**
- `input-bridge.ps1` C# derlemesi geçti; `dm` komutu bu makinenin ekran modlarını
  gerçekten döndürdü (28 mod, aygıt `\\.\DISPLAY1`, güncel mod 1920×1080@59)
- `wr` komutu geçersiz pencere tanıtıcısında doğru şekilde `null` döndürdü
- `sysinfo-bridge.ps1`: sayaç adı çevirisi doğrulandı — bu makinede
  `PhysicalDisk → FizikselDisk`, `% Disk Time → % Disk Zamanı`. Sabit İngilizce ad
  yazılsaydı sessizce çalışmayacaktı
- Kararlı durum ölçümü: **267 ms/tur**, tek çekirdeğin **%3.3'ü**, 99 MB
- Statik bilgi (işlemci, ekran kartı, işletim sistemi, disk, sanal makine tespiti)
  doğru geldi

**Uçtan uca (gerçek sinyal sunucunuz üzerinden)**
- Host sunucuya kaydoldu, sahte bir client katılma isteği gönderdi
- **scrypt parola doğrulaması** çalıştı, host kabul etti
- Host'un ürettiği SDP teklifi incelendi:
  - 4 medya hattı: `audio/sendonly` (sistem sesi), `video/sendonly`,
    `audio/recvonly` (mikrofon yuvası), `application` (veri kanalları)
  - ICE sunucu listesi ve taşıma politikası teklifle birlikte geldi
  - **Kodek tercihi uygulandı**: H.264 payload listesinde ilk sırada
  - SCTP taşıması bildirildi
- **Bu test bir hata buldu:** mikrofon yuvası `addTrack`'ten önce açıldığı için
  loopback ses izi tarafından ele geçiriliyordu ve mikrofon hattı hiç oluşmuyordu.
  Düzeltildi, test yeniden geçti

**Dosya aktarım motoru** (iki motor örneği sahte bir veri kanalı çiftiyle
birbirine bağlanıp gerçek dosyalar aktarıldı; doğrulama SHA-256 ile)

| Senaryo | Sonuç |
|---|---|
| 12 MB tek dosya | Özet birebir aynı, 253 ms |
| 5 dosyalık kuyruk (7 bayt – 2 MB) | Hepsi sırayla ve bozulmadan geldi |
| Alıcı diski yavaş (parça başına 8 ms) | Bütünlük korundu — `pause`/`resume` freni devreye girdi |
| Alıcı reddetti | Diske hiç yazılmadı, gönderen hata olarak işaretledi |
| Aktarım ortasında iptal | Yarım dosya diskte bırakılmadı |
| Ad sterilizasyonu | `..\..\Windows\System32\evil.dll` → `evil.dll`, `CON.txt` → `_CON.txt`, normal adlar korundu |

**Programlar**
- Host ve client açıldı, renderer'da tek bir hata bile yok (yalnızca Electron'un
  paketlenmiş sürümde çıkmayan standart CSP uyarısı)
- Host gerçek sinyal sunucusuna bağlanıp kodla kaydoldu
- Girdi köprüsü önbellekten yüklendi (`SIM-CACHED`) ve hazır oldu
- Host süreci **zorla** öldürüldüğünde köprü de kapandı — yetim PowerShell kalmıyor
- Parola taşıma yolu ve boş `hostPassword` temizliği doğrulandı

**Tutarlılık denetimleri** (otomatik betikle)
- Tüm `.js` ve `.json` dosyalarının söz dizimi
- HTML ↔ JS eleman kimlikleri: host 58, oturum penceresi 21, client 86 — eksik yok
- preload API yüzeyi: renderer'ların çağırdığı 68 API'nin tamamı sunuluyor
- IPC kanalları: preload'un çağırdığı 78 kanalın tamamı ana süreçte karşılanıyor

### Sizin makinenizde ilk kez denenecekler

Bunlar iki gerçek makine arasında bir oturum gerektirdiği için burada
çalıştırılamadı:

- Dosya aktarımının gerçek bir bağlantıda hızı ve akış denetimi
- Yazışma ve oturum penceresinin akışı
- Host PC bilgi panelinin ve etkinlik ışıklarının canlı görünümü
- İki taraflı ekran kaydı
- Pencere yakalama + o moddaki ikinci imleç hizalaması
- Uzaktan çözünürlük değişimi ve bağlantı bitince geri dönmesi
- Mikrofonun host'ta duyulması
- Otomatik başlatma görevinin oluşması ve açılışta çalışması
- Otomatik güncellemenin gerçek bir sunucu adresiyle çalışması
- **VDS/sanal makine davranışı** — uyumluluk modunun çökmeyi gerçekten önlemesi

Sorun çıkarsa artık ekran görüntüsü yerine **günlük dosyasını** gönderin
(Program → Günlük dosyasını aç): renderer hataları ve süreç ölümleri de orada.

## 19. Bilinen sınırlar

Önceki sürümlerden devam edenler:

- **UAC onay penceresi** kontrol edilemez (ayrı bir masaüstünde çalışır, UIAccess
  ve Microsoft'un güvendiği bir imza ister)
- **İkinci imleç oyunlarda çalışmaz** — ham girdi kullanan oyunlar mutlak fare
  konumunu yok sayar
- **Mobil veriden (CGNAT) bağlanmak** TURN sunucusu ister

v4.0'a özgü olanlar:

- **Pencere yakalamada ikinci imleç 400 ms gecikmeyle hizalanır.** Pencereyi
  sürüklerken imleç kısa süre kayabilir.
- **Pencere yakalamada minimize edilmiş pencere paylaşılamaz.** Windows minimize
  bir pencerenin içeriğini vermez.
- **Host tarafı kayıt, paylaşılan kaynak değişince durur.** `MediaRecorder`
  akıştaki track değişimini izleyemiyor.
- **Ekran çözünürlüğü değişimi ekranı bir an karartır** ve açık pencerelerin
  yerleşimini bozabilir; bu Windows'un davranışı.
- **Otomatik güncelleme bir sunucu ister.** GitHub Releases kullanılmıyor;
  paketleri kendi sunucunuza koymanız gerekiyor.
- **Disk etkinliği bazı VDS şablonlarında ölçülemez** (performans sayacı kaydı
  eksik olabiliyor). O durumda disk ışığı gizleniyor, gerisi çalışıyor.
- **`file-transfer.js`, `file-io.js` ve `platform.js` host ve client altında
  birebir kopyadır.** İki ayrı Electron uygulaması olduğu ve paket dosya listesi
  kendi klasörlerini kapsadığı için ortak bir klasörden yüklenemiyorlar. Birini
  değiştirirken diğerini de değiştirin.
