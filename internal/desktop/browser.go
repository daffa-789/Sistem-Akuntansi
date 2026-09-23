// Package desktop berisi perlengkapan kecil agar biner Go dapat dipakai sebagai
// "aplikasi desktop" tanpa Electron: membuka peramban, menghilangkan jendela konsol,
// dan mendeteksi instans yang sudah berjalan.
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
