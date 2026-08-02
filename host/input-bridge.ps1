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

Add-Type -TypeDefinition $code -Language CSharp

# ---- Basılı durum takibi ----
# Köprünün kendisi neyi bastığını bilir; böylece bağlantı koptuğunda (ya da bu süreç
# kapanırken) hiçbir tuş/buton basılı kalmaz. "Forza'da gaz tuşunun yapışması"
# senaryosunun son savunma hattı budur - renderer çökse bile burada temizlenir.
$pressedKeys = @{}      # "scan:ext" -> @{ scan = <int>; ext = <bool> }
$pressedButtons = @{}   # "left"/"right"/"middle" -> $true

function Release-All {
    foreach ($entry in @($pressedKeys.Values)) {
        try { [InputSim]::Key([uint16]$entry.scan, [bool]$entry.ext, $false) } catch { }
    }
    $pressedKeys.Clear()

    foreach ($btn in @($pressedButtons.Keys)) {
        try { [InputSim]::MouseButton($btn, $false) } catch { }
    }
    $pressedButtons.Clear()
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
            }
        } catch {
            # geçersiz satırı yoksay, döngü kesilmesin
            continue
        }
    }
} finally {
    # stdin kapandı (host süreci öldü/kapandı) - hiçbir şey basılı kalmasın
    Release-All
}
