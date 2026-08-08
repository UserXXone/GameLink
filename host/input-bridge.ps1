$code = @"
using System;
using System.Runtime.InteropServices;

public static class InputSim
{
    [StructLayout(LayoutKind.Sequential)]
    struct INPUT { public uint type; public InputUnion U; }

    [StructLayout(LayoutKind.Explicit)]
    struct InputUnion
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct MOUSEINPUT
    {
        public int dx; public int dy; public uint mouseData;
        public uint dwFlags; public uint time; public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT
    {
        public ushort wVk; public ushort wScan; public uint dwFlags;
        public uint time; public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct POINT { public int X; public int Y; }

    const uint INPUT_MOUSE = 0;
    const uint INPUT_KEYBOARD = 1;

    const uint MOUSEEVENTF_MOVE = 0x0001;
    const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    const uint MOUSEEVENTF_LEFTUP = 0x0004;
    const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    const uint MOUSEEVENTF_WHEEL = 0x0800;
    const uint MOUSEEVENTF_HWHEEL = 0x1000;

    const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
    const uint KEYEVENTF_KEYUP = 0x0002;
    const uint KEYEVENTF_SCANCODE = 0x0008;

    [DllImport("user32.dll", SetLastError = true)]
    static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll", SetLastError = true)]
    static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll", SetLastError = true)]
    static extern bool GetCursorPos(out POINT lpPoint);

    // Fiziksel fare/klavyeyi kısa süreliğine dondurur. ÖNEMLİ: BlockInput'u çağıran
    // thread'in SendInput çağrıları engellenmez - "ödünç tıklama" bu yüzden mümkün.
    // Yükseltilmiş (yönetici) haklar ister; değilse sessizce false döner.
    [DllImport("user32.dll", SetLastError = true)]
    static extern bool BlockInput(bool fBlockIt);

    [DllImport("user32.dll")]
    static extern bool SetProcessDPIAware();

    [DllImport("user32.dll", SetLastError = true)]
    static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    // SetCursorPos/GetCursorPos, DPI farkında OLMAYAN bir süreçte ölçeklenmiş
    // (sanal) koordinatlarla çalışır. Electron tarafı bize gerçek fiziksel piksel
    // gönderdiği için bu süreci de fiziksel piksel uzayına almamız şart; aksi halde
    // %125/%150 ölçekli ekranlarda ikinci imleç kaymış konuma tıklar.
    public static void MakeDpiAware()
    {
        try
        {
            // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = (HANDLE)-4  (Win10 1703+)
            if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return;
        }
        catch { /* eski Windows: giriş noktası yok */ }
        try { SetProcessDPIAware(); } catch { }
    }

    // ÖNEMLİ: dx/dy burada MOUSEEVENTF_MOVE ile RELATIVE (göreli) hareket olarak
    // yorumlanır - MOUSEEVENTF_ABSOLUTE bayrağı KULLANILMIYOR. Oyunlarda kameranın
    // sürekli dönmesi sorununun kökü buydu; artık gerçek fare deltası uygulanıyor.
    public static void MoveRelative(int dx, int dy)
    {
        INPUT[] inputs = new INPUT[1];
        inputs[0].type = INPUT_MOUSE;
        inputs[0].U.mi.dx = dx;
        inputs[0].U.mi.dy = dy;
        inputs[0].U.mi.dwFlags = MOUSEEVENTF_MOVE;
        SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
    }

    public static void SetPos(int x, int y)
    {
        SetCursorPos(x, y);
    }

    public static int[] GetPos()
    {
        POINT p;
        if (!GetCursorPos(out p)) return null;
        return new int[] { p.X, p.Y };
    }

    public static void Block(bool on)
    {
        try { BlockInput(on); } catch { }
    }

    public static void MouseButton(string button, bool down)
    {
        uint flag;
        switch (button)
        {
            case "left": flag = down ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP; break;
            case "right": flag = down ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP; break;
            case "middle": flag = down ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_MIDDLEUP; break;
            default: return;
        }
        INPUT[] inputs = new INPUT[1];
        inputs[0].type = INPUT_MOUSE;
        inputs[0].U.mi.dwFlags = flag;
        SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
    }

    public static void Wheel(int delta, bool horizontal)
    {
        INPUT[] inputs = new INPUT[1];
        inputs[0].type = INPUT_MOUSE;
        inputs[0].U.mi.mouseData = unchecked((uint)delta);
        inputs[0].U.mi.dwFlags = horizontal ? MOUSEEVENTF_HWHEEL : MOUSEEVENTF_WHEEL;
        SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
    }

    public static void Key(ushort scanCode, bool extended, bool down)
    {
        uint flags = KEYEVENTF_SCANCODE;
        if (extended) flags |= KEYEVENTF_EXTENDEDKEY;
        if (!down) flags |= KEYEVENTF_KEYUP;

        INPUT[] inputs = new INPUT[1];
        inputs[0].type = INPUT_KEYBOARD;
        inputs[0].U.ki.wScan = scanCode;
        inputs[0].U.ki.dwFlags = flags;
        SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
    }

    // ---------------- v4.0: pencere yakalama ----------------
    // Tek bir PENCERE paylaşıldığında ikinci imlecin oranlı (0..1) konumu ekranın
    // değil, o pencerenin sınırlarına oturmalı. Sınırlar fiziksel piksel cinsinden
    // lazım (bu süreç PER_MONITOR_AWARE_V2). GetWindowRect DWM'in görünmez gölge
    // kenarlığını da içerdiği için önce genişletilmiş çerçeve sınırı deneniyor;
    // yoksa (Windows 7 / DWM kapalı) klasik dikdörtgene düşülüyor.

    [StructLayout(LayoutKind.Sequential)]
    struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    [DllImport("user32.dll")]
    static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    static extern bool IsWindow(IntPtr hWnd);

    [DllImport("dwmapi.dll")]
    static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out RECT value, int size);

    const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;

    public static int[] WindowRect(long hwnd)
    {
        IntPtr h = new IntPtr(hwnd);
        if (h == IntPtr.Zero || !IsWindow(h)) return null;

        RECT r = new RECT();
        bool ok = false;
        try { ok = DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, out r, Marshal.SizeOf(typeof(RECT))) == 0; }
        catch { ok = false; }
        if (!ok && !GetWindowRect(h, out r)) return null;

        int w = r.Right - r.Left;
        int ht = r.Bottom - r.Top;
        if (w <= 0 || ht <= 0) return null;
        return new int[] { r.Left, r.Top, w, ht };
    }

