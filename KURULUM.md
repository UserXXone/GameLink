# GameLink — Sıfırdan Kurulum Kılavuzu

**Sürüm: v4.0** · Hiçbir ön bilgi varsayılmadan, en baştan anlatılmıştır.
Komutları olduğu gibi kopyalayıp yapıştırabilirsiniz; her adımda "ne yaptık, neden
yaptık" ve "doğru gitti mi nasıl anlarım" yazıyor.

---

## İÇİNDEKİLER

- [0. Önce şunu anlayın: sistem neyden oluşuyor?](#0-önce-şunu-anlayın-sistem-neyden-oluşuyor)
- [1. Sözlük — geçen terimler ne demek?](#1-sözlük--geçen-terimler-ne-demek)
- [2. Neye ihtiyacınız var?](#2-neye-ihtiyacınız-var)
- [3. BÖLÜM A — Node.js kurulumu (her iki Windows makinede)](#3-bölüm-a--nodejs-kurulumu-her-iki-windows-makinede)
- [4. BÖLÜM B — Sinyal sunucusu](#4-bölüm-b--sinyal-sunucusu)
  - [B1. Hangi yolu seçmeliyim?](#b1-hangi-yolu-seçmeliyim)
  - [B2. Yol 1 — Ev bilgisayarında sunucu (ücretsiz)](#b2-yol-1--ev-bilgisayarında-sunucu-ücretsiz)
  - [B3. Yol 2 — VPS'te sunucu (önerilen)](#b3-yol-2--vpste-sunucu-önerilen)
- [5. BÖLÜM C — DuckDNS (ücretsiz alan adı)](#5-bölüm-c--duckdns-ücretsiz-alan-adı)
- [6. BÖLÜM D — HTTPS/WSS sertifikası (Let's Encrypt)](#6-bölüm-d--httpswss-sertifikası-lets-encrypt)
- [7. BÖLÜM E — Host kurulumu (kontrol edilecek bilgisayar)](#7-bölüm-e--host-kurulumu-kontrol-edilecek-bilgisayar)
- [8. BÖLÜM F — Client kurulumu (kontrol eden bilgisayar)](#8-bölüm-f--client-kurulumu-kontrol-eden-bilgisayar)
- [9. BÖLÜM G — Host'u otomatik başlatma](#9-bölüm-g--hostu-otomatik-başlatma)
- [10. BÖLÜM H — TURN sunucusu (mobil veri / CGNAT için)](#10-bölüm-h--turn-sunucusu-mobil-veri--cgnat-için)
- [11. BÖLÜM I — Günlük kullanım](#11-bölüm-i--günlük-kullanım)
- [12. BÖLÜM J — Otomatik güncelleme sunucusu](#12-bölüm-j--otomatik-güncelleme-sunucusu)
- [13. BÖLÜM K — Sanal makine / VDS üzerinde çalıştırma](#13-bölüm-k--sanal-makine--vds-üzerinde-çalıştırma)
- [14. BÖLÜM L — Sorun giderme](#14-bölüm-l--sorun-giderme)
- [15. v4.0 ile gelen yenilikler](#15-v40-ile-gelen-yenilikler)

---

## 0. Önce şunu anlayın: sistem neyden oluşuyor?

GameLink **üç parçadan** oluşur. Üçünü de kurmanız gerekir:

```
   [ CLIENT ]                  [ SUNUCU ]                  [ HOST ]
  Sizin elinizdeki          Küçük bir aracı           Uzaktan kontrol
  bilgisayar/laptop         (buluşma noktası)         edilecek bilgisayar
       │                          │                          │
       │  1) "8798-5F7B kodlu     │   2) "biri bağlanmak     │
       │      makineye bağlan"    │       istiyor"           │
       ├─────────────────────────►├─────────────────────────►│
       │                          │                          │
       │  3) Parola doğruysa host kabul eder, iki taraf       │
       │     birbirinin adresini öğrenir                      │
       │◄─────────────────────────┤◄─────────────────────────┤
       │                          │                          │
       │  4) EKRAN GÖRÜNTÜSÜ VE FARE/KLAVYE ARTIK DOĞRUDAN    │
       │     İKİ BİLGİSAYAR ARASINDA AKAR (P2P)               │
       ├──────────────────────────────────────────────────────┤
                              (sunucu devrede değil)
```

**Çok önemli:** Sunucudan **video geçmez**. Sunucu sadece iki bilgisayarın birbirini
bulmasını sağlayan bir "telefon rehberi"dir. Bu yüzden çok küçük, çok ucuz bir
sunucu yeter — hatta evdeki bir bilgisayar bile olur.

| Parça | Nereye kurulur | Ne işe yarar |
|---|---|---|
| **Sunucu** (`server/`) | Bir VPS ya da evdeki bir bilgisayar. 7/24 açık olmalı. | Host ile client'ı buluşturur |
| **Host** (`host/`) | Uzaktan kontrol edilecek Windows bilgisayar | Ekranını paylaşır, gelen fare/klavyeyi uygular |
| **Client** (`client/`) | Sizin kullandığınız Windows bilgisayar | Görüntüyü izler, fare/klavye gönderir |

---

## 1. Sözlük — geçen terimler ne demek?

| Terim | Basitçe ne demek |
|---|---|
| **Host** | Uzaktan **kontrol edilen** bilgisayar (evdeki oyun bilgisayarınız) |
| **Client** | Uzaktan **kontrol eden** bilgisayar (laptop'unuz) |
| **Sinyal sunucusu** | İki bilgisayarı buluşturan aracı program |
| **P2P** | "Peer to peer" — iki bilgisayarın aracısız, doğrudan konuşması |
| **WebRTC** | Görüntü/sesi düşük gecikmeyle taşıyan teknoloji |
| **STUN** | "Benim internetteki adresim ne?" diye soran ücretsiz servis |
| **TURN** | Doğrudan bağlantı kurulamazsa trafiği üzerinden geçiren röle sunucu |
| **CGNAT** | Operatörün size gerçek bir IP vermemesi (mobil veride yaygın). Bu durumda TURN gerekir |
| **VPS** | Kiralık sanal sunucu (aylık ~4-5 $) |
| **DuckDNS** | Ücretsiz alan adı veren servis (`adiniz.duckdns.org`) |
| **wss://** | Şifreli WebSocket adresi. Client sunucuya bununla bağlanır |
| **Port yönlendirme** | Modemin, dışarıdan gelen bağlantıyı içerideki bir bilgisayara aktarması |

---

## 2. Neye ihtiyacınız var?

**Kesinlikle gerekli**

- 2 adet Windows 10/11 bilgisayar (biri host, biri client)
- Host bilgisayarda yönetici hesabı
- 7/24 açık kalacak bir sunucu yeri (VPS veya evdeki bir makine)
- Bir alan adı (DuckDNS ile ücretsiz)

**İsteğe bağlı**

- TURN sunucusu — yalnızca mobil veriden bağlanacaksanız
- Host'un elektrik kesintisinden sonra kendi kendine açılması isteniyorsa BIOS ayarı

**Kurulum ne kadar sürer?** İlk kez yapıyorsanız 1-2 saat. Acele etmeyin.

---

## 3. BÖLÜM A — Node.js kurulumu (her iki Windows makinede)

Programları kaynaktan derleyeceğimiz için Node.js gerekli.

1. Tarayıcıda **<https://nodejs.org>** adresine gidin.
2. **LTS** yazan büyük yeşil düğmeye tıklayın (şu an 20.x veya 22.x).
3. İnen `.msi` dosyasını çalıştırın. Hiçbir ayarı değiştirmeyin, hep **Next → Next → Install**.
4. Kurulum bitince **yeni bir PowerShell penceresi** açın (eski pencereler yeni kurulumu görmez):
   - `Win + R` → `powershell` → Enter
5. Şunu yazıp Enter'a basın:

```powershell
node -v
npm -v
```

**Doğru gitti mi?** Ekranda iki satır sürüm numarası görmelisiniz (`v20.11.0` gibi).
"tanınmıyor" hatası alıyorsanız bilgisayarı yeniden başlatıp tekrar deneyin.

---

## 4. BÖLÜM B — Sinyal sunucusu

### B1. Hangi yolu seçmeliyim?

| | Yol 1: Ev bilgisayarı | Yol 2: VPS (önerilen) |
|---|---|---|
| Ücret | Ücretsiz | Aylık ~4-5 $ |
| Zorluk | Orta (modem ayarı gerekir) | Kolay |
| Güvenilirlik | Elektrik/internet kesilirse çalışmaz | 7/24 |
| Gereken | Modem yönetici şifresi, sabit iç IP | SSH bilgisi (kılavuzda var) |

> **Tavsiye:** Uzaktan bağlantının amacı "ev kapalıyken de erişmek" olduğundan,
> evdeki internetin kesildiği anda sinyal sunucusunun da ölmesi kötü bir senaryodur.
> Bütçeniz varsa **Yol 2**'yi seçin.

---

### B2. Yol 1 — Ev bilgisayarında sunucu (ücretsiz)

Sunucuyu host bilgisayarın kendisinde de çalıştırabilirsiniz.

**Adım 1 — Sunucuyu başlatın**

```powershell
cd C:\GameLink-Kaynak\server
npm install
node server.js
```

Ekranda şuna benzer bir satır görmelisiniz:

```
GameLink sinyalleşme sunucusu 8080 portunda
```

**Adım 2 — Windows Güvenlik Duvarı'na izin verin**

Yönetici PowerShell'de (Başlat → PowerShell'e sağ tık → **Yönetici olarak çalıştır**):

```powershell
New-NetFirewallRule -DisplayName "GameLink Signaling" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow
```

**Adım 3 — Aynı ev ağında hızlı test**

Bilgisayarın yerel IP'sini öğrenin:

```powershell
ipconfig | Select-String "IPv4"
```

Çıkan adres `192.168.1.35` gibi bir şey olacak. Client'ta sunucu adresi olarak
`ws://192.168.1.35:8080` yazıp deneyin.

> ⚠️ Bu yalnızca **aynı ev ağında** ve **şifresiz** bir denemedir. İnternet üzerinden
> kullanacaksanız [BÖLÜM C](#5-bölüm-c--duckdns-ücretsiz-alan-adı) ve
> [BÖLÜM D](#6-bölüm-d--httpswss-sertifikası-lets-encrypt) adımlarını mutlaka yapın.
> Bağlantı `ws://` ile kurulmuyorsa da doğrudan `wss://` kurulumuna geçin.

**Adım 4 — Modemde port yönlendirme**

Dışarıdan erişim için modeminizde 8080 (ve TLS kuracaksanız 80 + 443) portlarını
bu bilgisayara yönlendirmelisiniz:

1. Tarayıcıda `192.168.1.1` (bazı modemlerde `192.168.0.1`) adresine gidin
2. Modem kullanıcı adı/şifresi ile girin (genelde modemin altındaki etikette yazar)
3. **Port Forwarding / Port Yönlendirme / NAT** bölümünü bulun
4. Yeni kural ekleyin:
   - Dış port: `443` → İç IP: `192.168.1.35` → İç port: `443`
   - Dış port: `80` → İç IP: `192.168.1.35` → İç port: `80`
5. Kaydedin

**Adım 5 — Bilgisayar açılınca sunucu da açılsın**

Yönetici PowerShell'de:

```powershell
$action  = New-ScheduledTaskAction -Execute "node.exe" -Argument "server.js" -WorkingDirectory "C:\GameLink-Kaynak\server"
$trigger = New-ScheduledTaskTrigger -AtStartup
$set     = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "GameLink-Server" -Action $action -Trigger $trigger -Settings $set -User "SYSTEM" -RunLevel Highest
```

---

### B3. Yol 2 — VPS'te sunucu (önerilen)

**Adım 1 — VPS kiralayın**

Hetzner, Contabo, DigitalOcean, Vultr, Linode ya da yerli sağlayıcılar olur.
**En küçük paket fazlasıyla yeter** (1 vCPU / 1 GB RAM). İşletim sistemi olarak
**Ubuntu 22.04** veya **24.04** seçin.

Kiraladıktan sonra size şunlar verilir:
- Sunucunun IP adresi (`203.0.113.45` gibi)
- `root` kullanıcı şifresi (veya SSH anahtarı)

**Adım 2 — Sunucuya bağlanın**

Windows'ta PowerShell açın:

```powershell
ssh root@203.0.113.45
```

İlk bağlantıda "Are you sure you want to continue connecting?" sorusuna `yes` yazın,
sonra şifreyi girin (yazarken ekranda görünmez, bu normaldir).

**Adım 3 — Sistemi güncelleyin ve Node.js kurun**

```bash
apt update && apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs git nginx
node -v
```

**Doğru gitti mi?** `node -v` komutu `v20.x.x` yazmalı.

**Adım 4 — Normal bir kullanıcı oluşturun**

Sunucuyu root ile çalıştırmak güvenli değildir:

```bash
adduser gamelink        # şifre sorar, belirleyin (diğer soruları Enter ile geçin)
usermod -aG sudo gamelink
su - gamelink
```

**Adım 5 — Sunucu dosyalarını yükleyin**

`server` klasörünü sunucuya kopyalamanın en kolay yolu — **kendi Windows
bilgisayarınızda** yeni bir PowerShell açıp:

```powershell
scp -r C:\GameLink-Kaynak\server gamelink@203.0.113.45:/home/gamelink/gamelink-server
```

Sunucudaki oturumda devam edin:

```bash
cd ~/gamelink-server
npm install --omit=dev
```

**Adım 6 — Elle bir kez çalıştırıp test edin**

```bash
node server.js
```

Başka bir PowerShell penceresinden test edin:

```powershell
curl http://203.0.113.45:8080/health
```

`{"ok":true,"rooms":0,"uptime":5}` benzeri bir yanıt gelmeli.
(Gelmiyorsa VPS'in güvenlik duvarında 8080 kapalı olabilir; geçici olarak
`sudo ufw allow 8080` deneyin.)

Testi bitirince sunucudaki `node server.js` işlemini `Ctrl + C` ile durdurun.

**Adım 7 — Servis olarak kurun (kendi kendine açılsın, çökerse yeniden başlasın)**

```bash
sudo nano /etc/systemd/system/gamelink.service
```

Açılan editöre şunu yapıştırın (Ctrl+Shift+V):

```ini
[Unit]
Description=GameLink Sinyallesme Sunucusu
After=network.target

[Service]
Type=simple
User=gamelink
WorkingDirectory=/home/gamelink/gamelink-server
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
Environment=PORT=8080

[Install]
WantedBy=multi-user.target
```

Kaydedip çıkın: `Ctrl + O` → `Enter` → `Ctrl + X`

Servisi başlatın:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now gamelink
sudo systemctl status gamelink
```

**Doğru gitti mi?** Yeşil renkte `active (running)` yazmalı. `q` ile çıkın.

Sunucu günlüklerini görmek için: `sudo journalctl -u gamelink -f`

---

## 5. BÖLÜM C — DuckDNS (ücretsiz alan adı)

Sertifika alabilmek için bir alan adı gerekir. DuckDNS ücretsizdir.

**Adım 1 — Hesap ve alan adı**

1. <https://www.duckdns.org> adresine gidin
2. Üstteki düğmelerden biriyle giriş yapın (Google/GitHub hesabınız yeterli)
3. Açılan sayfada **"sub domain"** kutusuna istediğiniz ismi yazın: örneğin `benim-gamelink`
4. **add domain** düğmesine basın
5. Artık alan adınız: `benim-gamelink.duckdns.org`
6. Sayfanın üstündeki **token** değerini bir yere kopyalayın (uzun bir harf-rakam dizisi)

**Adım 2 — Alan adını sunucunuza bağlayın**

Aynı sayfada, alan adınızın yanındaki **current ip** kutusuna sunucunuzun IP
adresini yazıp **update ip** düğmesine basın.

**Adım 3 — IP değişirse otomatik güncellensin**

*VPS kullanıyorsanız* IP sabittir, bu adımı atlayabilirsiniz. Yine de garanti olsun
derseniz sunucuda:

```bash
mkdir -p ~/duckdns
nano ~/duckdns/duck.sh
```

İçine (TOKEN ve alan adını kendinizinkiyle değiştirin):

```bash
echo url="https://www.duckdns.org/update?domains=benim-gamelink&token=TOKENINIZ&ip=" | curl -k -o ~/duckdns/duck.log -K -
```

Kaydedip çıkın, sonra:

```bash
chmod 700 ~/duckdns/duck.sh
crontab -e          # ilk kullanımda editör sorar, 1 (nano) seçin
```

Dosyanın en altına ekleyin:

```
*/5 * * * * ~/duckdns/duck.sh >/dev/null 2>&1
```

*Ev bilgisayarında sunucu çalıştırıyorsanız* ev IP'niz değişkendir, bu adım
**zorunludur**. Windows'ta yönetici PowerShell'de:

```powershell
$cmd = 'Invoke-RestMethod "https://www.duckdns.org/update?domains=benim-gamelink&token=TOKENINIZ&ip="'
$action  = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -Command $cmd"
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName "DuckDNS-Guncelle" -Action $action -Trigger $trigger -User "SYSTEM" -RunLevel Highest
```

**Adım 4 — Test**

```powershell
nslookup benim-gamelink.duckdns.org
```

Sunucunuzun IP adresini göstermeli. Göstermiyorsa 5 dakika bekleyip tekrar deneyin.

---

## 6. BÖLÜM D — HTTPS/WSS sertifikası (Let's Encrypt)

Client `wss://` (şifreli) bağlantı kullanır. Bunun için ücretsiz bir sertifika alıp
nginx'i önüne koyuyoruz. **Bu adımlar sunucuda (VPS'te) yapılır.**

**Adım 1 — nginx yapılandırması**

```bash
sudo nano /etc/nginx/sites-available/gamelink
```

Yapıştırın (`benim-gamelink.duckdns.org` kısmını değiştirin):

```nginx
server {
    listen 80;
    server_name benim-gamelink.duckdns.org;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name benim-gamelink.duckdns.org;

    ssl_certificate     /etc/letsencrypt/live/benim-gamelink.duckdns.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/benim-gamelink.duckdns.org/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 3600s;
    }
}
```

> `proxy_read_timeout 3600s` satırı önemlidir: bu olmadan nginx uzun süre sessiz
> kalan WebSocket bağlantılarını koparır ve host bir süre sonra "çevrimdışı" görünür.

**Adım 2 — Siteyi etkinleştirin**

```bash
sudo mkdir -p /var/www/certbot
sudo ln -s /etc/nginx/sites-available/gamelink /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
```

**Adım 3 — Sertifikayı alın**

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d benim-gamelink.duckdns.org
```

Sorulanlar:
- E-posta adresiniz (sertifika bitmeden uyarı gelsin diye)
- Şartları kabul: `Y`
- Reklam e-postası: `N`

**Adım 4 — nginx'i yeniden başlatın**

```bash
sudo nginx -t          # "syntax is ok" ve "test is successful" demeli
sudo systemctl reload nginx
```

**Adım 5 — Güvenlik duvarı**

```bash
sudo ufw allow 80
sudo ufw allow 443
sudo ufw --force enable
```

**Adım 6 — Son test**

Kendi bilgisayarınızdan:

```powershell
curl https://benim-gamelink.duckdns.org/health
```

`{"ok":true,...}` yanıtı geliyorsa **sunucu tarafı bitti.** 🎉

Client'ta kullanacağınız adres artık:

```
wss://benim-gamelink.duckdns.org
```

> Sertifika 90 günde bir yenilenir; certbot bunu otomatik yapar.
> Kontrol: `sudo certbot renew --dry-run`

---

## 7. BÖLÜM E — Host kurulumu (kontrol edilecek bilgisayar)

**Adım 1 — Kaynak dosyaları yerleştirin**

Proje klasörünü **boşluksuz** bir yola koyun, örneğin `C:\GameLink-Kaynak`.

> ⚠️ Yolda boşluk olmasın (`C:\Users\Ali Veli\Masaüstü\...` gibi). v3.1.5'te bu
> yüzden kurulum yolları da boşluksuz yapıldı: boşluk, `cd` komutlarını ve
> açılışta çalışan `.bat` kısayollarını bozuyor.

**Adım 2 — Derleyin**

PowerShell açın:

```powershell
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
cd C:\GameLink-Kaynak\host
npm install
npm run build
```

`npm install` ilk seferde birkaç dakika sürer (Electron indirilir, ~100 MB).

**Doğru gitti mi?** `C:\GameLink-Kaynak\host\dist` klasöründe şu iki dosya oluşmalı:
- `GameLink-Host-Kurulum.exe` (kurulum dosyası)
- `GameLink-Host-Portable.exe` (kurulum gerektirmeyen sürüm)

**Adım 3 — Kurun**

`GameLink-Host-Kurulum.exe` dosyasına **çift tıklayın**.

- Windows "bilinmeyen yayımcı" uyarısı verirse: **Daha fazla bilgi → Yine de çalıştır**
- UAC (yönetici izni) penceresi çıkar → **Evet**
- Kurulum klasörü olarak **`C:\GameLink\Host`** önerilir, olduğu gibi bırakın

Kurulum sonrası program yolu:

```
C:\GameLink\Host\GameLink-Host.exe
```

**Adım 4 — İlk ayarlar**

Programı açın (UAC her açılışta yönetici izni ister, bu normaldir — Görev
Yöneticisi gibi yükseltilmiş pencereleri kontrol edebilmek için gereklidir).

1. **Sunucu Adresi** kartına `wss://benim-gamelink.duckdns.org` yazın → **Kaydet**
2. **Parola** kartına bir parola belirleyin → **Kaydet**
   *(Bu parola, yeni bir cihazın ilk bağlantısında sorulur. Sonrasında o cihaz
   "güvenilir" listesine eklenir ve bir daha sormaz.)*
3. En üstteki **Bağlantı Kodu**'nu not alın (örn. `8798-5F7B`) — **Kopyala**
   düğmesiyle panoya alabilirsiniz
4. **Paylaşılan Ekran** kartından hangi monitörün paylaşılacağını seçin

**Doğru gitti mi?** Sağ üstteki durum rozeti **sarı "Bekleniyor"** olmalı.
Kırmızı/"Bağlantı koptu" yazıyorsa sunucu adresi yanlış ya da sunucu çalışmıyordur;
en alttaki **Günlük** kartına bakın.

**Adım 5 — Tema (isteğe bağlı)**

Sağ üstteki üç küçük düğmeyle tema seçebilirsiniz:
🖥 Sistem (Windows'un ayarını izler) · ☀ Açık · 🌙 Koyu

---

## 8. BÖLÜM F — Client kurulumu (kontrol eden bilgisayar)

**Adım 1 — Derleyin**

```powershell
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
cd C:\GameLink-Kaynak\client
npm install
npm run build
```

Çıktı: `client\dist\GameLink-Kurulum.exe`

**Adım 2 — Kurun**

Çift tıklayın, önerilen klasör **`C:\GameLink\Client`**. Program yolu:

```
C:\GameLink\Client\GameLink.exe
```

**Adım 3 — İlk bağlantı**

1. Programı açın
2. **Sunucu Adresi**: `wss://benim-gamelink.duckdns.org`
3. **Kod**: host'tan aldığınız kod (`8798-5F7B`)
4. **Parola**: host'ta belirlediğiniz parola
5. **Bağlan**

Birkaç saniye içinde host'un ekranı gelmelidir. Bağlantı kaydedilir; bir dahaki
sefere soldaki listeden tek tıkla (parolasız) bağlanırsınız.

**Adım 4 — Kontrolü ele alma**

Görüntüye **tıklayın**. Fare ve klavye artık host'a gider.
Çıkmak için **Sol Ctrl + Sol Alt** (ayarlardan değiştirilebilir).

---

## 9. BÖLÜM G — Host'u otomatik başlatma

Host kapalıyken bağlanamazsınız. Bilgisayar açıldığında host da açılsın.

> ⚠️ Host yönetici yetkisi istediği için **Başlangıç klasörüne kısayol koymak
> çalışmaz** (her açılışta UAC sorar ve kimse onaylamaz). **Görev Zamanlayıcı**
> kullanın — UAC sormadan yönetici yetkisiyle başlatır.

### v4.0: tek düğmeyle

Aşağıdaki elle yapılan işlemler artık gerekmiyor:

**Host penceresi → Program sekmesi → "Windows açılışında otomatik başlat"**

Bu anahtar sizin için `GameLink-Host` adında, "en yüksek ayrıcalıklarla" çalışan bir
`ONLOGON` görevi oluşturur ve programı `--hidden` ile başlatır: açılışta pencere hiç
görünmez, doğrudan tepsiye iner. Anahtarı kapatmak görevi siler.

Client'ta aynı ayar **⚙ (sol alt) → Program Ayarları → Pencere ve başlangıç**
altında; client yönetici istemediği için orada Görev Zamanlayıcı'ya gerek yok.

> Daha önce elle bir görev oluşturduysanız önce onu silin (aynı adı kullanıyorsa
> anahtar zaten üzerine yazar), sonra anahtarı açın.

### Elle kurmak isterseniz (ya da anahtar çalışmazsa)

**Adım adım:**

1. `Win + R` → `taskschd.msc` → Enter
2. Sağdaki panelde **Görev Oluştur** (*Create Task*) — "Temel Görev" olan **değil**!
3. **Genel** sekmesi:
   - Ad: `GameLink-Host`
   - ✅ **En yüksek ayrıcalıklarla çalıştır** (*Run with highest privileges*) ← kritik
   - Yapılandır: Windows 10/11
4. **Tetikleyiciler** sekmesi → **Yeni** → Görevi başlat: **Oturum açıldığında** →
   kendi kullanıcınızı seçin → Tamam
5. **Eylemler** sekmesi → **Yeni** → Program başlat:
   - Program: `C:\GameLink\Host\GameLink-Host.exe`
   - Bağımsız değişken ekle: `--hidden` (açılışta doğrudan tepsiye insin)
6. **Koşullar** sekmesi: "Yalnızca bilgisayar AC gücündeyse başlat" kutusunun
   işaretini **kaldırın**
7. **Ayarlar** sekmesi: ✅ "Görev başarısız olursa yeniden başlat" → her 1 dakikada, 3 kez
8. Tamam

**Test:** Bilgisayarı yeniden başlatın. Oturum açtıktan sonra host tepside
(saatin yanında) görünmelidir.

**Elektrik kesintisinden sonra da açılsın istiyorsanız:**

1. BIOS/UEFI'ye girin (açılışta `Del` veya `F2`)
2. **Restore on AC Power Loss** / **AC Power Recovery** ayarını **Power On** yapın
3. Windows'ta otomatik oturum açmayı etkinleştirin:
   `Win + R` → `netplwiz` → kullanıcıyı seçin → "Kullanıcılar bu bilgisayarı
   kullanmak için ... girmelidir" kutusunun işaretini kaldırın → Uygula → şifreyi girin

---

## 10. BÖLÜM H — TURN sunucusu (mobil veri / CGNAT için)

**Buna ihtiyacınız var mı?** Önce TURN'süz deneyin. Ev Wi-Fi'ından bağlanıyorsanız
büyük ihtimalle gerekmez. **Mobil veriden bağlanamıyorsanız** gerekiyor demektir.

Sunucuda (VPS'te):

```bash
sudo apt install -y coturn
sudo nano /etc/turnserver.conf
```

Dosyanın tamamını silip şunu yazın (alan adı ve şifreyi değiştirin):

```
listening-port=3478
fingerprint
lt-cred-mech
realm=benim-gamelink.duckdns.org
user=gamelinkuser:COK-GIZLI-BIR-SIFRE
no-multicast-peers
no-cli
```

Servisi etkinleştirin:

```bash
sudo sed -i 's/^#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn
sudo systemctl enable --now coturn
sudo systemctl status coturn
sudo ufw allow 3478
sudo ufw allow 49152:65535/udp
```

Host programında **TURN Sunucusu** kartını doldurun:

| Alan | Değer |
|---|---|
| URL | `turn:benim-gamelink.duckdns.org:3478` |
| Kullanıcı | `gamelinkuser` |
| Parola | `COK-GIZLI-BIR-SIFRE` |

**Kaydet** deyin. Client tarafında hiçbir şey yapmanıza gerek yok — bu bilgi
bağlantı kurulurken host tarafından client'a otomatik iletilir.

**Bağlantı Modu** kartı:
- **Otomatik** (varsayılan): önce doğrudan dener, olmazsa TURN'e düşer ← bunu kullanın
- **Sadece STUN**: TURN hiç kullanılmaz
- **Sadece TURN**: her şey röle üzerinden (sunucu bant genişliği harcar)

---

## 11. BÖLÜM I — Günlük kullanım

### İmleç modları (client → Ayarlar → İmleç)

| | 🎯 Tek imleç | 🖱️ İkinci imleç |
|---|---|---|
| Host'un imleci | Sizin kontrolünüzde | Sahibinde kalır |
| Host kullanıcısı aynı anda çalışabilir mi | Hayır | **Evet** |
| Oyunlar | ✅ Tek doğru seçenek | ❌ Çalışmaz |
| Masaüstü işleri | Çalışır | ✅ İdeal |

### Mod ve kalite

| Mod | Ne için | Otomatik kalite |
|---|---|---|
| 🎮 Oyun | En düşük gecikme | Dengeli |
| 💼 Normal | Masaüstü işleri, yazı netliği | Yüksek |
| 📺 Stream | Takılmasız izleme | Yüksek |

### Kısayollar

| Kısayol | İşlev |
|---|---|
| Görüntüye tıklama | Kontrolü ele al |
| Sol Ctrl + Sol Alt | Kontrolü bırak (değiştirilebilir) |
| F11 | Tam ekran |

### v4.0: oturum paneli (client → 💬 Oturum)

| Sekme | Ne var |
|---|---|
| 💬 Sohbet | İki yönlü yazışma |
| 📁 Dosyalar | Dosya gönder/al — sürükleyip bırakabilirsiniz. Gelen dosyalar `İndirilenler\GameLink` altına iner (değiştirilebilir) |
| 📊 Host PC | Karşı bilgisayarın işlemci/bellek kullanımı, disk ve ağ etkinlik ışıkları, disk doluluğu, donanım ve işletim sistemi bilgisi |

Host tarafında bir cihaz bağlanınca **oturum penceresi** açılır: kim bağlandı, ne
kadar süredir bağlı, sohbet, dosya aktarımı ve **Bağlantıyı kes** düğmesi. Pencereyi
kapatmak oturumu kesmez. Hiç açılmasını istemiyorsanız host → **Oturum** sekmesinden
kapatın.

### v4.0: diğer düğmeler (client üst çubuğu)

| Düğme | İşlev |
|---|---|
| ⏺ Kaydet | Gördüğünüz akışı `Videolar\GameLink` altına kaydeder |
| 🎤 Mikrofon | Mikrofonunuzu host'ta çaldırır |
| 📊 İstatistik | Kodek, kare çözme süresi, donma sayısı, bağlantı türü dahil ayrıntılı ölçümler |

Sol altta sürekli görünen **ağ kalitesi göstergesi** ping, paket kaybı, bit hızı ve
FPS'i gösterir; sinyal çubukları kalite düştükçe sarıya ve kırmızıya döner. Ayarlar
panelinden kapatılabilir.

### v4.0: ekranı seçmek ve çözünürlük

- **Tek pencere paylaşma:** host → Ekran → Paylaşılan Kaynak listesinde ekranların
  altında pencereler de var. Client da kendi ayar panelinden aynı listeden seçebilir.
- **Host'un çözünürlüğü:** client → Ayarlar → Host Çözünürlüğü. Bağlantı bitince
  otomatik olarak eski değerine döner. Host bu izni kapatabilir.
- **İzleme penceresi:** Ayarlar → Görüntü Yerleşimi (Sığdır/Doldur/Esnet/1:1) ve
  Pencere (Pencereli/Büyüt/Tam ekran/Gerçek boyut).

### v4.0: ayarları yedekleme

Her iki programda **Dışa aktar / İçe aktar** var (host → Program sekmesi, client →
⚙ → Ayarları aktar). Sunucu adresi, kod, TURN bilgileri, güvenilir cihazlar ve tüm
tercihler tek bir JSON dosyasına yazılır. **Parola düz metin gitmez** — taşınabilir
şifreli özet olarak gider, hedef makinede aynı parola çalışmaya devam eder.

---

## 12. BÖLÜM J — Otomatik güncelleme sunucusu

v4.0'dan itibaren iki program da kendini güncelleyebiliyor. Paketler GitHub'dan
değil **sizin sunucunuzdan** iniyor; bu yüzden bir kerelik küçük bir kurulum var.

> Bu bölüm isteğe bağlıdır. Adres girilmezse güncelleme denetimi tamamen kapalıdır
> ve program normal çalışır.

### 12.1. Sunucuda dizinleri oluşturun

VPS'te (sinyal sunucusunun çalıştığı makinede):

```bash
sudo mkdir -p /var/www/gamelink-updates/host
sudo mkdir -p /var/www/gamelink-updates/client
sudo chown -R $USER:$USER /var/www/gamelink-updates
```

### 12.2. nginx'e bir konum ekleyin

`sudo nano /etc/nginx/sites-available/gamelink` dosyasındaki `server { ... }`
bloğunun içine, var olan `location /` satırının **üstüne** ekleyin:

```nginx
    # GameLink otomatik güncelleme paketleri
    location /updates/ {
        alias /var/www/gamelink-updates/;
        autoindex off;
        # Kurulum dosyaları büyük; zaman aşımını gevşetiyoruz.
        proxy_read_timeout 300s;
        add_header Cache-Control "public, max-age=300";
    }
```

Sonra:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

**Doğrulama:** `curl -I https://alan-adiniz/updates/host/` komutu 403 ya da 404
dönmelidir (dizin listeleme kapalı olduğu için). 502 dönüyorsa `alias` yolu yanlıştır.

### 12.3. Paketleri yükleyin

Windows'ta derledikten sonra `dist` klasöründen **üç** dosya gerekir:

| Dosya | Ne işe yarar |
|---|---|
| `GameLink-Host-Kurulum.exe` | Kurulumun kendisi |
| `GameLink-Host-Kurulum.exe.blockmap` | Yalnızca değişen kısmı indirmek için |
| `latest.yml` | "En son sürüm hangisi" bilgisi — **bu olmadan güncelleme çalışmaz** |

> `latest.yml` yoksa `host/package.json` içindeki `build.publish` alanının durduğundan
> emin olun; electron-builder bu alan varsa `latest.yml` üretir.

Sunucuya kopyalayın (Windows PowerShell'den):

```powershell
scp dist\GameLink-Host-Kurulum.exe dist\GameLink-Host-Kurulum.exe.blockmap dist\latest.yml kullanici@alan-adiniz:/var/www/gamelink-updates/host/
```

Client için aynısını `/var/www/gamelink-updates/client/` altına yapın.

### 12.4. Programlara adresi girin

- **Host:** Program sekmesi → Otomatik Güncelleme → `https://alan-adiniz/updates/host/`
- **Client:** ⚙ → Otomatik güncelleme → `https://alan-adiniz/updates/client/`

Sondaki **eğik çizgi önemlidir**. "Şimdi denetle" ile test edin.

### 12.5. Yeni sürüm yayınlarken

1. `package.json` içindeki `version` alanını artırın (örn. `4.0.1`)
2. `npm run build`
3. Yukarıdaki üç dosyayı sunucuya kopyalayın

Programlar açılışta denetler, yeni sürümü indirir ve **Yeniden başlat ve kur** ile
kurar. Taşınabilir (portable) sürüm kendini güncelleyemez.

---

## 13. BÖLÜM K — Sanal makine / VDS üzerinde çalıştırma

Host'u bir VDS'te ya da sanal makinede çalıştırmak mümkün, ama iki tuzak var.

### Tuzak 1: GPU

Sanal makinelerde GPU ya hiç yoktur ya da yazılım öykünmesidir. Chromium'un donanım
hızlandırması orada GPU sürecini çökertip programın **hiç açılmamasına** yol açar.

v4.0 bunu kendi başına hallediyor:

- Açılışta kayıt defterinden BIOS bilgisi okunup sanal makine olup olmadığınız
  anlaşılıyor (VMware, VirtualBox, QEMU/KVM, Hyper-V, Proxmox, EC2 …)
- Sanal makineyse donanım hızlandırma kapatılıyor
- Buna rağmen GPU süreci çökerse uyumluluk modu kalıcı olarak açılıp program
  **bir kez** kendini yeniden başlatıyor

Elle zorlamak isterseniz: **Program → Sanal Makine / VDS Uyumluluğu → Her zaman
açık**, sonra programı yeniden başlatın.

### Tuzak 2: oturum kapatmak masaüstünü yok eder

VDS'e uzak masaüstü (RDP) ile bağlanıp **oturumu kapatırsanız** Windows o masaüstünü
yok eder. O andan itibaren:

- Ekran paylaşımı görüntü üretemez
- Girdi enjeksiyonu sessizce hiçbir yere gitmez

Host bir RDP oturumunda çalışıyorsa arayüzde turuncu bir uyarı şeridi çıkar.

**Doğru kullanım:** RDP penceresini **kapatın** (oturumu açık bırakır), "Oturumu
kapat" demeyin. Kalıcı çözüm için VDS'i otomatik oturum açacak şekilde ayarlayın
(`netplwiz`) ve konsol oturumunda çalıştırın.

### Ses

Sanal makinelerde çoğu zaman ses aygıtı yoktur. v4.0 sesli yakalama başarısız
olursa **sessiz olarak** yeniden dener; eskiden bu durumda ekran hiç paylaşılamıyordu.
Günlükte "Ekran sessiz olarak paylaşılıyor" satırını görürsünüz.

### Disk etkinliği

Bazı kısıtlı VDS şablonlarında Windows performans sayacı kaydı eksiktir. O durumda
client'taki disk ışığı gizlenir, gerisi çalışmaya devam eder.

---

## 14. BÖLÜM L — Sorun giderme

| Belirti | Sebep / Çözüm |
|---|---|
| Host'ta "Bağlantı koptu, yeniden deneniyor" | Sunucu adresi yanlış veya sunucu kapalı. `curl https://alan-adiniz/health` ile test edin |
| Client "Sunucuya bağlanılamadı" | `wss://` yazdığınızdan emin olun (`https://` değil). Sertifika geçerli mi: tarayıcıda `https://alan-adiniz/health` açın |
| "Parola hatalı" | Host'ta parola ayarlı mı? Host GUI → Parola kartı |
| "Host parolası ayarlanmamış" | Host'ta bir parola belirleyip **Kaydet** deyin |
| Bağlanıyor ama görüntü gelmiyor | Doğrudan bağlantı kurulamıyor. TURN kurun ([Bölüm H](#10-bölüm-h--turn-sunucusu-mobil-veri--cgnat-için)) |
| Mobil veriden bağlanamıyorum | CGNAT. TURN zorunlu |
| Görev Yöneticisi'nde kontrol çalışmıyor | Host yönetici olarak çalışmıyor. Görev Zamanlayıcı'da "En yüksek ayrıcalıklarla çalıştır" işaretli mi? |
| UAC penceresi görünmüyor/tıklanamıyor | Windows kısıtı (secure desktop). Host'ta fiziksel olarak onaylamak gerekir |
| Oyunda kamera kendi kendine dönüyor | İmleç modu **Tek imleç** olmalı; ikinci imleç modu oyunlarda çalışmaz |
| Tuş basılı kalıyor | Yakalamayı bırakın (Sol Ctrl + Sol Alt); host otomatik olarak tüm tuşları serbest bırakır |
| Windows tuşu kendi bilgisayarımda açılıyor | Tam ekran (F11) olmadan klavye kilidi çalışmaz |
| Host açılışta çok yavaş | v3.1.5 bunu düzeltti. İlk açılış hâlâ ~1 sn sürer (derleme önbelleği oluşuyor), sonrakiler hızlıdır |
| Ayarlarım sıfırlandı | `%APPDATA%\GameLink-Host\` klasörüne bakın: `config.json.bozuk-...` adlı bir yedek varsa ayarlarınız oradadır |
| Kurulumda "yol bulunamadı" / .bat çalışmıyor | Yolda boşluk vardır. Kaynağı `C:\GameLink-Kaynak` gibi boşluksuz bir yere taşıyın |
| Client'ta tepsi menüsü açılınca program çöküyordu | v4.0 düzeltti (yok edilmiş pencereye dokunuluyordu) |
| VDS'te program hiç açılmıyor / hemen kapanıyor | GPU. Host → Program → Sanal Makine Uyumluluğu → **Her zaman açık**, sonra yeniden başlatın. Bkz. [Bölüm K](#13-bölüm-k--sanal-makine--vds-üzerinde-çalıştırma) |
| VDS'te bağlantı var ama görüntü siyah | RDP oturumunu kapatmışsınızdır; masaüstü yok olur. RDP penceresini kapatın, "Oturumu kapat" demeyin |
| VDS'te ekran hiç paylaşılmıyordu | Ses aygıtı yok. v4.0 sessiz olarak yeniden deniyor; günlükte "sessiz olarak paylaşılıyor" satırına bakın |
| "Güncelleme sunucusu adresi girilmemiş" | Normal — adres girmediyseniz güncelleme kapalıdır. [Bölüm J](#12-bölüm-j--otomatik-güncelleme-sunucusu) |
| Güncelleme "denetlenemedi" diyor | Adresin sonunda `/` var mı? `latest.yml` sunucuda mı? `curl https://alan-adiniz/updates/host/latest.yml` ile test edin |
| Taşınabilir sürüm kendini güncellemiyor | Beklenen davranış; kurulum sürümünü kullanın |
| Dosya aktarımı başlamıyor | Host → Oturum → "Dosya aktarımına izin ver" açık mı? Bağlantı kurulmadan dosya gönderilemez |
| Gelen dosya nereye indi | Varsayılan `İndirilenler\GameLink`. Aktarım listesindeki **Klasörde göster** ile açabilirsiniz |
| Host PC bilgileri boş geliyor | Host → Oturum → "Sistem bilgilerini client'a göster" kapalı olabilir |
| Disk ışığı hiç yanmıyor | O makinede performans sayacı kaydı eksik olabilir; diğer değerler çalışmaya devam eder |
| Pencere paylaşımında ikinci imleç kayıyor | Pencereyi taşıdıysanız hizalanma 400 ms sürer. Minimize pencere paylaşılamaz |
| Çözünürlük değişmiyor | Host → Ekran → "Client de çözünürlüğü değiştirebilsin" kapalı olabilir |
| Mikrofon host'ta duyulmuyor | Windows → Gizlilik → Mikrofon izni; ayrıca host'ta ses seviyesini kontrol edin |

**Günlükler nerede?**

- **Host arayüzü:** Program sekmesi → **Günlük** kartı (anlık olaylar)
- **Host dosyası:** `%APPDATA%\GameLink-Host\logs\host.log` — Program sekmesindeki
  **Günlük dosyasını aç** düğmesiyle. Program hiç açılmıyorsa bakılacak yer burasıdır:
  yakalanmamış hatalar, arayüz hataları ve GPU/renderer süreç ölümleri burada
- **Client dosyası:** `%APPDATA%\GameLink\logs\client.log` — ⚙ → **Günlüğü aç**
- **Sunucu (VPS):** `sudo journalctl -u gamelink -f`
- **nginx:** `sudo tail -f /var/log/nginx/error.log`

> Bir sorun bildirirken ekran görüntüsü yerine **günlük dosyasını** gönderin;
> içinde neden çöktüğü yazıyor.

---

## 15. v4.0 ile gelen yenilikler

Ayrıntılı anlatım: **[DEGISIKLIKLER-v4.0.md](DEGISIKLIKLER-v4.0.md)**

**Oturum**
- **Dosya aktarımı** — iki yönlü, sürükle-bırak, doğrudan P2P. Dosya belleğe
  alınmadan 64 KB'lık parçalar hâlinde akar; büyük dosyalar da sorunsuz
- **Yazışma** ve host tarafında bağlantıyla açılan **oturum penceresi**
- **Host PC bilgileri** — işlemci/bellek kullanımı, disk ve ağ etkinlik ışıkları,
  disk doluluğu, donanım ve işletim sistemi bilgisi

**Görüntü**
- **Pencere yakalama** — tüm ekran yerine tek bir pencere paylaşılabilir
- **Çözünürlük kontrolü** — host'un masaüstü çözünürlüğü değiştirilip bağlantı
  bitince otomatik geri alınır
- **İzleme penceresi** yerleşim (Sığdır/Doldur/Esnet/1:1) ve boyut modları
- **Ekran kaydı** — client ve host'ta bağımsız
- **Ağ kalitesi göstergesi** — oyun sırasında ping/kayıp/bit hızı
- **Video kodeği** seçimi (Otomatik/H.264/VP9/VP8/AV1)
- **Mikrofon** — client'ın mikrofonu host'ta çalar

**Program**
- **Windows açılışında otomatik başlat** — tek anahtar (host'ta Görev Zamanlayıcı
  görevini kendisi oluşturur)
- **Aynı anda tek örnek** — ikinci kez açılırsa var olan pencere öne gelir
- **Ayarları dışa/içe aktarma** (parola şifreli özet olarak taşınır)
- **Otomatik güncelleme** — kendi sunucunuzdan ([Bölüm J](#12-bölüm-j--otomatik-güncelleme-sunucusu))
- **Sanal makine / VDS desteği** ([Bölüm K](#13-bölüm-k--sanal-makine--vds-üzerinde-çalıştırma))
- **Günlük dosyası** — çökmeleri teşhis etmek için
- Host penceresi yeniden boyutlandırılabilir ve dört sekmeye ayrıldı
- Her iki programda sürüm numarası görünür

**Güvenlik**
- Host parolası artık `config.json` içinde **düz metin durmuyor**; tuzlanmış scrypt
  özeti saklanıyor. Var olan parolanız ilk açılışta otomatik taşınır, yeniden
  girmeniz gerekmez
- Gelen dosya adları sterilize ediliyor (dizin dışına yazma engellendi)
