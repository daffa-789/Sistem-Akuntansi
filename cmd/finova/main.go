// Command finova adalah satu-satunya biner aplikasi akuntansi Finova: server API
// Go + penyimpanan aset frontend React yang ditanam di dalamnya. Tidak ada
// Electron, tidak ada Node.js saat berjalan.
//
//	finova                 mode pengembangan: server saja, alamatnya dicetak di konsol
//	finova -app            aplikasi desktop: satu jendela WebView2, tanpa konsol,
//	                       log ke berkas (dipakai pintasan hasil installer)
//	finova -browser        server + buka di peramban (jalur pem-debug-an)
//	finova -no-browser     server saja, tanpa membuka jendela/peramban (alur uji)
//	finova serve|db:init|db:clean|version
//
// Server selalu bind ke 127.0.0.1 dan secara bawaan memintakan port ke sistem,
// sehingga Finova bisa berjalan berdampingan dengan proyek lain di mesin yang
// sama tanpa saling merebut port.
//
// Nomor versi disuntik saat build lewat -ldflags "-X main.version=1.0.0".
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"runtime"
	"strings"
	"syscall"
	"time"

	"finova/internal/config"
	"finova/internal/db"
	"finova/internal/desktop"
	"finova/internal/httpapi"
	"finova/internal/web"
)

// version ditimpa saat build (lihat scripts/build-go.mjs).
var version = "dev"

// windowTitle judul jendela desktop. Nama perusahaan tampil di dalam aplikasi,
// judul jendela cukup singkat agar tidak terpotong di taskbar.
const windowTitle = "Finova — Sistem Akuntansi"

// launch memilih bagaimana aplikasi muncul setelah server siap.
type launch struct {
	window   bool
	browser  bool
	url      string
	devtools bool
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		log.Fatalf("Finova: %v", err)
	}
}

func run(args []string) error {
	command := "serve"
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		command = args[0]
		args = args[1:]
	}

	set := flag.NewFlagSet(command, flag.ContinueOnError)
	cfg := config.Load()
	cfg.Version = version
	port := set.Int("port", cfg.Port, "port HTTP pada 127.0.0.1 (0 = pilih otomatis)")
	databaseFile := set.String("db", cfg.DatabaseFile, "lokasi berkas SQLite")
	staticDir := set.String("static", cfg.StaticDir, "folder aset frontend (kosong = pakai yang tertanam di biner)")
	appMode := set.Bool("app", false, "mode aplikasi desktop: jendela WebView2, tanpa konsol, log ke berkas")
	browser := set.Bool("browser", false, "buka di peramban alih-alih jendela native (jalur debug)")
	noOpen := set.Bool("no-browser", false, "jangan buka jendela maupun peramban (server saja)")
	targetURL := set.String("url", "", "alamat yang dituju jendela/peramban (mis. URL Vite saat pengembangan)")
	devtools := set.Bool("devtools", false, "izinkan perkakas pengembang pada jendela")
	if err := set.Parse(args); err != nil {
		return err
	}
	cfg.Port = *port
	cfg.DatabaseFile = *databaseFile
	cfg.StaticDir = *staticDir
	cfg.AppMode = *appMode

	switch command {
	case "serve", "server":
		return serve(cfg, resolveLaunch(*appMode, *browser, *noOpen, *targetURL, *devtools))
	case "db:init":
		return initDatabase(cfg)
	case "db:clean":
		return cleanDatabase(cfg)
	case "version", "-v", "--version":
		fmt.Printf("finova %s %s/%s (Go %s)\n", version, runtime.GOOS, runtime.GOARCH, runtime.Version())
		return nil
	case "help", "-h", "--help":
		set.Usage()
		return nil
	default:
		return fmt.Errorf("perintah %q tidak dikenal, jalankan `finova help`", command)
	}
}

// resolveLaunch menentukan apa yang muncul setelah server siap. -no-browser
// selalu menang karena alur pengujian bergantung padanya; -browser dipakai
// bersama -app berarti "aplikasinya jalan, tapi tampilkan di peramban".
func resolveLaunch(appMode, browser, noOpen bool, url string, devtools bool) launch {
	mode := launch{url: url, devtools: devtools}
	switch {
	case noOpen:
	case browser:
		mode.browser = true
	case appMode:
		mode.window = true
	}
	return mode
}