    // ---------------- v4.0: ekran çözünürlüğü ----------------
    // Client, host'un masaüstü çözünürlüğünü değiştirebiliyor (oyun için 1080p'ye
    // düşürmek gibi). Değişiklik kalıcı yazılmıyor: CDS_UPDATEREGISTRY kullanılıyor
    // ama Electron tarafı orijinal modu saklayıp bağlantı bitince geri koyuyor.

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct DEVMODE
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
        public ushort dmSpecVersion;
        public ushort dmDriverVersion;
        public ushort dmSize;
        public ushort dmDriverExtra;
        public uint dmFields;
        // POINTL dmPosition + dmDisplayOrientation + dmDisplayFixedOutput = 16 bayt,
        // yazıcı tarafındaki 8 short'luk birlik ile aynı boyutta.
        public int dmPositionX;
        public int dmPositionY;
        public uint dmDisplayOrientation;
        public uint dmDisplayFixedOutput;
        public short dmColor;
        public short dmDuplex;
        public short dmYResolution;
        public short dmTTOption;
        public short dmCollate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
        public ushort dmLogPixels;
        public uint dmBitsPerPel;
        public uint dmPelsWidth;
        public uint dmPelsHeight;
        public uint dmDisplayFlags;
        public uint dmDisplayFrequency;
        public uint dmICMMethod;
        public uint dmICMIntent;
        public uint dmMediaType;
        public uint dmDitherType;
        public uint dmReserved1;
        public uint dmReserved2;
        public uint dmPanningWidth;
        public uint dmPanningHeight;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct DISPLAY_DEVICE
    {
        public int cb;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceString;
        public uint StateFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceID;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceKey;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern bool EnumDisplaySettings(string deviceName, int modeNum, ref DEVMODE devMode);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern bool EnumDisplayDevices(string device, uint devNum, ref DISPLAY_DEVICE info, uint flags);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int ChangeDisplaySettingsEx(string deviceName, ref DEVMODE devMode, IntPtr hwnd, uint flags, IntPtr param);

    const int ENUM_CURRENT_SETTINGS = -1;
    const uint CDS_UPDATEREGISTRY = 0x00000001;
    const uint DM_BITSPERPEL = 0x00040000;
    const uint DM_PELSWIDTH = 0x00080000;
    const uint DM_PELSHEIGHT = 0x00100000;
    const uint DM_DISPLAYFREQUENCY = 0x00400000;
    const uint DISPLAY_DEVICE_ATTACHED_TO_DESKTOP = 0x00000001;

    static DEVMODE NewDevMode()
    {
        DEVMODE dm = new DEVMODE();
        dm.dmSize = (ushort)Marshal.SizeOf(typeof(DEVMODE));
        return dm;
    }

    // Verilen masaüstü koordinatını içeren ekran aygıtının adı (örn. \\.\DISPLAY1).
    // Paylaşılan monitörün Electron tarafındaki sınırlarının sol üst köşesi veriliyor.
    public static string DeviceAt(int x, int y)
    {
        for (uint i = 0; i < 16; i++)
        {
            DISPLAY_DEVICE dd = new DISPLAY_DEVICE();
            dd.cb = Marshal.SizeOf(typeof(DISPLAY_DEVICE));
            if (!EnumDisplayDevices(null, i, ref dd, 0)) break;
            if ((dd.StateFlags & DISPLAY_DEVICE_ATTACHED_TO_DESKTOP) == 0) continue;

            DEVMODE dm = NewDevMode();
            if (!EnumDisplaySettings(dd.DeviceName, ENUM_CURRENT_SETTINGS, ref dm)) continue;
            if (x >= dm.dmPositionX && x < dm.dmPositionX + (int)dm.dmPelsWidth &&
                y >= dm.dmPositionY && y < dm.dmPositionY + (int)dm.dmPelsHeight)
                return dd.DeviceName;
        }
        return null;
    }

    public static int[] CurrentMode(string device)
    {
        DEVMODE dm = NewDevMode();
        if (!EnumDisplaySettings(device, ENUM_CURRENT_SETTINGS, ref dm)) return null;
        return new int[] { (int)dm.dmPelsWidth, (int)dm.dmPelsHeight, (int)dm.dmDisplayFrequency, (int)dm.dmBitsPerPel };
    }

    public static string[] ListModes(string device)
    {
        System.Collections.Generic.List<string> list = new System.Collections.Generic.List<string>();
        for (int i = 0; i < 4096; i++)
        {
            DEVMODE dm = NewDevMode();
            if (!EnumDisplaySettings(device, i, ref dm)) break;
            if (dm.dmBitsPerPel < 24) continue;
            if (dm.dmPelsWidth < 800 || dm.dmPelsHeight < 600) continue;
            string s = dm.dmPelsWidth + "x" + dm.dmPelsHeight + "@" + dm.dmDisplayFrequency;
            if (!list.Contains(s)) list.Add(s);
        }
        return list.ToArray();
    }

    // Dönüş: 0 = başarılı (DISP_CHANGE_SUCCESSFUL), negatif = Windows hata kodu.
    public static int SetMode(string device, int w, int h, int hz)
    {
        DEVMODE dm = NewDevMode();
        if (!EnumDisplaySettings(device, ENUM_CURRENT_SETTINGS, ref dm)) return -100;
        dm.dmPelsWidth = (uint)w;
        dm.dmPelsHeight = (uint)h;
        dm.dmFields = DM_PELSWIDTH | DM_PELSHEIGHT | DM_BITSPERPEL;
        if (hz > 0)
        {
            dm.dmDisplayFrequency = (uint)hz;
            dm.dmFields |= DM_DISPLAYFREQUENCY;
        }
        return ChangeDisplaySettingsEx(device, ref dm, IntPtr.Zero, CDS_UPDATEREGISTRY, IntPtr.Zero);
    }
}
"@

# ---- C# derleme önbelleği (v3.1.5) ----
# "Add-Type -TypeDefinition" her açılışta C# derleyicisini (csc.exe) ayağa kaldırır.
# Tek başına 1.5-3 saniye sürüyordu ve host'un açılışını geciktiren en büyük kalemdi:
# köprü hazır olana kadar gelen fare/klavye komutları işlenemiyordu.
# Artık derleme bir kez yapılıp DLL olarak önbelleğe alınıyor; sonraki açılışlar hazır
# derlemeyi yüklüyor (~100 ms). Dosya adı kaynağın SHA-256 özetini taşıdığı için bu
# script değiştiğinde önbellek kendiliğinden yenilenir - elle temizlik gerekmez.

function Get-SourceHash {
    param([string]$Text)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Text))
        return ([System.BitConverter]::ToString($bytes) -replace '-', '').Substring(0, 16)
    } finally { $sha.Dispose() }
}

