//go:build windows

package desktop

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"runtime"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"github.com/wailsapp/go-webview2/pkg/edge"
	"golang.org/x/sys/windows"
)

/*
Jendela desktop Finova: satu jendela Win32 biasa yang isinya WebView2 (Chromium
milik sistem), bukan tab peramban. Dua pelajaran dari spike 2026-09-23 dicatat
di sini karena keduanya tidak intuitif dan mahal untuk ditebak ulang:

  - hCursor pada WNDCLASSEXW harus HANDLE hasil LoadCursorW. Mengisi angka
    MAKEINTRESOURCE(IDC_ARROW) ditolak RegisterClassExW dengan
    ERROR_INVALID_PARAMETER yang tidak menjelaskan apa pun.
  - Bila x/y pada CreateWindowExW memakai CW_USEDEFAULT, lebar & tinggi DIABAIKAN
    dan Windows memilih ukuran sendiri. Ukuran jendela harus dihitung eksplisit.
*/

// windowClassName dipakai juga oleh FocusExisting untuk menemukan jendela yang
// sudah terbuka dari proses lain.
const windowClassName = "FinovaDesktopWindow"

const (
	wmSize         = 0x0005
	wmGetMinMaxInfo = 0x0024
	wmClose        = 0x0010
	wmDestroy      = 0x0002
	wmDpiChanged   = 0x02E0
	sizeMinimized  = 1

	swShow       = 5
	swRestore    = 9
	csHRedraw    = 0x0002
	csVRedraw    = 0x0001
	wsOverlapped = 0x00CF0000

	swpNoSize     = 0x0001
	swpNoMove     = 0x0002
	swpNoZOrder   = 0x0004
	swpNoActivate = 0x0010
	spiGetWorkArc = 0x0030
	idcArrow      = 32512
)

var (
	// user32, kernel32, dan procShowWindow sudah dideklarasikan di
	// console_windows.go (satu paket, satu build tag).
	shell32 = windows.NewLazySystemDLL("shell32.dll")
	ole32   = windows.NewLazySystemDLL("ole32.dll")

	procRegister     = user32.NewProc("RegisterClassExW")
	procCreateWindow = user32.NewProc("CreateWindowExW")
	procUpdateWindow = user32.NewProc("UpdateWindow")
	procGetMessage   = user32.NewProc("GetMessageW")
	procTranslate    = user32.NewProc("TranslateMessage")
	procDispatch     = user32.NewProc("DispatchMessageW")
	procDefWindow    = user32.NewProc("DefWindowProcW")
	procDestroy      = user32.NewProc("DestroyWindow")
	procPostQuit     = user32.NewProc("PostQuitMessage")
	procPostMessage  = user32.NewProc("PostMessageW")
	procLoadCursor   = user32.NewProc("LoadCursorW")
	procSetWindowPos = user32.NewProc("SetWindowPos")
	procSysParams    = user32.NewProc("SystemParametersInfoW")
	procDpiForSystem = user32.NewProc("GetDpiForSystem")
	procDpiAware     = user32.NewProc("SetProcessDpiAwarenessContext")
	procFindWindow   = user32.NewProc("FindWindowW")
	procForeground   = user32.NewProc("SetForegroundWindow")
	procModule       = kernel32.NewProc("GetModuleHandleW")
	procExtractIcon  = shell32.NewProc("ExtractIconExW")
	procAppUserModel = shell32.NewProc("SetCurrentProcessExplicitAppUserModelID")
	procCoInitialize = ole32.NewProc("CoInitializeEx")
)

type winPoint struct{ x, y int32 }

type winRect struct {
	left, top, right, bottom int32
}

type winMinMaxInfo struct {
	reserved   winPoint
	maxSize    winPoint
	maxPos     winPoint
	minTrack   winPoint
	maxTrack   winPoint
}

type winClassEx struct {
	cbSize        uint32
	style         uint32
	lpfnWndProc   uintptr
	cbClsExtra    int32
	cbWndExtra    int32
	hInstance     windows.Handle
	hIcon         windows.Handle
	hCursor       windows.Handle
	hbrBackground windows.Handle
	lpszMenuName  *uint16
	lpszClassName *uint16
	hIconSm       windows.Handle
}

type winMsg struct {
	hwnd    uintptr
	message uint32
	wParam  uintptr
	lParam  uintptr
	time    uint32
	x       int32
	y       int32
}

// activeWindow menyimpan pasangan handle+webview untuk message loop yang sedang
// berjalan; WndProc adalah fungsi bebas sehingga tidak bisa membawa konteks sendiri.
type activeWindow struct {
	mu       sync.Mutex
	hwnd     uintptr
	chromium *edge.Chromium
}

