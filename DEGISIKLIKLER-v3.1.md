# GameLink v3.1 — İkinci İmleç

> v3.0'ın üzerine eklenen özellik.

## Kısaca

Client artık host'un imlecini **ele geçirmek zorunda değil**. Yeni "İkinci imleç"
modunda ekranda size ait ayrı bir ok belirir; host kullanıcısı kendi faresiyle
çalışmaya devam eder.

Mod, client'ta **Ayarlar → İmleç** bölümünden seçilir ve anında host'a bildirilir.

| | 🎯 Tek imleç (varsayılan) | 🖱️ İkinci imleç |
|---|---|---|
| Nasıl çalışır | Fare kilidi + göreli hareket, host'un **gerçek** imleci sürülür | Mutlak konum, host'un gerçek imlecine dokunulmaz |
| Host kullanıcısı aynı anda çalışabilir mi | Hayır, imleç paylaşılır | **Evet** |
| Oyunlar | ✅ Tek doğru seçenek | ❌ Çalışmaz (ham girdi/kamera dönüşü) |
| Masaüstü işleri | Çalışır ama imleç kavgası olur | ✅ Asıl kullanım alanı |
| Fare kilidi / tam ekran gerekir mi | Evet | Hayır |

---

## Neden "gerçekten" iki imleç değil

Windows'ta bir masaüstü oturumunda **tek bir sistem imleci** vardır. Bu bir uygulama
kısıtı değil, işletim sisteminin tasarımı: `SetCursorPos`, `GetCursorPos`, pencere
hit-test'i, hover, odak — hepsi tek imleç varsayar. Tamamen bağımsız ikinci bir
imleç ancak **ayrı bir oturumda** (RDP / ikinci kullanıcı oturumu) mümkün, ki bu da
"aynı ekranı birlikte kullanmak" fikrinin tam tersi olurdu.

Bu yüzden ikinci imleç **taklit** ediliyor ve üç parçadan oluşuyor:

1. **Konum** yalnızca yazılımda tutulur. İmleci hareket ettirdiğinizde host'un gerçek
   imlecine hiç dokunulmaz — sahibi kesintisiz çalışır.
2. **Görünürlük**: host'ta tıklama geçirgen, odaklanamayan küçük bir katman penceresi
   mavi "2" işaretli oku çizer (`host/overlay.html`). Pencere `setContentProtection`
   ile ekran paylaşımından hariç tutulur; client kendi imlecini yerel olarak çizdiği
   için görüntüde çift ok olmaz.
3. **Tıklama**: bir tıklama ancak imlecin *altındaki* pencereye gider. O yüzden
   tıklama anında gerçek imleç birkaç milisaniye **ödünç alınır**:

```
BlockInput(true)          <- fiziksel fare/klavye dondurulur (SendInput hariç)
  eski konum kaydedilir
  imleç hayaletin konumuna götürülür
  tıklama enjekte edilir
  imleç eski konumuna geri konur
BlockInput(false)
```

`BlockInput`, onu çağıran thread'in `SendInput` çağrılarını engellemez — ödünç alma
bu yüzden atomik olabiliyor. Host yönetici olarak çalıştığı için (`requireAdministrator`)
bu çağrı geçerli; olmasa bile sessizce devre dışı kalır, tıklama yine çalışır.

## Bilinen ve kabul edilen sınırlar

- **Sürükleme boyunca imleç sizde kalır.** Butonu basılı tuttuğunuz sürece gerçek
  imleç hayaleti izlemek zorunda; bıraktığınızda kaydedilen konuma döner. Sürükleme
  yarıda koparsa (bağlantı düşerse, Alt+Tab yaparsanız) köprü butonu bırakıp imleci
  iade eder.
- **Odak paylaşılır.** Tıkladığınızda o pencere öne gelir; host kullanıcısının
  yazdığı yerden odak gider. Windows'ta bunun etrafından dolaşmanın yolu yok.
- **Hover/tooltip takip etmez.** Fare üstüne gelme efektleri gerçek imlecin olduğu
  yerde tetiklenir, hayaletin olduğu yerde değil.
- **Oyunlarda çalışmaz.** Ham girdi (raw input) kullanan oyunlar mutlak konumu
  yok sayar. Oyun için "Tek imleç" modunda kalın — bu yüzden varsayılan o.