function Initialize-InputSim {
    param([string]$Source)

    if ('InputSim' -as [type]) { return }

    $cacheDir = Join-Path $env:LOCALAPPDATA 'GameLink\bridge-cache'
    $cacheDll = Join-Path $cacheDir ("InputSim-" + (Get-SourceHash $Source) + ".dll")

    # 1) Hızlı yol: önbellek varsa doğrudan yükle.
    if (Test-Path -LiteralPath $cacheDll) {
        try {
            Add-Type -Path $cacheDll -ErrorAction Stop
            if ('InputSim' -as [type]) { Write-Output "SIM-CACHED"; return }
        } catch { }   # bozuk/yarım dosya: aşağıda yeniden derlenir
    }

    # 2) Yavaş yol: derle ve önbelleğe yaz. Önce geçici ada yazılıp taşınıyor; iki host
    #    aynı anda açılırsa yarım bir DLL geride kalmasın.
    try {
        if (-not (Test-Path -LiteralPath $cacheDir)) {
            New-Item -ItemType Directory -Force -Path $cacheDir -ErrorAction Stop | Out-Null
        }
        $tmp = Join-Path $cacheDir ("build-" + [guid]::NewGuid().ToString('N') + ".dll")
        Add-Type -TypeDefinition $Source -Language CSharp -OutputAssembly $tmp -OutputType Library -ErrorAction Stop

        # Taşıma başarısız olabilir (başka bir host aynı DLL'i kilitlemiş olabilir);
        # o durumda zaten geçerli bir önbellek var demektir.
        try { Move-Item -LiteralPath $tmp -Destination $cacheDll -Force -ErrorAction Stop }
        catch { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }

        if (-not ('InputSim' -as [type])) {
            $dll = @($cacheDll, $tmp) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
            Add-Type -Path $dll -ErrorAction Stop
        }
        Write-Output "SIM-COMPILED"
    } catch {
        # Önbellek yazılamadı/yüklenemedi (salt okunur disk, izin, AV engeli):
        # eski yönteme dön - yavaş ama her koşulda çalışır.
        if (-not ('InputSim' -as [type])) { Add-Type -TypeDefinition $Source -Language CSharp }
        Write-Output "SIM-NOCACHE"
    }
}