func (w *activeWindow) set(hwnd uintptr, chromium *edge.Chromium) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.hwnd, w.chromium = hwnd, chromium
}

func (w *activeWindow) clear() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.hwnd, w.chromium = 0, nil
}

func (w *activeWindow) view() *edge.Chromium {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.chromium
}

var current activeWindow

// asPtr membaca ulang alamat yang datang lewat Win32 (lParam/wParam bertipe
// uintptr). Konversi langsung (*T)(unsafe.Pointer(v)) ditolak `go vet` karena
// uintptr tidak dijamin menyimpan alamat; menyalinnya ke variabel lalu
// menafsirkan alamat variabel itu sendiri adalah cara yang sah.
func asPtr[T any](v uintptr) *T {
	return *(**T)(unsafe.Pointer(&v))
}

func wndProc(hwnd, message, wParam, lParam uintptr) uintptr {
	switch message {
	case wmSize:
		if chromium := current.view(); chromium != nil && wParam != sizeMinimized {
			chromium.Resize()
		}
	case wmGetMinMaxInfo:
		// Buku besar akuntansi penuh tabel; jangan biarkan jendela dikecilkan
		// sampai isi tidak terbaca.
		info := asPtr[winMinMaxInfo](lParam)
		info.minTrack.x = 880
		info.minTrack.y = 560
	case wmDpiChanged:
		// Windows mengirim rect saran pada lParam — tinggal dipakai apa adanya.
		suggested := asPtr[winRect](lParam)
		procSetWindowPos.Call(
			hwnd, 0,
			uintptr(suggested.left), uintptr(suggested.top),
			uintptr(suggested.right-suggested.left), uintptr(suggested.bottom-suggested.top),
			swpNoZOrder|swpNoActivate,
		)
		return 0
	case wmClose:
		procDestroy.Call(hwnd)
		return 0
	case wmDestroy:
		if chromium := current.view(); chromium != nil {
			chromium.ShuttingDown()
		}
		procPostQuit.Call(0)
		return 0
	}
	ret, _, _ := procDefWindow.Call(hwnd, message, wParam, lParam)
	return ret
}

// RunWindow membuka jendela WebView2 dan menahan diri sampai jendela ditutup.
// ctx yang dibatalkan dari sisi mana pun menutup jendela dengan rapi, sehingga
// proses benar-benar keluar dan port loopback-nya lepas.
func RunWindow(ctx context.Context, opts WindowOptions) error {
	runtime.LockOSThread()
	if opts.Title == "" {
		opts.Title = "Finova"
	}
	procDpiAware.Call(^uintptr(3)) // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
	setAppUserModelID("Finova.Akuntansi")
	procCoInitialize.Call(0, 2) // COINIT_APARTMENTTHREADED

	instance, _, _ := procModule.Call(0)
	classPtr, err := syscall.UTF16PtrFromString(windowClassName)
	if err != nil {
		return err
	}
	arrow, _, _ := procLoadCursor.Call(0, uintptr(idcArrow))
	iconLarge, iconSmall := appIcons()

	class := winClassEx{
		cbSize:        uint32(unsafe.Sizeof(winClassEx{})),
		style:         csHRedraw | csVRedraw,
		lpfnWndProc:   syscall.NewCallback(wndProc),
		hInstance:     windows.Handle(instance),
		hIcon:         windows.Handle(iconLarge),
		hIconSm:       windows.Handle(iconSmall),
		hCursor:       windows.Handle(arrow),
		hbrBackground: windows.Handle(1), // COLOR_WINDOW+1
		lpszClassName: classPtr,
	}
	// Nilai kembali yang menentukan sukses/gagal: LazyProc.Call selalu
	// mengembalikan Errno, termasuk Errno(0) "berhasil" sebagai interface bukan-nil.
	if atom, _, callErr := procRegister.Call(uintptr(unsafe.Pointer(&class))); atom == 0 {
		return fmt.Errorf("gagal mendaftar kelas jendela: %w", callErr)
	}

	left, top, width, height := centeredBounds(opts.Width, opts.Height)
	titlePtr, err := syscall.UTF16PtrFromString(opts.Title)
	if err != nil {
		return err
	}
	hwnd, _, callErr := procCreateWindow.Call(
		0, uintptr(unsafe.Pointer(classPtr)), uintptr(unsafe.Pointer(titlePtr)),
		wsOverlapped,
		uintptr(left), uintptr(top), uintptr(width), uintptr(height),
		0, 0, instance, 0,
	)
	if hwnd == 0 {
		return fmt.Errorf("gagal membuat jendela: %w", callErr)
	}

	chromium := edge.NewChromium()
	chromium.DataPath = opts.UserDataDir
	chromium.Debug = opts.DevTools
	chromium.SetErrorCallback(func(err error) { log.Printf("[webview2] %v", err) })
	current.set(hwnd, chromium)
	defer current.clear()

	procShowWindow.Call(hwnd, swShow)
	procUpdateWindow.Call(hwnd)

	// ctx -> WM_CLOSE: satu-satunya jalan keluar yang wajar untuk aplikasi desktop.
	go func() {
		<-ctx.Done()
		procPostMessage.Call(hwnd, wmClose, 0, 0)
	}()

	if !chromium.Embed(hwnd) {
		return errors.New("WebView2 gagal memulai — periksa runtime Microsoft Edge WebView2")
	}
	// Field Debug pada go-webview2 v1.0.23 tidak dibaca sama sekali; perkakas
	// pengembang harus dinyalakan lewat settings setelah controller siap.
	if settings, settingsErr := chromium.GetSettings(); settingsErr == nil && opts.DevTools {
		if err := settings.PutAreDevToolsEnabled(true); err != nil {
			log.Printf("[webview2] devtools gagal diaktifkan: %v", err)
		}
	}
	chromium.Resize()
	chromium.Navigate(opts.URL)
	if err := chromium.Show(); err != nil {
		log.Printf("[webview2] jendela gagal ditampilkan: %v", err)
	}
	if opts.Ready != nil {
		opts.Ready(hwnd)
	}

	var message winMsg
	for {
		if result, _, _ := procGetMessage.Call(uintptr(unsafe.Pointer(&message)), 0, 0, 0); result == 0 {
			break
		}
		procTranslate.Call(uintptr(unsafe.Pointer(&message)))
		procDispatch.Call(uintptr(unsafe.Pointer(&message)))
	}
	chromium.ShuttingDown()
	return nil
}