- **Tekerlek titreşimi.** Kaydırma sırasında imleç hızlıca gidip geliyor; host
  kullanıcısı bunu fark edebilir.
- Katman penceresinin ekran paylaşımından hariç tutulması Windows 10 2004+ ister.
  Daha eskisinde client, kendi imlecinin arkasından gelen ikinci bir ok görebilir —
  işlevsel bir sorun değil.

## Doğruluk detayları

- **DPI.** `SetCursorPos`, DPI farkında olmayan bir süreçte ölçeklenmiş koordinatlar
  kullanır. `input-bridge.ps1` artık başlangıçta `SetProcessDpiAwarenessContext`
  (PER_MONITOR_AWARE_V2) çağırıyor ve Electron tarafı `screen.dipToScreenPoint` ile
  gerçek piksel gönderiyor. %125/%150 ölçekli ekranlarda ikinci imleç kaymıyor.
- **Çoklu monitör.** Konum, paylaşılan monitörün sınırlarına göre oranlanıyor
  (`captureDisplay()`), monitör değiştirilince otomatik takip ediyor.
- **Letterbox.** Video `object-fit: contain` ile çizildiği için etrafında siyah bant
  olabilir; oran bant alanına göre değil gerçek görüntü alanına göre hesaplanıyor
  (`videoContentRect()`).
- **Paket hızı.** Konum güncellemeleri `requestAnimationFrame` ile birleştiriliyor:
  fare 1000 Hz olsa bile veri kanalına saniyede ~60 paket gidiyor. Tıklama ve
  tekerlekten hemen önce bekleyen konum zorla gönderiliyor.

## Protokol eklentileri

`mouse` veri kanalı (güvenilmez):

| Mesaj | Anlamı |
|---|---|
| `{t:'gp', u, v}` | Hayalet imleç konumu, paylaşılan ekranın oranı (0..1) |
| `{t:'gb', btn, down}` | Hayalet imleçle tıklama (ödünç alma yapılır) |
| `{t:'gw', delta, h}` | Hayalet imleçle tekerlek |

`control` veri kanalı (güvenilir):

| Mesaj | Anlamı |
|---|---|
| `{t:'cursor-mode', mode}` | `'single'` \| `'ghost'` — bağlantı kurulunca ve her değişimde |

`input-bridge.ps1` stdin komutları: `gp`, `gb`, `gw` ve `gx` (hayalet modu kapat,
yarım kalan sürüklemeyi bitir, gerçek imleci iade et).

## Bu sürümde birlikte düzeltilenler

- Host penceresi gerçekten kapatıldığında referans temizlenmiyordu; tepsi menüsü
  yok edilmiş pencereye dokununca `Object has been destroyed` ile çöküyordu.
  Artık `closed` olayında referans bırakılıyor ve `showMainWindow` `isDestroyed()`
  kontrolü yapıyor.
- Çıkışta ve bağlantı kapanışında hayalet sürükleme kalıntısı temizleniyor;
  köprü süreci ölse bile `finally` bloğunda `BlockInput(false)` çağrılıyor —
  fiziksel girdi hiçbir koşulda kilitli kalmıyor.

## Değişen dosyalar

```
host/input-bridge.ps1   DPI farkındalığı, SetCursorPos/GetCursorPos/BlockInput,
                        Borrow-Begin/End, Ghost-Button, Ghost-Wheel, gx komutu
host/overlay.html       YENİ — ikinci imlecin host'ta görünen oku
host/main.js            katman penceresi, kaynak->monitör eşlemesi, dipToScreenPoint,
                        ghost-* IPC, pencere 'closed' düzeltmesi
host/preload.js         setGhostMode / ghostMove / ghostButton / ghostWheel
host/renderer.js        gp/gb/gw yönlendirmesi, cursor-mode kontrol mesajı
host/index.html         "İmleç" kartı (durum göstergesi)
client/renderer.js      ghost yakalama, videoContentRect, rAF birleştirme,
                        mod duyarlı buton gönderimi, imleç modu seçimi
client/index.html       "İmleç" seçim düğmeleri + özel imleç görseli
client/main.js          cursorMode tercihi
```
