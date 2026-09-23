// Command finova adalah satu-satunya biner aplikasi akuntansi Finova:
// server API Go + penyimpanan aset frontend React yang ditanam di dalamnya.
// Tidak ada Electron, tidak ada Node.js saat berjalan.
//
//	finova                     jalankan server (mode pengembangan, konsol terlihat)
//	finova -app                mode aplikasi desktop: tanpa jendela konsol, log ke
//	                           berkas, dan peramban terbuka otomatis (dipakai pintasan)
//	finova serve|db:init|db:clean|version
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
	port := set.Int("port", cfg.Port, "port HTTP server")
	databaseFile := set.String("db", cfg.DatabaseFile, "lokasi berkas SQLite")
	staticDir := set.String("static", cfg.StaticDir, "folder aset frontend (kosong = pakai yang tertanam di biner)")
	appMode := set.Bool("app", false, "mode aplikasi desktop: sembunyikan konsol, log ke berkas, buka peramban")
	openBrowser := set.Bool("open", false, "buka peramban setelah server siap")
	noBrowser := set.Bool("no-browser", false, "jangan buka peramban (untuk -app)")
	if err := set.Parse(args); err != nil {
		return err
	}
	cfg.Port = *port
	cfg.DatabaseFile = *databaseFile
	cfg.StaticDir = *staticDir
	cfg.AppMode = *appMode

	switch command {
	case "serve", "server":
		wantBrowser := *openBrowser || (cfg.AppMode && !*noBrowser)
		return serve(cfg, wantBrowser)
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

// serve menjalankan bootstrap lalu membuka port. wantBrowser membuka peramban
// setelah server menjawab pemeriksaan kesehatan.
func serve(cfg config.Config, wantBrowser bool) error {
	if cfg.AppMode {
		if err := redirectLogToFile(cfg); err != nil {
			fmt.Fprintf(os.Stderr, "log ke berkas gagal, lanjut ke konsol: %v\n", err)
		}
		if err := desktop.HideConsole(); err != nil {
			log.Printf("gagal menyembunyikan konsol: %v", err)
		}
	}

	// Instans kedua tidak boleh gagal dengan galat port: cukup buka aplikasinya.
	if desktop.ProbeRunning(cfg.Port, 700*time.Millisecond) {
		log.Printf("Finova sudah berjalan di port %d — membuka di peramban.", cfg.Port)
		if wantBrowser {
			return desktop.OpenBrowser(fmt.Sprintf("http://localhost:%d", cfg.Port))
		}
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
	log.Printf("Finova %s — bootstrap siap (database %s).", version, cfg.DatabaseFile)
	if !web.Available(cfg.StaticDir) {
		log.Println("Catatan: frontend belum tertanam. Jalankan `npm run build:client` lalu bangun ulang biner Go.")
	}

	if wantBrowser {
		go func() {
			url := fmt.Sprintf("http://localhost:%d", cfg.Port)
			if err := desktop.WaitReady(cfg.Port, 15*time.Second); err != nil {
				log.Printf("peramban tidak dibuka: %v", err)
				return
			}
			_ = desktop.OpenBrowser(url)
		}()
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return server.Run(ctx)
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
