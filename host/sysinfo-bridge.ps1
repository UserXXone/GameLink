# GameLink v4.0 — Sistem bilgisi köprüsü
#
# Host'un donanım kullanımını client'a taşımak için kullanılıyor: eski
# bilgisayarlardaki disk/ağ etkinlik ışıkları gibi yanıp sönen göstergeler ve
# CPU/RAM/disk/ağ değerleri.
#
# Neden ayrı bir süreç: girdi köprüsü (input-bridge.ps1) gecikmeye duyarlı, WMI
# sorgusu oraya konursa fare/klavye paketleri arkasında bekler. Bu köprü ise
# yalnızca bir client bilgileri istediğinde başlatılıyor, istek bitince kapanıyor.
#
# Neden PerformanceCounter değil: .NET'in PerformanceCounter sınıfı kategori
# adlarını YERELLEŞTİRİLMİŞ olarak bekler ("Processor" Türkçe Windows'ta farklı
# ada sahiptir) ve bu sessizce çalışmamaya yol açar. WMI'nin Win32_PerfRawData_*
# sınıf adları ise her dilde aynıdır.
#
# stdout'a satır satır JSON yazar:
#   {"t":"static", ...}   bir kez, açılışta
#   {"t":"disks", ...}    30 saniyede bir (boş alan değişir)
#   {"t":"tick", ...}     250 ms'de bir (disk/ağ etkinliği)
#
# CPU ve RAM burada ÖLÇÜLMÜYOR: Electron tarafı bunları os.cpus()/os.freemem ile
# alt süreç maliyeti olmadan hesaplıyor.

param(
    [int]$ParentPid = 0
)

$ErrorActionPreference = 'SilentlyContinue'

# PowerShell'in çıktı ardışık düzeni yerine doğrudan stdout'a yazıyoruz: satır
# anında karşıya geçsin, tamponda beklemesin.
function Send-Line {
    param([string]$Text)
    try {
        [Console]::Out.WriteLine($Text)
        [Console]::Out.Flush()
    } catch { }
}

function Send-Json {
    param($Object)
    Send-Line ($Object | ConvertTo-Json -Compress -Depth 4)
}

# ---------------- Statik bilgi (bir kez) ----------------

# Sanal makine göstergeleri: VDS/VM üzerinde donanım hızlandırmanın kapatılması
# gerekiyor, ayrıca client'ta "sanal makine" rozeti gösteriliyor.
$VM_MARKERS = @(
    'vmware', 'virtualbox', 'innotek', 'qemu', 'kvm', 'xen', 'bochs',
    'parallels', 'virtual machine', 'hyper-v', 'microsoft corporation virtual',
    'openstack', 'oracle corporation', 'proxmox', 'bhyve', 'amazon ec2', 'google compute'
)

function Test-VirtualMachine {
    param([string]$Manufacturer, [string]$Model, [string]$Bios)
    $haystack = ("$Manufacturer $Model $Bios").ToLowerInvariant()
    foreach ($marker in $VM_MARKERS) {
        if ($haystack.Contains($marker)) { return $true }
    }
    return $false
}

function Get-DiskList {
    $disks = @()
    try {
        foreach ($d in @(Get-CimInstance -ClassName Win32_LogicalDisk -Filter 'DriveType=3')) {
            $disks += @{
                id    = $d.DeviceID
                label = $d.VolumeName
                size  = [double]$d.Size
                free  = [double]$d.FreeSpace
            }
        }
    } catch { }
    # Baştaki virgül önemli: PowerShell fonksiyondan dönerken tek elemanlı diziyi
    # düz değere çevirir, JSON'da dizi yerine nesne çıkardı.
    return ,$disks
}

function Send-Static {
    param([string]$DiskSource = 'none')

    $cpuName = $null; $cores = 0; $threads = 0; $mhz = 0
    try {
        $cpu = @(Get-CimInstance -ClassName Win32_Processor)[0]
        if ($cpu) {
            $cpuName = $cpu.Name
            $cores = [int]$cpu.NumberOfCores
            $threads = [int]$cpu.NumberOfLogicalProcessors
            $mhz = [int]$cpu.MaxClockSpeed
        }
    } catch { }

    $manufacturer = $null; $model = $null; $totalMem = 0
    try {
        $cs = Get-CimInstance -ClassName Win32_ComputerSystem
        if ($cs) {
            $manufacturer = $cs.Manufacturer
            $model = $cs.Model
            $totalMem = [double]$cs.TotalPhysicalMemory
        }
    } catch { }

    $bios = $null
    try { $bios = (Get-CimInstance -ClassName Win32_BIOS).Manufacturer } catch { }

    $gpus = @()
    try {
        foreach ($g in @(Get-CimInstance -ClassName Win32_VideoController)) {
            if ($g.Name) { $gpus += $g.Name }
        }
    } catch { }

    $osName = $null; $osBuild = $null
    try {
        $os = Get-CimInstance -ClassName Win32_OperatingSystem
        if ($os) { $osName = $os.Caption; $osBuild = $os.BuildNumber }
    } catch { }

    Send-Json @{
        t            = 'static'
        cpu          = @{ name = $cpuName; cores = $cores; threads = $threads; mhz = $mhz }
        gpu          = $gpus
        os           = @{ name = $osName; build = $osBuild }
        machine      = @{ manufacturer = $manufacturer; model = $model; bios = $bios }
        memTotal     = $totalMem
        vm           = (Test-VirtualMachine -Manufacturer $manufacturer -Model $model -Bios $bios)
        rdpSession   = ($env:SESSIONNAME -like 'RDP-*')
        disks        = (Get-DiskList)
        # Tanı: disk etkinliği hangi yoldan ölçülüyor ('perf' hızlı, 'wmi' yavaş,
        # 'none' hiç ölçülemiyor -> client disk ışığını gizler).
        diskSource   = $DiskSource
    }
}

