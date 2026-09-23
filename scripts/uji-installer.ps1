# Uji pasang-jalankan-lepas installer Finova secara nyata.
# Pemakaian: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\uji-installer.ps1
#
# Yang diuji adalah jalur TERPASANG: biner di %LOCALAPPDATA%\Programs\Finova, data di
# AppData (disuling ke folder sementara supaya %APPDATA%\Finova asli tidak tersentuh),
# dan jendela WebView2 — bukan tab peramban.
$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinMsg {
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
}
"@

$root = Split-Path -Parent $PSScriptRoot
$setup = Join-Path $root 'build\bin\Finova-Setup-1.0.0-amd64.exe'
$installDir = Join-Path $env:LOCALAPPDATA 'Programs\Finova'
$fakeAppData = Join-Path $env:TEMP ('finova-uji-appdata-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$port = 5296
$url = "http://127.0.0.1:$port"
$started = @()

function Step($text) { Write-Host "`n=== $text ===" -ForegroundColor Cyan }

# Menjalankan biner terpasang dengan AppData tersuling. cwd sengaja di TEMP supaya tidak
# ada go.mod di dekatnya — kalau ada, data akan ditulis ke ./database alih-alih AppData.
function Start-Finova([string]$arguments) {
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = (Join-Path $installDir 'finova.exe')
  $psi.Arguments = $arguments
  $psi.WorkingDirectory = $env:TEMP
  $psi.UseShellExecute = $false
  $psi.EnvironmentVariables['APPDATA'] = $fakeAppData
  $proc = [System.Diagnostics.Process]::Start($psi)
  $script:started += $proc.Id
  return $proc
}

# Tunggu proses muncul/hilang. Mengembalikan $true bila keadaan yang diinginkan tercapai.
function Wait-FinovaProcess([int]$pidTarget, [bool]$wantExit, [int]$tries = 80) {
  for ($i = 0; $i -lt $tries; $i++) {
    Start-Sleep -Milliseconds 250
    $p = Get-Process -Id $pidTarget -ErrorAction SilentlyContinue
    if ($wantExit) { if (-not $p) { return $true } }
    elseif (-not $p.HasExited) { return $true }
  }
  return $false
}

# MainWindowHandle sering masih 0 sesaat setelah proses hidup, jadi dipoll.
function Get-FinovaWindowHandle([int]$pidTarget, [int]$tries = 60) {
  for ($i = 0; $i -lt $tries; $i++) {
    $p = Get-Process -Id $pidTarget -ErrorAction SilentlyContinue
    if ($p -and $p.MainWindowHandle -ne [IntPtr]::Zero) { return $p.MainWindowHandle.ToInt64() }
    Start-Sleep -Milliseconds 250
  }
  return 0
}

try {
  if (-not (Test-Path $setup)) { throw "Installer tidak ada: $setup" }
  Write-Host "Ukuran installer: $([math]::Round((Get-Item $setup).Length / 1MB, 1)) MiB"

  Step '1. Pasang senyap'
  $p = Start-Process -FilePath $setup -ArgumentList '/S' -Wait -PassThru
  Write-Host "kode keluar installer: $($p.ExitCode)"
  Get-ChildItem $installDir | ForEach-Object { Write-Host ("  {0,10:N0} KB  {1}" -f ($_.Length / 1KB), $_.Name) }

  Step '2. registry & pintasan'
  $arpu = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Finova' -ErrorAction SilentlyContinue
  if ($arpu) {
    Write-Host "  DisplayName    : $($arpu.DisplayName)"
    Write-Host "  DisplayVersion : $($arpu.DisplayVersion)"
    Write-Host "  InstallLocation: $($arpu.InstallLocation)"
    Write-Host "  EstimatedSize  : $([math]::Round($arpu.EstimatedSize / 1024, 1)) MiB"
  } else { Write-Host '  KUNCI ARPU HILANG!' -ForegroundColor Red }
  $sm = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Finova'
  Get-ChildItem $sm -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  pintasan: $($_.Name)" }

  Step '3. Jalankan sebagai aplikasi desktop (data di AppData, cwd tanpa go.mod)'
  New-Item -ItemType Directory -Force -Path $fakeAppData | Out-Null
  $proc = Start-Finova "-app -port $port"
  $ready = $false
  for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Milliseconds 250
    try { Invoke-RestMethod "$url/api/health" -TimeoutSec 1 | Out-Null; $ready = $true; break } catch {}
  }
  Write-Host "  server siap    : $ready (pid $($proc.Id))"
  $health = Invoke-RestMethod "$url/api/health"
  Write-Host "  /api/health    : $($health | ConvertTo-Json -Compress)"
  $spa = Invoke-WebRequest "$url/" -UseBasicParsing
  Write-Host "  GET /          : $($spa.StatusCode), panjang $($spa.Content.Length) byte, ada root React: $($spa.Content -match 'id=\"root\"')"
  $accounts = Invoke-RestMethod "$url/api/accounts"
  Write-Host "  akun           : $($accounts.accounts.Count) baris (1100 = $($accounts.accounts[0].name))"
  $post = @{ voucherNo = 'UJI-INS-001'; entryDate = (Get-Date -Format 'yyyy-MM-15'); description = 'Uji installer'; status = 'POSTED'; lines = @(
      @{ account_id = 1; debit = 250000; credit = 0 }, @{ account_id = 20; debit = 0; credit = 250000 }
    ) } | ConvertTo-Json -Depth 5
  $made = Invoke-RestMethod "$url/api/journals" -Method Post -ContentType 'application/json' -Body $post
  Write-Host "  jurnal baru    : id $($made.id) bukti $($made.voucherNo)"
  $tb = Invoke-RestMethod "$url/api/reports/trial-balance"
  Write-Host "  neraca saldo   : debit $($tb.data.totals.debit) kredit $($tb.data.totals.credit) seimbang $($tb.data.isBalanced)"

  Step '4. Jendela native benar-benar terbuka'
  $hwnd = Get-FinovaWindowHandle -pidTarget $proc.Id
  $live = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
  Write-Host "  handle jendela : $hwnd"
  Write-Host "  judul          : '$($live.MainWindowTitle)'"
  if ($hwnd -eq 0) { Write-Host '  JENDELA TIDAK KETEMU - uji berikutnya lewat jendela tidak valid' -ForegroundColor Red }

  Step '5. Lokasi data harus di AppData (bukan folder instalasi)'
  Get-ChildItem $fakeAppData -Recurse -Filter '*.sqlite*' | ForEach-Object {
    Write-Host "  $($_.FullName.Substring($fakeAppData.Length))  $($_.Length) byte"
  }
  $profil = Join-Path $fakeAppData 'Finova\webview2'
  Write-Host "  profil WebView2   : $(if (Test-Path $profil) { 'ada' } else { 'TIDAK ADA' })"
  Write-Host "  total berkas uji  : $(@(Get-ChildItem $fakeAppData -Recurse -File).Count) di $fakeAppData"
  $salah = Get-ChildItem $installDir -Filter '*.sqlite*' -ErrorAction SilentlyContinue
  Write-Host "  berkas sqlite di folder instalasi: $($salah.Count)"

  Step '6. Instans kedua mengangkat jendela, bukan menyalakan server kedua'
  $second = Start-Finova "-app -port $port"
  $gone = Wait-FinovaProcess -pidTarget $second.Id -wantExit $true
  Write-Host "  instans kedua keluar sendiri : $gone (kode $($second.ExitCode))"
  $firstAlive = [bool](Get-Process -Id $proc.Id -ErrorAction SilentlyContinue)
  Write-Host "  instans pertama tetap hidup  : $firstAlive"
  $stillServing = try { (Invoke-RestMethod "$url/api/health" -TimeoutSec 2).service -eq 'finova-api' } catch { $false }
  Write-Host "  port $port masih dilayani instans pertama : $stillServing"

  Step '7. Tutup jendela = proses keluar & port lepas'
  if ($hwnd -ne 0) {
    [WinMsg]::PostMessage([IntPtr]$hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
  } else {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  }
  $closed = Wait-FinovaProcess -pidTarget $proc.Id -wantExit $true
  Write-Host "  proses berhenti setelah jendela ditutup: $closed"
  $portFree = try { Invoke-RestMethod "$url/api/health" -TimeoutSec 2 | Out-Null; $false } catch { $true }
  Write-Host "  port $port sudah lepas: $portFree"

  Step '8. Lepas senyap'
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
  $un = Join-Path $installDir 'uninstall.exe'
  Start-Process -FilePath $un -ArgumentList '/S' -Wait
  Write-Host "  folder instalasi masih ada: $(Test-Path $installDir)"
  Write-Host "  kunci ARPU masih ada: $($null -ne (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Finova' -ErrorAction SilentlyContinue))"
  Write-Host "  pintasan Start Menu masih ada: $(Test-Path $sm)"
  Write-Host "  data di AppData (mode senyap) dipertahankan: $(Test-Path (Join-Path $fakeAppData 'Finova\finova.sqlite'))"
}
finally {
  foreach ($id in $started) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
  Stop-Process -Name finova -Force -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $fakeAppData -ErrorAction SilentlyContinue
  Write-Host "`nbersih: folder uji sementara dihapus." -ForegroundColor DarkGray
  Write-Host 'catatan: %APPDATA%\Finova yang asli tidak disentuh (uji memakai AppData tersuling).' -ForegroundColor DarkGray
}
