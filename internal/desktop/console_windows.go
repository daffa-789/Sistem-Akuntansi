//go:build windows

package desktop

import (
	"syscall"
)

var (
	user32            = syscall.NewLazyDLL("user32.dll")
	kernel32          = syscall.NewLazyDLL("kernel32.dll")
	procShowWindow    = user32.NewProc("ShowWindow")
	procGetConsoleWnd = kernel32.NewProc("GetConsoleWindow")
)

const swHide = 0

// HideConsole menyembunyikan jendela konsol sehingga aplikasi tampak sebagai program
// desktop biasa. Log tetap tersimpan pada berkas (lihat Config.LogFile).
func HideConsole() error {
	hwnd, _, _ := procGetConsoleWnd.Call()
	if hwnd == 0 {
		// Sudah tanpa konsol (mis. dibangun dengan -H windowsgui).
		return nil
	}
	// ShowWindow mengembalikan 0 bila jendela memang sudah tersembunyi — bukan
	// kegagalan. Yang layak dilaporkan hanyalah errno aslinya.
	_, _, err := procShowWindow.Call(hwnd, uintptr(swHide))
	if errno, ok := err.(syscall.Errno); ok && errno != 0 {
		return err
	}
	return nil
}

// hideWindowAttr mencegah jendela kecil muncul saat menjalankan peramban.
func hideWindowAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{HideWindow: true}
}