Initialize-InputSim -Source $code

[InputSim]::MakeDpiAware()

# ---- Basılı durum takibi ----
# Köprünün kendisi neyi bastığını bilir; böylece bağlantı koptuğunda (ya da bu süreç
# kapanırken) hiçbir tuş/buton basılı kalmaz. "Forza'da gaz tuşunun yapışması"
# senaryosunun son savunma hattı budur - renderer çökse bile burada temizlenir.
$pressedKeys = @{}      # "scan:ext" -> @{ scan = <int>; ext = <bool> }
$pressedButtons = @{}   # "left"/"right"/"middle" -> $true

# ---- İkinci imleç (ghost) durumu ----
# Windows'ta masaüstü başına TEK sistem imleci vardır; ikinci bir imleç ancak
# "hayalet imleç" olarak taklit edilebilir:
#   * Konum ($ghost) yalnızca burada tutulur, gerçek imlece dokunulmaz -> host
#     kullanıcısı kendi faresini kullanmaya devam eder.
#   * Tıklama anında imleç bir kaç milisaniyeliğine ödünç alınır: fiziksel girdi
#     BlockInput ile dondurulur, imleç hayaletin konumuna götürülür, tıklama
#     enjekte edilir, imleç eski yerine geri konur, blok kalkar.
#   * Sürükleme sırasında (buton basılıyken) imleç hayaleti takip etmek zorundadır;
#     buton bırakılınca kaydedilen konuma geri döner.
$ghost = @{ x = 0; y = 0; valid = $false }
$ghostOwning = $false   # şu an gerçek imleci hayalet mi tutuyor (sürükleme)
$savedPos = $null       # ödünç almadan önceki gerçek imleç konumu

