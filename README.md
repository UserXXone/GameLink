# GameLink

Düşük gecikmeli uzak masaüstü ve oyun akışı. İki Windows bilgisayar arasında
ekran, ses, fare ve klavyeyi doğrudan (P2P) taşır — görüntü aracı bir sunucudan
geçmez.

**Güncel sürüm: v3.1.5**

| | |
| 📘 **Sıfırdan kurulum** | **[KURULUM.md](KURULUM.md)** — sunucu, DuckDNS, sertifika, host, client, TURN, otomatik başlatma, sorun giderme |
| 🆕 Bu sürümde ne değişti | [DEGISIKLIKLER-v3.1.5.md](DEGISIKLIKLER-v3.1.5.md) |

---

## Ne işe yarar?

- **Oyun akışı** — ham fare girdisi doğru aktarıldığı için oyunlarda kamera düzgün döner
- **Uzak masaüstü** — ikinci imleç modunda host'un sahibi kendi faresiyle çalışmaya devam edebilir
- **Yönetici pencereleri** — Görev Yöneticisi, Kayıt Defteri gibi yükseltilmiş pencereler kontrol edilebilir
- **Pano eşitleme**, çoklu monitör, sistem sesi, ayarlanabilir kalite/gecikme profilleri

## Üç parça

```
[ CLIENT ] ←── sinyalleşme ──→ [ SUNUCU ] ←── sinyalleşme ──→ [ HOST ]
     └──────────── video + ses + girdi doğrudan (P2P) ────────────┘
```

| Klasör | Nedir | Nereye kurulur |
|---|---|---|
| `host/` | Ekranını paylaşan, girdiyi uygulayan taraf | Kontrol edilecek Windows makine |
| `client/` | Görüntüyü izleyen, girdiyi gönderen taraf | Sizin kullandığınız makine |
| `server/` | Sadece buluşturucu (video buradan geçmez) | VPS ya da 7/24 açık bir makine |

## Hızlı kurulum

Ayrıntılar için [KURULUM.md](KURULUM.md); özet:

```powershell
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"

cd host
npm install
npm run build      # dist\GameLink-Host-Kurulum.exe

cd ..\client
npm install
npm run build      # dist\GameLink-Kurulum.exe
```

Varsayılan kurulum yolları (v3.1.5'ten itibaren boşluksuz):

```
C:\GameLink\Host\GameLink-Host.exe
C:\GameLink\Client\GameLink.exe
```

Sunucu için:

```bash
cd server
npm install --omit=dev
node server.js        # varsayılan port 8080
```

## Sürüm geçmişi

| Sürüm | Ana konu |
|---|---|
| [v3.1.5](DEGISIKLIKLER-v3.1.5.md) | Açılış hızı, açık/koyu tema, renkli arayüz, boşluksuz kurulum yolları |
| [v3.1](DEGISIKLIKLER-v3.1.md) | İkinci imleç — host kullanıcısı kendi faresiyle çalışmaya devam edebilir |
| [v3.0](DEGISIKLIKLER-v3.0.md) | Bağlantı modu seçici (STUN/TURN), yönetici yetkisi, sistem tepsisi |

## Gereksinimler

- Windows 10/11 (host ve client)
- Node.js 20 LTS veya üzeri (yalnızca derlemek için)
- Bir alan adı ve sinyalleşme sunucusu — [KURULUM.md](KURULUM.md) ücretsiz yolu da anlatır

## Bilinen sınırlar

- **UAC onay penceresi** kontrol edilemez. Ayrı bir masaüstünde ("secure desktop")
  çalışır ve oraya erişim, Microsoft'un güvendiği bir sertifikayla imzalanmış
  uygulama gerektirir (UIAccess). Ekranda UAC çıkarsa host'ta fiziksel onay gerekir.
- **İkinci imleç oyunlarda çalışmaz.** Ham girdi kullanan oyunlar mutlak fare
  konumunu yok sayar; oyun için "Tek imleç" modunda kalın.
- **Mobil veriden (CGNAT) bağlanmak** TURN sunucusu ister.
