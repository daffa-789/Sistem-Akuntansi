//go:build !windows

package desktop

import (
	"context"
	"errors"
	"time"
)

// RunWindow hanya tersedia di Windows karena jendelanya WebView2 (Chromium bawaan
// sistem). Server tetap berjalan di platform lain, jadi jalur `-browser` dan
// pengujian tetap bisa dipakai.
func RunWindow(_ context.Context, _ WindowOptions) error {
	return errors.New("mode jendela hanya tersedia di Windows")
}

// FocusExisting selalu gagal di luar Windows: tidak ada jendela untuk dicari.
func FocusExisting(_ time.Duration) bool { return false }
