// Package config memuat konfigurasi aplikasi dari berkas .env lalu variabel lingkungan.
// Nilai dari variabel lingkungan selalu menang atas isi .env sehingga
// `PORT=5199 go run ./cmd/finova` dapat dipakai tanpa mengubah berkas.
package config

import (
	"bufio"
	"os"
	"strconv"
	"strings"
)

// Config adalah seluruh nilai yang dibutuhkan server.
type Config struct {
	Port         int
	DatabaseFile string
	ClientOrigin string
	CompanyName  string
	OperatorName string
	StaticDir    string
	CompanyID    int64
}

const dotenvPath = ".env"

// Load membaca .env (jika ada) lalu menimpa dengan variabel lingkungan.
func Load() Config {
	env := readDotenv(dotenvPath)
	get := func(key, fallback string) string {
		if v, ok := os.LookupEnv(key); ok && v != "" {
			return v
		}
		if v, ok := env[key]; ok && v != "" {
			return v
		}
		return fallback
	}
	port, err := strconv.Atoi(get("PORT", "5000"))
	if err != nil || port <= 0 || port > 65535 {
		port = 5000
	}
	return Config{
		Port:         port,
		DatabaseFile: get("DATABASE_FILE", "database/finova.sqlite"),
		ClientOrigin: get("CLIENT_ORIGIN", "http://localhost:3000"),
		CompanyName:  get("COMPANY_NAME", "PT Finova Akuntansi Indonesia"),
		OperatorName: get("OPERATOR_NAME", "Operator"),
		StaticDir:    get("STATIC_DIR", ""),
		CompanyID:    1,
	}
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