# ---------------- Ağ etkinliği (saf .NET, ucuz ve dilden bağımsız) ----------------

function Get-NetTotals {
    $rx = [double]0; $tx = [double]0
    try {
        foreach ($nic in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
            if ($nic.OperationalStatus -ne [System.Net.NetworkInformation.OperationalStatus]::Up) { continue }
            if ($nic.NetworkInterfaceType -eq [System.Net.NetworkInformation.NetworkInterfaceType]::Loopback) { continue }
            if ($nic.NetworkInterfaceType -eq [System.Net.NetworkInformation.NetworkInterfaceType]::Tunnel) { continue }
            try {
                $s = $nic.GetIPv4Statistics()
                $rx += [double]$s.BytesReceived
                $tx += [double]$s.BytesSent
            } catch { }
        }
    } catch { }
    return @($rx, $tx)
}

# ---------------- Disk etkinliği ----------------
#
# İki yol var, hızlısı tercih ediliyor:
#
# A) PerformanceCounter (~1 ms/örnek). Sorun şu ki .NET bu sınıfa YERELLEŞTİRİLMİŞ
#    kategori/sayaç adı bekler; "PhysicalDisk" Türkçe Windows'ta çalışmaz. Windows
#    sayaç adlarını kayıt defterinde indeks->ad olarak tutar: Perflib\009 İngilizce,
#    Perflib\CurrentLanguage yerel dil. İkisini indeks üzerinden eşleyip İngilizce
#    adı yerel ada çeviriyoruz. Bu çeviri bir kez yapılıyor.
#
# B) WMI ham sayaçları (~300-600 ms/örnek). Yavaş ama sayaç kaydı bozuksa çalışan
#    tek yol. Yalnızca A başarısız olursa kullanılıyor ve saniyede bir örnekleniyor.
#
# Her iki yolda da _Total örneği tüm diskleri topladığı için yüzde 100'ü aşabilir;
# kırpılıyor.

$diskMode = 'none'      # 'perf' | 'wmi' | 'none'
$pcDiskTime = $null
$pcDiskRead = $null
$pcDiskWrite = $null
$diskFailures = 0

function Get-CounterNameMap {
    try {
        $base = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Perflib'
        $en = (Get-ItemProperty -Path "$base\009" -Name Counter -ErrorAction Stop).Counter
        if (-not $en) { return $null }
        $loc = (Get-ItemProperty -Path "$base\CurrentLanguage" -Name Counter -ErrorAction SilentlyContinue).Counter
        # CurrentLanguage bazı sistemlerde yok. O zaman İngilizce adların kendisi
        # geçerlidir (İngilizce Windows) — birebir eşleme kuruyoruz.
        if (-not $loc) { $loc = $en }

        # Liste düz bir dizidir: indeks, ad, indeks, ad, ...
        $byIndex = @{}
        for ($i = 0; $i + 1 -lt $loc.Count; $i += 2) { $byIndex[$loc[$i]] = $loc[$i + 1] }

        $map = @{}
        for ($i = 0; $i + 1 -lt $en.Count; $i += 2) {
            $idx = $en[$i]
            $name = $en[$i + 1]
            if ($byIndex.ContainsKey($idx)) { $map[$name] = $byIndex[$idx] }
        }
        return $map
    } catch { return $null }
}

function Initialize-DiskCounters {
    $map = Get-CounterNameMap
    if ($null -eq $map) { return $false }
    try {
        $cat = $map['PhysicalDisk']
        $nTime = $map['% Disk Time']
        $nRead = $map['Disk Read Bytes/sec']
        $nWrite = $map['Disk Write Bytes/sec']
        if (-not $cat -or -not $nTime -or -not $nRead -or -not $nWrite) { return $false }

        $script:pcDiskTime = New-Object System.Diagnostics.PerformanceCounter($cat, $nTime, '_Total', $true)
        $script:pcDiskRead = New-Object System.Diagnostics.PerformanceCounter($cat, $nRead, '_Total', $true)
        $script:pcDiskWrite = New-Object System.Diagnostics.PerformanceCounter($cat, $nWrite, '_Total', $true)
        # İlk okuma her zaman 0 döner (referans örnek); burada tüketiliyor.
        $null = $script:pcDiskTime.NextValue()
        $null = $script:pcDiskRead.NextValue()
        $null = $script:pcDiskWrite.NextValue()
        return $true
    } catch { return $false }
}

