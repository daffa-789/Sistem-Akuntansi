package desktop

// WindowOptions adalah konfigurasi jendela desktop, sama untuk semua platform.
// Implementasi jendelanya hanya ada di Windows (WebView2); lihat window_windows.go.
type WindowOptions struct {
	Title       string
	URL         string
	UserDataDir string
	// Width/Height dalam piksel logis; 0 berarti ukuran bawaan per platform.
	Width    int
	Height   int
	DevTools bool
	// Ready dipanggil sekali setelah jendela benar-benar terbentuk.
	Ready func(hwnd uintptr)
}
