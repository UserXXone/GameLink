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