// serve membuka port loopback lalu melayani: di dalam jendela native (mode
// desktop), atau tanpa jendela untuk jalur peramban/pengujian.
func serve(cfg config.Config, mode launch) error {
	if cfg.AppMode {
		if err := redirectLogToFile(cfg); err != nil {
			fmt.Fprintf(os.Stderr, "log ke berkas gagal, lanjut ke konsol: %v\n", err)
		}
		if err := desktop.HideConsole(); err != nil {
			log.Printf("gagal menyembunyikan konsol: %v", err)
		}
	}

	// Klik dua kali lagi tidak boleh melahirkan instans kedua: angkat saja
	// jendela yang sudah ada.
	if mode.window && desktop.FocusExisting(300*time.Millisecond) {
		log.Println("Finova sudah terbuka — jendela yang ada diangkat.")
		return nil
	}

	database, err := db.Open(cfg.DatabaseFile)
	if err != nil {
		return err
	}
	defer func() { _ = database.Close() }()

	server := httpapi.New(cfg, database)
	if err := server.Bootstrap(); err != nil {
		return fmt.Errorf("bootstrap database gagal: %w", err)
	}
	listener, err := server.Listen()
	if err != nil {
		return err
	}
	target := mode.url
	if target == "" {
		target = fmt.Sprintf("http://127.0.0.1:%d", httpapi.PortOf(listener))
	}

	log.Printf("Finova %s — bootstrap siap (database %s).", version, cfg.DatabaseFile)
	if !web.Available(cfg.StaticDir) {
		log.Println("Catatan: frontend belum tertanam. Jalankan `npm run build:client` lalu bangun ulang biner Go.")
	}
	fmt.Printf("Finova siap di %s\n", target)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	serverErr := make(chan error, 1)
	go func() { serverErr <- server.Serve(ctx, listener) }()

	if mode.window {
		if err := desktop.RunWindow(ctx, desktop.WindowOptions{
			Title: windowTitle, URL: target, UserDataDir: cfg.WebViewUserData(), DevTools: mode.devtools,
		}); err != nil {
			stop()
			<-serverErr
			return err
		}
		stop()
		return <-serverErr
	}

	if mode.browser {
		if err := desktop.OpenBrowser(target); err != nil {
			log.Printf("peramban tidak dibuka: %v", err)
		}
	}
	select {
	case err := <-serverErr:
		return err
	case <-ctx.Done():
		stop()
		return <-serverErr
	}
}

// redirectLogToFile memindahkan keluaran log ke berkas di folder data, karena mode
// aplikasi desktop tidak menampilkan konsol.
func redirectLogToFile(cfg config.Config) error {
	if err := os.MkdirAll(cfg.DataDir(), 0o755); err != nil {
		return err
	}
	file, err := os.OpenFile(cfg.LogFile(), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	log.SetOutput(file)
	log.SetPrefix("")
	return nil
}

// initDatabase menerapkan skema lalu keluar — pengganti scripts/init-db.ts.
func initDatabase(cfg config.Config) error {
	database, err := db.Open(cfg.DatabaseFile)
	if err != nil {
		return err
	}
	defer func() { _ = database.Close() }()
	server := httpapi.New(cfg, database)
	if err := server.Bootstrap(); err != nil {
		return err
	}
	fmt.Printf("Database lokal Finova (%s) siap digunakan.\n", cfg.DatabaseFile)
	fmt.Println("Tidak memerlukan XAMPP atau phpMyAdmin. Berjalan otomatis.")
	return nil
}

// cleanDatabase mengosongkan tabel transaksi (bagan akun & periode tetap utuh) —
// pengganti scripts/clean-database.ts.
func cleanDatabase(cfg config.Config) error {
	database, err := db.Open(cfg.DatabaseFile)
	if err != nil {
		return err
	}
	defer func() { _ = database.Close() }()

	before, after, err := database.Clean()
	if err != nil {
		return err
	}
	fmt.Println("=== STATUS DATABASE SEBELUM PEMBERSIHAN ===")
	fmt.Println(db.FormatCounts(before))
	fmt.Println("\n=== STATUS DATABASE SETELAH PEMBERSIHAN ===")
	fmt.Println(db.FormatCounts(after))
	fmt.Println("\nData transaksi dibersihkan. Bagan akun, periode, dan pengaturan perusahaan dipertahankan.")
	return nil
}