// FocusExisting mengangkat jendela Finova yang sudah terbuka — perilaku "klik
// dua kali lagi = aplikasi muncul", bukan pesan galat port.
func FocusExisting(timeout time.Duration) bool {
	classPtr, err := syscall.UTF16PtrFromString(windowClassName)
	if err != nil {
		return false
	}
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if hwnd, _, _ := procFindWindow.Call(uintptr(unsafe.Pointer(classPtr)), 0); hwnd != 0 {
			procShowWindow.Call(hwnd, swRestore)
			procForeground.Call(hwnd)
			return true
		}
		time.Sleep(80 * time.Millisecond)
	}
	return false
}

// setAppUserModelID membuat taskbar memperlakukan Finova sebagai aplikasi sendiri,
// bukan menumpang pada identitas browser.
func setAppUserModelID(id string) {
	ptr, err := syscall.UTF16PtrFromString(id)
	if err != nil {
		return
	}
	procAppUserModel.Call(uintptr(unsafe.Pointer(ptr)))
}

// appIcons mengambil ikon yang sudah tertanam dalam biner
// (cmd/finova/resource_windows_amd64.syso) untuk title bar dan taskbar.
func appIcons() (large, small uintptr) {
	exePath, err := os.Executable()
	if err != nil {
		return 0, 0
	}
	pathPtr, err := syscall.UTF16PtrFromString(exePath)
	if err != nil {
		return 0, 0
	}
	var icons [2]windows.Handle
	procExtractIcon.Call(
		uintptr(unsafe.Pointer(pathPtr)), 0,
		uintptr(unsafe.Pointer(&icons[0])), uintptr(unsafe.Pointer(&icons[1])), 1,
	)
	return uintptr(icons[0]), uintptr(icons[1])
}

// centeredBounds menghitung ukuran & posisi jendela dalam piksel fisik,
// mengikuti work area dan DPI layar aktif.
func centeredBounds(logicalWidth, logicalHeight int) (left, top, width, height int32) {
	if logicalWidth <= 0 {
		logicalWidth = 1240
	}
	if logicalHeight <= 0 {
		logicalHeight = 820
	}
	var work winRect
	procSysParams.Call(spiGetWorkArc, 0, uintptr(unsafe.Pointer(&work)), 0)
	if work.right <= work.left {
		work = winRect{right: 1920, bottom: 1040}
	}
	dpi, _, _ := procDpiForSystem.Call()
	if dpi < 96 {
		dpi = 96
	}
	scale := float64(dpi) / 96
	width = int32(float64(logicalWidth) * scale)
	height = int32(float64(logicalHeight) * scale)
	if max := work.right - work.left - 40; width > max {
		width = max
	}
	if max := work.bottom - work.top - 40; height > max {
		height = max
	}
	left = work.left + (work.right-work.left-width)/2
	top = work.top + (work.bottom-work.top-height)/2
	return left, top, width, height
}
