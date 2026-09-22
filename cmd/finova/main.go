// Command finova adalah satu-satunya biner aplikasi akuntansi Finova:
// server API Go + penyimpanan aset frontend React yang ditanam di dalamnya.
// Tidak ada Electron, tidak ada Node.js saat berjalan.
//
//	finova            jalankan server (default)
//	finova serve      sama seperti di atas
//	finova db:init    buat/terapkan skema database lalu keluar
//	finova db:clean   hapus berkas database dan WAL-nya lalu keluar
//	finova version    cetak versi runtime Go
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

	"finova/internal/config"
	"finova/internal/db"
	"finova/internal/httpapi"
	"finova/internal/web"
)

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
	port := set.Int("port", cfg.Port, "port HTTP server")
	databaseFile := set.String("db", cfg.DatabaseFile, "lokasi berkas SQLite")
	staticDir := set.String("static", cfg.StaticDir, "folder aset frontend (kosong = pakai yang tertanam di biner)")
	if err := set.Parse(args); err != nil {
		return err
	}
	cfg.Port = *port
	cfg.DatabaseFile = *databaseFile
	cfg.StaticDir = *staticDir

	switch command {
	case "serve", "server":
		return serve(cfg)
	case "db:init":
		return initDatabase(cfg)
	case "db:clean":
		return cleanDatabase(cfg)
	case "version", "-v", "--version":
		fmt.Printf("finova %s/%s (Go %s)\n", runtime.GOOS, runtime.GOARCH, runtime.Version())
		return nil
	case "help", "-h", "--help":
		set.Usage()
		return nil
	default:
		return fmt.Errorf("perintah %q tidak dikenal, jalankan `finova help`", command)
	}
}

// serve menjalankan bootstrap lalu membuka port.
func serve(cfg config.Config) error {
	database, err := db.Open(cfg.DatabaseFile)
	if err != nil {
		return err
	}
	defer func() { _ = database.Close() }()

	server := httpapi.New(cfg, database)
	if err := server.Bootstrap(); err != nil {
		return fmt.Errorf("bootstrap database gagal: %w", err)
	}
	log.Printf("Bootstrap Finova siap (database %s).", cfg.DatabaseFile)
	if !web.Available(cfg.StaticDir) {
		log.Println("Catatan: frontend belum tertanam. Jalankan `npm run build:client` lalu `go build ./cmd/finova`.")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return server.Run(ctx)
}

// initDatabase menerapkan skema dan keluar — pengganti `npm run db:init`.
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
