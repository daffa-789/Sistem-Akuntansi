; ---------------------------------------------------------------------------
; Finova - installer Windows (NSIS)
;
; Dipakai oleh `npm run installer` (lihat scripts/make-installer.mjs).
; Pola mengikuti proyek Libray Game: pasang per pengguna (tanpa hak administrator),
; berkas program di %LOCALAPPDATA%\Programs\Finova, data di %APPDATA%\Finova.
;
; Nilai yang disuntik dari baris perintah:
;   /DAppVersion=1.0.0   /DSrcExe=..\..\bin\finova.exe
; ---------------------------------------------------------------------------

Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "x64.nsh"

!ifndef AppVersion
  !define AppVersion "1.0.0"
!endif
!ifndef SrcExe
  !define SrcExe "..\..\bin\finova.exe"
!endif

Name "Finova"
OutFile "..\..\bin\Finova-Setup-${AppVersion}-amd64.exe"
InstallDir "$LOCALAPPDATA\Programs\Finova"
InstallDirRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Finova" "InstallLocation"

; Tanpa hak administrator: aplikasi pengguna biasa yang menulis ke profilnya sendiri.
RequestExecutionLevel user
ShowInstDetails "nevershow"
ShowUninstDetails "nevershow"
SetCompressor /SOLID lzma
SetCompressorDictSize 64

!define MUI_ICON "..\icon.ico"
!define MUI_UNICON "..\icon.ico"
!define MUI_ABORTWARNING
!define MUI_UNABORTWARNING

; ----------------------------- Halaman -------------------------------------
!define MUI_WELCOMEPAGE_TITLE "Selamat datang di Finova ${AppVersion}"
!define MUI_WELCOMEPAGE_TEXT "Sistem akuntansi pembukuan ganda berbahasa Indonesia.$\r$\n$\r$\nAplikasi berjalan sebagai satu berkas di komputer Anda - tanpa server, tanpa basis data eksternal. Data disimpan di folder AppData Anda.$\r$\n$\r$\nJendela peramban akan terbuka otomatis saat aplikasi dijalankan."
!insertmacro MUI_PAGE_WELCOME

!define MUI_PAGE_HEADER_TEXT "Pilih lokasi"
!define MUI_PAGE_HEADER_SUBTEXT "Tempat berkas program disimpan."
!insertmacro MUI_PAGE_DIRECTORY

!define MUI_COMPONENTSPAGE_SMALLDESC
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES

!define MUI_FINISHPAGE_RUN "$INSTDIR\finova.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Jalankan Finova sekarang"
!define MUI_FINISHPAGE_RUN_PARAMETERS "-app"
!define MUI_FINISHPAGE_SHOWREADME "$INSTDIR\catatan.txt"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Buka catatan penggunaan"
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"
LangString DESC_SecMain ${LANG_ENGLISH} "Berkas program Finova (satu executable mandiri)."
LangString DESC_SecDesktop ${LANG_ENGLISH} "Buat pintasan di Desktop."

Var DesktopShortcut

; ----------------------------- Instalasi -----------------------------------
Section "Finova" SecMain
  SectionIn RO

  ; Hentikan instans yang sedang berjalan supaya berkas dapat ditimpa.
  nsExec::Exec 'taskkill /F /IM finova.exe'
  Pop $0

  SetOutPath "$INSTDIR"
  File "${SrcExe}"
  File /oname=catatan.txt "catatan.txt"
  WriteUninstaller "$INSTDIR\uninstall.exe"

  CreateDirectory "$SMPROGRAMS\Finova"
  CreateShortcut "$SMPROGRAMS\Finova\Finova.lnk" "$INSTDIR\finova.exe" "-app" "$INSTDIR\finova.exe" 0
  CreateShortcut "$SMPROGRAMS\Finova\Finova (dengan konsol).lnk" "$INSTDIR\finova.exe" "-no-browser" "$INSTDIR\finova.exe" 0
  CreateShortcut "$SMPROGRAMS\Finova\Hentikan Finova.lnk" "$SYSDIR\taskkill.exe" "/F /IM finova.exe" "$SYSDIR\taskkill.exe" 0
  CreateShortcut "$SMPROGRAMS\Finova\Lepas Finova.lnk" "$INSTDIR\uninstall.exe"

  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0

  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Finova" "DisplayName" "Finova"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Finova" "DisplayVersion" "${AppVersion}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Finova" "Publisher" "Finova"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Finova" "URLInfoAbout" "https://github.com/daffa-789/Sistem-Akuntansi"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Finova" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Finova" "InstallSource" "$EXEDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Finova" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Finova" "QuietUninstallString" '"$INSTDIR\uninstall.exe" /S'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Finova" "DisplayIcon" "$INSTDIR\finova.exe,0"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Finova" "EstimatedSize" $0
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Finova" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Finova" "NoRepair" 1
SectionEnd

Section "Pintasan di Desktop" SecDesktop
  StrCpy $DesktopShortcut "1"
  CreateShortcut "$DESKTOP\Finova.lnk" "$INSTDIR\finova.exe" "-app" "$INSTDIR\finova.exe" 0
SectionEnd

; ----------------------------- Uninstall -----------------------------------
Section "Uninstall"
  nsExec::Exec 'taskkill /F /IM finova.exe'
  Pop $0

  Delete "$INSTDIR\finova.exe"
  Delete "$INSTDIR\catatan.txt"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"

  Delete "$SMPROGRAMS\Finova\Finova.lnk"
  Delete "$SMPROGRAMS\Finova\Finova (dengan konsol).lnk"
  Delete "$SMPROGRAMS\Finova\Hentikan Finova.lnk"
  Delete "$SMPROGRAMS\Finova\Lepas Finova.lnk"
  RMDir "$SMPROGRAMS\Finova"
  Delete "$DESKTOP\Finova.lnk"

  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Finova"

  ; Tanya dulu sebelum menghapus data; saat dipasang/dilepas senyap, data selalu disimpan.
  ${IfNot} ${Silent}
    MessageBox MB_YESNO|MB_ICONQUESTION "Hapus juga data pembukuan di$\r$\n$APPDATA\Finova?$\r$\n$\r$\nPilih Tidak bila Anda ingin menyimpan jurnal dan bagan akun." IDYES deleteData
  ${EndIf}
  Goto keepData
  deleteData:
    RMDir /r "$APPDATA\Finova"
  keepData:
    DetailPrint "Selesai."
SectionEnd

; Deskripsi bagian (halaman komponen) harus setelah Section didefinisikan,
; supaya nama konstanta SecMain/SecDesktop sudah dikenal.
!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecMain} $(DESC_SecMain)
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} $(DESC_SecDesktop)
!insertmacro MUI_FUNCTION_DESCRIPTION_END
