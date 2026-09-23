package desktop

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// ProbeRunning memeriksa apakah sudah ada instans Finova yang melayani port ini.
// Fungsi ini membuat perilaku "klik dua kali lagi = buka aplikasinya" mungkin,
// alih-alih menampilkan galat port bentrok kepada pengguna.
func ProbeRunning(port int, timeout time.Duration) bool {
	client := &http.Client{Timeout: timeout}
	response, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/api/health", port))
	if err != nil {
		return false
	}
	defer func() { _ = response.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(response.Body, 4096))
	if err != nil {
		return false
	}
	return response.StatusCode == http.StatusOK && strings.Contains(string(body), "finova-api")
}

// WaitReady menunggu server menjawab kesehatan, dengan batas waktu.
func WaitReady(port int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if ProbeRunning(port, 400*time.Millisecond) {
			return nil
		}
		time.Sleep(120 * time.Millisecond)
	}
	return fmt.Errorf("server tidak siap dalam %s", timeout)
}