function Restore-Ghost {
    if ($null -ne $script:savedPos) {
        try { [InputSim]::SetPos($script:savedPos[0], $script:savedPos[1]) } catch { }
        $script:savedPos = $null
    }
    $script:ghostOwning = $false
}

function Borrow-Begin {
    # Ödünç alma başlangıcı: fiziksel girdiyi dondur ve gerçek imlecin yerini sakla.
    [InputSim]::Block($true)
    if (-not $script:ghostOwning -and $null -eq $script:savedPos) {
        $script:savedPos = [InputSim]::GetPos()
    }
    if ($script:ghost.valid) {
        try { [InputSim]::SetPos([int]$script:ghost.x, [int]$script:ghost.y) } catch { }
    }
}

function Borrow-End {
    [InputSim]::Block($false)
}

function Ghost-Button {
    param([string]$btn, [bool]$down)
    if (-not $script:ghost.valid) { return }
    Borrow-Begin
    try {
        [InputSim]::MouseButton($btn, $down)
        if ($down) {
            $script:pressedButtons[$btn] = $true
            # Sürükleme başladı: buton bırakılana kadar gerçek imleç hayaleti izler.
            $script:ghostOwning = $true
        } else {
            $script:pressedButtons.Remove($btn)
            if ($script:pressedButtons.Count -eq 0) { Restore-Ghost }
        }
    } finally { Borrow-End }
}

function Ghost-Wheel {
    param([int]$delta, [bool]$horizontal)
    # Tekerlek, imlecin ALTINDAKİ pencereye gider; bu yüzden burada da ödünç almak
    # zorundayız. Sürükleme sürüyorsa imleç zaten hayalette, geri koymuyoruz.
    if (-not $script:ghost.valid) { [InputSim]::Wheel($delta, $horizontal); return }
    $wasOwning = $script:ghostOwning
    Borrow-Begin
    try {
        [InputSim]::Wheel($delta, $horizontal)
        if (-not $wasOwning -and $script:pressedButtons.Count -eq 0) { Restore-Ghost }
    } finally { Borrow-End }
}

# v4.0: sorgu yanıtları PowerShell'in çıktı ardışık düzenine değil doğrudan
# stdout'a yazılıyor. Yanıtı bekleyen taraf var; satır tamponda beklememeli.
function Send-Reply {
    param($Object)
    try {
        [Console]::Out.WriteLine(($Object | ConvertTo-Json -Compress -Depth 3))
        [Console]::Out.Flush()
    } catch { }
}

function Release-All {
    foreach ($entry in @($pressedKeys.Values)) {
        try { [InputSim]::Key([uint16]$entry.scan, [bool]$entry.ext, $false) } catch { }
    }
    $pressedKeys.Clear()

    if ($script:ghostOwning) {
        # Hayalet sürükleme ortasında koptu: butonu hayaletin konumunda bırak,
        # sonra gerçek imleci sahibine iade et.
        [InputSim]::Block($true)
        try {
            foreach ($btn in @($pressedButtons.Keys)) {
                try { [InputSim]::MouseButton($btn, $false) } catch { }
            }
            $pressedButtons.Clear()
            Restore-Ghost
        } finally { [InputSim]::Block($false) }
    } else {
        foreach ($btn in @($pressedButtons.Keys)) {
            try { [InputSim]::MouseButton($btn, $false) } catch { }
        }
        $pressedButtons.Clear()
    }

    $script:savedPos = $null
    $script:ghostOwning = $false
}

Write-Output "READY"