# 'perf' yolunda değerler zaten hesaplanmış gelir.
function Get-DiskSample {
    try {
        return @{
            busy  = [Math]::Min(100, [Math]::Max(0, [double]$script:pcDiskTime.NextValue()))
            read  = [Math]::Max(0, [double]$script:pcDiskRead.NextValue())
            write = [Math]::Max(0, [double]$script:pcDiskWrite.NextValue())
        }
    } catch {
        $script:diskFailures++
        if ($script:diskFailures -ge 3) { $script:diskMode = 'none' }
        return $null
    }
}

# 'wmi' yolunda ham (kümülatif) sayaçlar gelir; oranı farktan hesaplıyoruz.
function Get-DiskRaw {
    try {
        $d = Get-CimInstance -ClassName Win32_PerfRawData_PerfDisk_PhysicalDisk -Filter "Name='_Total'" -ErrorAction Stop
        if ($null -eq $d) { throw 'sayac yok' }
        return @{
            busy  = [double]$d.PercentDiskTime
            read  = [double]$d.DiskReadBytesPersec
            write = [double]$d.DiskWriteBytesPersec
            ts    = [double]$d.Timestamp_Sys100NS
        }
    } catch {
        $script:diskFailures++
        # Bozuk sayaç kaydı ya da kısıtlı VDS şablonu: vazgeç, client disk ışığını gizler.
        if ($script:diskFailures -ge 2) { $script:diskMode = 'none' }
        return $null
    }
}

if (Initialize-DiskCounters) {
    $diskMode = 'perf'
} else {
    $diskFailures = 0
    if ($null -ne (Get-DiskRaw)) { $diskMode = 'wmi'; $diskFailures = 0 }
}

# Statik bilgi en son gönderiliyor: hangi disk ölçüm yolunun seçildiği de
# içinde gitsin, client tanı için görebilsin.
Send-Static -DiskSource $diskMode

# ---------------- Ana döngü ----------------

$netPrev = Get-NetTotals
$netPrevAt = [System.Diagnostics.Stopwatch]::StartNew()

$diskPrev = $null
if ($diskMode -eq 'wmi') { $diskPrev = Get-DiskRaw }

$diskBusy = 0.0; $diskRead = 0.0; $diskWrite = 0.0
$tickCount = 0

# WMI yolu yavaş olduğu için orada 1 saniyede bir, hızlı yolda her turda örnekleniyor.
$diskEvery = $(if ($diskMode -eq 'wmi') { 4 } else { 1 })

while ($true) {
    Start-Sleep -Milliseconds 250
    $tickCount++

    # Electron çökerse yetim bir PowerShell geride kalmasın.
    if ($ParentPid -gt 0 -and ($tickCount % 8) -eq 0) {
        if (-not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { break }
    }

    # Ağ: her turda (saf .NET, ucuz)
    $netNow = Get-NetTotals
    $elapsed = $netPrevAt.Elapsed.TotalSeconds
    $netPrevAt.Restart()
    $rxBps = 0.0; $txBps = 0.0
    if ($elapsed -gt 0) {
        $rxBps = [Math]::Max(0, ($netNow[0] - $netPrev[0]) / $elapsed)
        $txBps = [Math]::Max(0, ($netNow[1] - $netPrev[1]) / $elapsed)
    }
    $netPrev = $netNow

    if ($diskMode -ne 'none' -and ($tickCount % $diskEvery) -eq 0) {
        if ($diskMode -eq 'perf') {
            $sample = Get-DiskSample
            if ($null -ne $sample) {
                $diskBusy = $sample.busy
                $diskRead = $sample.read
                $diskWrite = $sample.write
            }
        } else {
            $diskNow = Get-DiskRaw
            if ($null -ne $diskNow -and $null -ne $diskPrev) {
                $dt = $diskNow.ts - $diskPrev.ts
                if ($dt -gt 0) {
                    $seconds = $dt / 1e7
                    $diskBusy = [Math]::Min(100, [Math]::Max(0, 100 * ($diskNow.busy - $diskPrev.busy) / $dt))
                    $diskRead = [Math]::Max(0, ($diskNow.read - $diskPrev.read) / $seconds)
                    $diskWrite = [Math]::Max(0, ($diskNow.write - $diskPrev.write) / $seconds)
                }
            }
            if ($null -ne $diskNow) { $diskPrev = $diskNow }
        }
    }

    $diskPayload = $null
    if ($diskMode -ne 'none') {
        $diskPayload = @{
            busy  = [Math]::Round($diskBusy, 1)
            read  = [Math]::Round($diskRead)
            write = [Math]::Round($diskWrite)
        }
    }

    Send-Json @{
        t    = 'tick'
        disk = $diskPayload
        net  = @{ rx = [Math]::Round($rxBps); tx = [Math]::Round($txBps) }
    }

    # Boş disk alanı 30 saniyede bir tazelensin (dosya aktarımı sonrası değişir).
    if (($tickCount % 120) -eq 0) {
        Send-Json @{ t = 'disks'; disks = (Get-DiskList) }
    }
}
