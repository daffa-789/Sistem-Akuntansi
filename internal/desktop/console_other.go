//go:build !windows

package desktop

import "syscall"

// HideConsole tidak melakukan apa pun di luar Windows: tidak ada jendela konsol
// yang perlu disembunyikan saat aplikasi dijalankan dari terminal.
func HideConsole() error { return nil }

func hideWindowAttr() *syscall.SysProcAttr { return nil }