try {
    while ($true) {
        $line = [Console]::In.ReadLine()
        if ($null -eq $line) { break }
        if ([string]::IsNullOrWhiteSpace($line)) { continue }

        try {
            $cmd = $line | ConvertFrom-Json
            switch ($cmd.t) {
                "m" { [InputSim]::MoveRelative([int]$cmd.dx, [int]$cmd.dy) }
                "b" {
                    $down = [bool]$cmd.down
                    [InputSim]::MouseButton($cmd.btn, $down)
                    if ($down) { $pressedButtons[$cmd.btn] = $true }
                    else { $pressedButtons.Remove($cmd.btn) }
                }
                "w" {
                    $horizontal = $false
                    if ($null -ne $cmd.h) { $horizontal = [bool]$cmd.h }
                    [InputSim]::Wheel([int]$cmd.delta, $horizontal)
                }
                "k" {
                    $scan = [int]$cmd.scan
                    $ext = [bool]$cmd.ext
                    $down = [bool]$cmd.down
                    [InputSim]::Key([uint16]$scan, $ext, $down)
                    $key = "$scan`:$ext"
                    if ($down) { $pressedKeys[$key] = @{ scan = $scan; ext = $ext } }
                    else { $pressedKeys.Remove($key) }
                }
                "r" { Release-All }

                # ---- İkinci imleç komutları (fiziksel piksel koordinatları) ----
                "gp" {
                    $ghost.x = [int]$cmd.x
                    $ghost.y = [int]$cmd.y
                    $ghost.valid = $true
                    # Sürükleme sürüyorsa gerçek imleç hayaleti izlemek zorunda.
                    if ($script:ghostOwning) { [InputSim]::SetPos([int]$ghost.x, [int]$ghost.y) }
                }
                "gb" { Ghost-Button -btn $cmd.btn -down ([bool]$cmd.down) }
                "gw" {
                    $horizontal = $false
                    if ($null -ne $cmd.h) { $horizontal = [bool]$cmd.h }
                    Ghost-Wheel -delta ([int]$cmd.delta) -horizontal $horizontal
                }
                # Hayalet mod kapatıldı: varsa sürüklemeyi bitir, imleci iade et.
                "gx" {
                    if ($script:ghostOwning) { Release-All }
                    $ghost.valid = $false
                }

                # ---- v4.0: sorgular ----
                # Bu üç komut stdout'a JSON satırı yazar; Electron tarafı '{' ile
                # başlayan satırları günlüğe değil, bekleyen isteğe yönlendirir.
                # Yanıtın 'id' alanı isteğin id'siyle eşleşir.
                "wr" {
                    $rect = $null
                    try { $rect = [InputSim]::WindowRect([int64]$cmd.hwnd) } catch { }
                    Send-Reply @{ t = 'wr'; id = $cmd.id; r = $rect }
                }
                "dm" {
                    $dev = $null; $modes = @(); $cur = $null
                    try {
                        $dev = [InputSim]::DeviceAt([int]$cmd.x, [int]$cmd.y)
                        if ($dev) {
                            $modes = @([InputSim]::ListModes($dev))
                            $cur = [InputSim]::CurrentMode($dev)
                        }
                    } catch { }
                    Send-Reply @{ t = 'dm'; id = $cmd.id; dev = $dev; cur = $cur; modes = $modes }
                }
                "ds" {
                    # -1 = aygıt bulunamadı; 0 = başarılı; diğer negatifler Windows hata kodu.
                    $result = -1
                    try {
                        $dev = $cmd.dev
                        if ([string]::IsNullOrEmpty($dev)) { $dev = [InputSim]::DeviceAt([int]$cmd.x, [int]$cmd.y) }
                        if ($dev) { $result = [InputSim]::SetMode($dev, [int]$cmd.w, [int]$cmd.h, [int]$cmd.hz) }
                    } catch { }
                    Send-Reply @{ t = 'ds'; id = $cmd.id; code = $result }
                }
            }
        } catch {
            # geçersiz satırı yoksay, döngü kesilmesin
            continue
        }
    }
} finally {
    # stdin kapandı (host süreci öldü/kapandı) - hiçbir şey basılı kalmasın ve
    # gerçek imleç kesinlikle sahibine geri dönsün.
    Release-All
    [InputSim]::Block($false)
}
