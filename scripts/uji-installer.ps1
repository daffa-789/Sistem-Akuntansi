# Uji pasang-jalankan-lepas installer Finova secara nyata.
# Pemakaian: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\uji-installer.ps1
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$setup = Join-Path $root 'build\bin\Finova-Setup-1.0.0-amd64.exe'
$installDir = Join-Path $env:LOCALAPPDATA 'Programs\Finova'
$appData = Join-Path $env:APPDATA 'Finova'
$fakeAppData = Join-Path $env:TEMP ('finova-uji-appdata-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$port = 5296
$url = "http://127.0.0.1:$port"
$started = @()

function Step($text) { Write-Host "`n=== $text ===" -ForegroundColor Cyan }

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
  } else { Write-Host '  AKU ARPU HILANG!' -ForegroundColor Red }
  $sm = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Finova'
  Get-ChildItem $sm -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  pintasan: $($_.Name)" }

  Step '3. Jalankan biner terpasang (data di AppData, cwd tanpa go.mod)'
  New-Item -ItemType Directory -Force -Path $fakeAppData | Out-Null
  $exe = Join-Path $installDir 'finova.exe'
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $exe
  $psi.Arguments = "-app -no-browser -port $port"
  $psi.WorkingDirectory = $env:TEMP
  $psi.UseShellExecute = $false
  $psi.EnvironmentVariables['APPDATA'] = $fakeAppData
  $proc = [System.Diagnostics.Process]::Start($psi)
  $started += $proc.Id
  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 250
    try { Invoke-RestMethod "$url/api/health" -TimeoutSec 1 | Out-Null; $ready = $true; break } catch {}
  }
  Write-Host "  server siap: $ready"
  $health = Invoke-RestMethod "$url/api/health"
  Write-Host "  /api/health : $($health | ConvertTo-Json -Compress)"
  $spa = Invoke-WebRequest "$url/" -UseBasicParsing
  Write-Host "  GET /       : $($spa.StatusCode), panjang $($spa.Content.Length) byte, ada root React: $($spa.Content -match 'id=\"root\"')"
  $accounts = Invoke-RestMethod "$url/api/accounts"
  Write-Host "  akun        : $($accounts.accounts.Count) baris (1100 = $($accounts.accounts[0].name))"
  $post = @{ voucherNo = 'UJI-INS-001'; entryDate = (Get-Date -Format 'yyyy-MM-15'); description = 'Uji installer'; status = 'POSTED'; lines = @(
      @{ account_id = 1; debit = 250000; credit = 0 }, @{ account_id = 20; debit = 0; credit = 250000 }
    ) } | ConvertTo-Json -Depth 5
  $made = Invoke-RestMethod "$url/api/journals" -Method Post -ContentType 'application/json' -Body $post
  Write-Host "  jurnal baru : id $($made.id) bukti $($made.voucherNo)"
  $tb = Invoke-RestMethod "$url/api/reports/trial-balance"
  Write-Host "  neraca saldo: debit $($tb.data.totals.debit) kredit $($tb.data.totals.credit) seimbang $($tb.data.isBalanced)"

  Step '4. Lokasi data harus di AppData (bukan folder instalasi)'
  Get-ChildItem $fakeAppData -Recurse | ForEach-Object { Write-Host "  $($_.FullName.Substring($fakeAppData.Length))  $($_.Length) byte" }
  $salah = Get-ChildItem $installDir -Filter '*.sqlite*' -ErrorAction SilentlyContinue
  Write-Host "  berkas sqlite di folder instalasi: $($salah.Count)"

  Step '5. Instans kedua tidak boleh menabrak port'
  $second = Start-Process -FilePath $exe -ArgumentList "-app -no-browser -port $port" -PassThru -WindowStyle Hidden
  Start-Sleep -Seconds 2
  Write-Host "  instans kedua keluar sendiri: $($second.HasExited) (kode $($second.ExitCode))"

  Step '6. Lepas senyap'
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
}
