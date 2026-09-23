// Package config memuat konfigurasi aplikasi dari berkas .env lalu variabel lingkungan.
// Nilai dari variabel lingkungan selalu menang atas isi .env sehingga
// `PORT=5199 go run ./cmd/finova` dapat dipakai tanpa mengubah berkas.
package config

import (
	"bufio"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// dotenvPath berkas konfigurasi lokal; boleh tidak ada di mesin produksi.
const dotenvPath = ".env"

// Config adalah seluruh nilai yang dibutuhkan server.
type Config struct {
	Port         int
	DatabaseFile string
	ClientOrigin string
	CompanyName  string
	OperatorName string
	StaticDir    string
	CompanyID    int64
	Version      string
	// AppMode menandai "aplikasi desktop": tanpa jendela konsol, log ke berkas,
	// dan peramban dibuka otomatis. Dipakai pintasan hasil installer.
	AppMode bool
}

// fallbackDatabaseName nama berkas SQLite yang dibuat otomatis.
const fallbackDatabaseName = "finova.sqlite"

// Load membaca .env (jika ada) lalu menimpa dengan variabel lingkungan.
func Load() Config {
	env := readDotenv(dotenvPath)
	explicitDB := firstNonEmpty(os.Getenv("DATABASE_FILE"), env["DATABASE_FILE"])
	port, err := strconv.Atoi(firstNonEmpty(os.Getenv("PORT"), env["PORT"], "5000"))
	if err != nil || port <= 0 || port > 65535 {
		port = 5000
	}
	return Config{
		Port:         port,
		DatabaseFile: resolveDatabaseFile(explicitDB),
		ClientOrigin: firstNonEmpty(os.Getenv("CLIENT_ORIGIN"), env["CLIENT_ORIGIN"], "http://localhost:3000"),
		CompanyName:  firstNonEmpty(os.Getenv("COMPANY_NAME"), env["COMPANY_NAME"], "PT Finova Akuntansi Indonesia"),
		OperatorName: firstNonEmpty(os.Getenv("OPERATOR_NAME"), env["OPERATOR_NAME"], "Operator"),
		StaticDir:    firstNonEmpty(os.Getenv("STATIC_DIR"), env["STATIC_DIR"]),
		Version:      "dev",
		CompanyID:    1,
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

// resolveDatabaseFile menentukan tempat berkas data berada.
//
// Urutan: nilai eksplisit (-db / DATABASE_FILE) -> folder ./database bila proyek
// sedang dikembangkan (go.mod ada, atau folder database sudah terlanjur dibuat) ->
// %AppData%\Finova untuk aplikasi terpasang. Folder Program Files tidak dapat
// ditulisi pengguna biasa, jadi aplikasi hasil installer menyimpan datanya di
// profil pengguna agar tetap jalan tanpa hak administrator.
func resolveDatabaseFile(explicit string) string {
	if explicit != "" {
		return explicit
	}
	local := filepath.Join("database", fallbackDatabaseName)
	if _, err := os.Stat("go.mod"); err == nil {
		return local
	}
	if info, err := os.Stat(filepath.Dir(local)); err == nil && info.IsDir() && writableDirFor(filepath.Dir(local)) == nil {
		return local
	}
	if dir, err := os.UserConfigDir(); err == nil && dir != "" {
		appDir := filepath.Join(dir, "Finova")
		if err := os.MkdirAll(appDir, 0o755); err == nil {
			return filepath.Join(appDir, fallbackDatabaseName)
		}
	}
	return local
}

// writableDirFor mengembalikan nil bila folder dapat dibuat dan ditulisi.
func writableDirFor(dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	probe := filepath.Join(dir, ".finova-tulis-tes")
	if err := os.WriteFile(probe, []byte("uji"), 0o644); err != nil {
		return err
	}
	_ = os.Remove(probe)
	return nil
}

// DataDir mengembalikan folder tempat berkas data (dan log) disimpan.
func (c Config) DataDir() string {
	return filepath.Dir(c.DatabaseFile)
}

// LogFile mengembalikan lokasi berkas log saat berjalan tanpa konsol.
func (c Config) LogFile() string {
	return filepath.Join(c.DataDir(), "finova.log")
}

// readDotenv parser minimal: baris KOLOM=nilai, komentar #, dan tanda kutip opsional.
func readDotenv(path string) map[string]string {
	values := map[string]string{}
	file, err := os.Open(path)
	if err != nil {
		return values
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		key, value, found := strings.Cut(line, "=")
		if !found {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if len(value) >= 2 {
			if (strings.HasPrefix(value, `"`) && strings.HasSuffix(value, `"`)) ||
				(strings.HasPrefix(value, `'`) && strings.HasSuffix(value, `'`)) {
				value = value[1 : len(value)-1]
			}
		}
		values[key] = value
	}
	return values
}
