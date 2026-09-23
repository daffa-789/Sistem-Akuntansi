// Package desktop membuat biner Go menjadi aplikasi desktop sungguhan: satu
// jendela WebView2 (window_windows.go), membuka peramban untuk jalur debug, dan
// menghilangkan jendela konsol. Tidak ada Electron dan tidak ada Node.js saat
// berjalan.
package desktop

import (
	"fmt"
	"os/exec"
	"runtime"
)

// OpenBrowser menampilkan URL pada peramban bawaan pengguna.
func OpenBrowser(url string) error {
	var name string
	var args []string
	switch runtime.GOOS {
	case "windows":
		// rundll32 memakai asosiasi FileProtocolHandler -> peramban default.
		name, args = "rundll32", []string{"url.dll,FileProtocolHandler", url}
	case "darwin":
		name, args = "open", []string{url}
	default:
		name, args = "xdg-open", []string{url}
	}
	cmd := exec.Command(name, args...)
	if runtime.GOOS == "windows" {
		cmd.SysProcAttr = hideWindowAttr()
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("gagal membuka peramban: %w", err)
	}
	// Proses peramban dilepas; aplikasi tidak menunggu dan tidak ikut mati bersamanya.
	go func() { _ = cmd.Wait() }()
	return nil
}
