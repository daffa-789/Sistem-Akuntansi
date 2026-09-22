// Package web menyajikan frontend React hasil build. Berkas dist ditanam ke dalam
// biner Go (go:embed) sehingga satu berkas finova.exe cukup untuk menjalankan
// website — tanpa Node.js, tanpa Electron.
package web

import (
	"bytes"
	"embed"
	"io/fs"
	"net/http"
	"os"
	"path"
	"strings"
)

// distBuild hasil `npm run build:client` (Vite menulis ke internal/web/dist).
// Berkas .gitkeep ikut ter-embed agar `go build` tetap berhasil sebelum frontend dibangun;
// handler akan memberi tahu pengguna bahwa aset belum tersedia.
//
//go:embed all:dist
var dist embed.FS

// Handler mengembalikan penyimpan berkas SPA. Bila dir tidak kosong, berkas dibaca dari
// disk (berguna saat pengembangan); jika tidak, dari biner.
func Handler(dir string) http.Handler {
	root := openRoot(dir)
	return &spaHandler{
		root:   root,
		source: sourceLabel(dir),
	}
}

// Available mendeteksi apakah hasil build benar-benar ada di dalamnya.
func Available(dir string) bool {
	root := openRoot(dir)
	file, err := root.Open("index.html")
	if err != nil {
		return false
	}
	_ = file.Close()
	return true
}

func sourceLabel(dir string) string {
	if dir != "" {
		return "folder " + dir
	}
	return "biner (go:embed)"
}

func openRoot(dir string) fs.FS {
	if dir != "" {
		return os.DirFS(dir)
	}
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		return brokenFS{err: err}
	}
	return sub
}

// brokenFS dipakai bila isi embed tidak dapat dibaca; kesalahan muncul saat ada permintaan.
type brokenFS struct{ err error }

func (b brokenFS) Open(string) (fs.File, error) { return nil, b.err }

type spaHandler struct {
	root   fs.FS
	source string
}

// ServeHTTP melayani berkas statis dan mengembalikan index.html untuk rute SPA
// (mis. /jurnal) supaya refresh pada halaman dalam tidak menghasilkan 404.
func (h *spaHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Method tidak diizinkan.", http.StatusMethodNotAllowed)
		return
	}
	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if name == "" || name == "/" {
		name = "index.html"
	}
	if data, err := fs.ReadFile(h.root, name); err == nil && !strings.HasSuffix(name, "/") {
		if name == "index.html" {
			// Jangan simpan index.html: pengguna harus langsung mendapat build terbaru.
			w.Header().Set("Cache-Control", "no-cache")
		} else {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		w.Header().Set("Content-Type", contentType(name, data))
		w.WriteHeader(http.StatusOK)
		if r.Method == http.MethodHead {
			return
		}
		_, _ = w.Write(data)
		return
	}
	index, err := fs.ReadFile(h.root, "index.html")
	if err != nil {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte("Frontend belum tersedia. Jalankan `npm run build:client` lalu bangun ulang biner Go. Sumber: " + h.source))
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodHead {
		return
	}
	_, _ = w.Write(index)
}

// contentType menentukan MIME untuk aset statis dari ekstensi dan isi berkas.
func contentType(name string, data []byte) string {
	switch strings.ToLower(path.Ext(name)) {
	case ".html":
		return "text/html; charset=utf-8"
	case ".js", ".mjs":
		return "text/javascript; charset=utf-8"
	case ".css":
		return "text/css; charset=utf-8"
	case ".json":
		return "application/json; charset=utf-8"
	case ".svg":
		return "image/svg+xml"
	case ".woff":
		return "font/woff"
	case ".woff2":
		return "font/woff2"
	case ".ttf":
		return "font/ttf"
	case ".ico":
		return "image/x-icon"
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	case ".map":
		return "application/json; charset=utf-8"
	case ".txt":
		return "text/plain; charset=utf-8"
	case ".wasm":
		return "application/wasm"
	}
	if bytes.HasPrefix(data, []byte("<!doctype")) || bytes.HasPrefix(data, []byte("<!DOCTYPE")) {
		return "text/html; charset=utf-8"
	}
	return "application/octet-stream"
}
