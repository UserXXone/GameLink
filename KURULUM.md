# GameLink — Sıfırdan Kurulum Kılavuzu

**Sürüm: v3.1.5** · Hiçbir ön bilgi varsayılmadan, en baştan anlatılmıştır.
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
- [12. BÖLÜM J — Sorun giderme](#12-bölüm-j--sorun-giderme)
- [13. v3.1.5 ile gelen yenilikler](#13-v315-ile-gelen-yenilikler)

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

---

## 12. BÖLÜM J — Sorun giderme

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

**Günlükler nerede?**
- Host: program penceresinin en altındaki **Günlük** kartı
- Sunucu (VPS): `sudo journalctl -u gamelink -f`
- nginx: `sudo tail -f /var/log/nginx/error.log`

---

## 13. v3.1.5 ile gelen yenilikler

**Açılış hızı**
- Host'un girdi köprüsü her açılışta C# derleyicisini çalıştırıyordu (bu makinede
  ölçülen: ~970 ms). Derleme artık bir kez yapılıp önbelleğe alınıyor →
  **~270 ms**. Yavaş disklerde fark daha büyük.
- Pencereler artık içerik hazır olmadan gösterilmiyor: beyaz "flaş" yok.
- Ayar dosyası bellekte tutuluyor (her pencere olayında diskten okunmuyor).
- Client'ın donanım kimliği bir kez hesaplanıp saklanıyor (her açılışta ~200 ms
  süren bir alt süreç çalışmıyor).

**Boşluksuz yollar**
- Ürün adı `GameLink Host` → **`GameLink-Host`**
- Varsayılan kurulum: `C:\GameLink\Host` ve `C:\GameLink\Client`
- Eski sürümden gelen ayarlarınız ilk açılışta otomatik taşınır.

**Arayüz**
- Açık/Koyu/Sistem teması — host ve client'ta ayrı ayrı seçilebilir.
- Fluent tabanlı, renkli yeni tasarım: renkli kart rozetleri, gradyanlı kod kartı,
  kayıtlı bağlantılar için renkli simgeler.
- Host'ta bağlantı kodunu tek tıkla kopyalama.

**Düzeltmeler**
- "Küçültünce tepsiye in" ayarı arayüzde her açılışta işaretli görünüyordu.
- Ayar dosyası okunamazsa artık sessizce sıfırlanmıyor; `config.json.bozuk-...`
  adıyla yedekleniyor. Dosya başındaki görünmez BOM işareti de artık soruna yol açmıyor.
