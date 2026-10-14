# Skrip pemasangan Finova sebagai Aplikasi Desktop Native Windows
$ErrorActionPreference = 'Stop'

Write-Host "=== Memasang Finova Desktop Native di Laptop ===" -ForegroundColor Cyan

$installDir = "$env:LOCALAPPDATA\Programs\Finova"
$binSource = Join-Path $PSScriptRoot "..\bin\finova.exe"
$iconSource = Join-Path $PSScriptRoot "..\build\windows\icon.ico"

if (-not (Test-Path $binSource)) {
    Write-Error "Biner $binSource tidak ditemukan. Jalankan 'npm run build' lebih dulu."
    exit 1
}

# 1. Hentikan bila ada proses lama yang sedang berjalan
Get-Process -Name "finova" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 500

# 2. Buat folder instalasi
if (-not (Test-Path $installDir)) {
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
}

# 3. Salin executable dan icon
Copy-Item -Path $binSource -Destination "$installDir\finova.exe" -Force
Copy-Item -Path $iconSource -Destination "$installDir\icon.ico" -Force
Write-Host "[OK] Berkas biner dan ikon disalin ke: $installDir" -ForegroundColor Green

# 4. Buat Shortcut di Desktop dan Start Menu
$wsh = New-Object -ComObject WScript.Shell

# Desktop
$desktopPath = [Environment]::GetFolderPath('Desktop')
$desktopLnkPath = "$desktopPath\Finova.lnk"
$desktopLnk = $wsh.CreateShortcut($desktopLnkPath)
$desktopLnk.TargetPath = "$installDir\finova.exe"
$desktopLnk.Arguments = "-app"
$desktopLnk.WorkingDirectory = $installDir
$desktopLnk.IconLocation = "$installDir\icon.ico,0"
$desktopLnk.Description = "Finova — Sistem Akuntansi & Pembukuan Native"
$desktopLnk.Save()
Write-Host "[OK] Pintasan Desktop dibuat: $desktopLnkPath" -ForegroundColor Green

# Start Menu
$startMenuDir = "$([Environment]::GetFolderPath('StartMenu'))\Programs\Finova"
if (-not (Test-Path $startMenuDir)) {
    New-Item -ItemType Directory -Path $startMenuDir -Force | Out-Null
}
$startMenuLnkPath = "$startMenuDir\Finova.lnk"
$startMenuLnk = $wsh.CreateShortcut($startMenuLnkPath)
$startMenuLnk.TargetPath = "$installDir\finova.exe"
$startMenuLnk.Arguments = "-app"
$startMenuLnk.WorkingDirectory = $installDir
$startMenuLnk.IconLocation = "$installDir\icon.ico,0"
$startMenuLnk.Description = "Finova — Sistem Akuntansi & Pembukuan Native"
$startMenuLnk.Save()
Write-Host "[OK] Pintasan Start Menu dibuat: $startMenuLnkPath" -ForegroundColor Green

# 5. Daftarkan di Windows Registry (Apps & Features)
$regPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Finova"
if (-not (Test-Path $regPath)) {
    New-Item -Path $regPath -Force | Out-Null
}
Set-ItemProperty -Path $regPath -Name "DisplayName" -Value "Finova — Sistem Akuntansi"
Set-ItemProperty -Path $regPath -Name "DisplayVersion" -Value "1.0.0"
Set-ItemProperty -Path $regPath -Name "Publisher" -Value "Finova"
Set-ItemProperty -Path $regPath -Name "DisplayIcon" -Value "$installDir\icon.ico"
Set-ItemProperty -Path $regPath -Name "InstallLocation" -Value $installDir

Write-Host "[OK] Finova terdaftar di Windows Apps and Features." -ForegroundColor Green
Write-Host "=== Pemasangan Finova Berhasil! ===" -ForegroundColor Cyan
