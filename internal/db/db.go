// Package db menyelubungi SQLite (driver murni Go, tanpa CGO) dengan helper yang
// dipakai handler HTTP: hasil query sebagai peta kolom -> nilai seperti baris database,
// eksekusi transaksi, dan normalisasi nilai yang sama seperti backend Node sebelumnya.
package db

import (
	"context"
	"database/sql"
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	_ "modernc.org/sqlite"
)

// Row satu baris hasil query dengan nama kolom sebagai kunci, persis seperti
// yang dikirim ke frontend (voucher_no, account_id, is_active, dan sejenisnya).
type Row = map[string]any

// Result mengganti properti `insertId` / `affectedRows` milik driver lama.
type Result struct {
	InsertID     int64
	AffectedRows int64
}

// Execer dipakai bersama oleh koneksi biasa dan koneksi transaksi agar fungsi
// domain (writeEntry, audit, reportContext) tidak perlu tahu sedang di dalam tx.
type Execer interface {
	Select(query string, args ...any) ([]Row, error)
	SelectOne(query string, args ...any) (Row, error)
	Exec(query string, args ...any) (Result, error)
}

var (
	_ Execer = (*DB)(nil)
	_ Execer = (*Tx)(nil)
)

// schemaSQLite adalah skema + bagan akun standar Indonesia yang tertanam di biner,
// sehingga hasil `go build` dapat dijalankan di mesin lain tanpa berkas pendamping.
//
//go:embed schema/schema.sqlite.sql
var schemaSQLite string

// DB basis data SQLite yang sudah siap pakai.
type DB struct {
	sqlDB *sql.DB
	file  string
}

// Open menyiapkan folder, pragma WAL + foreign_keys, lalu menerapkan skema.
func Open(file string) (*DB, error) {
	if dir := filepath.Dir(file); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("gagal membuat folder database: %w", err)
		}
	}
	// Satu koneksi saja: aplikasi lokal satu operator, dan SQLite menulis lebih aman
	// tanpa persaingan antar-koneksi (hindari "database is locked").
	sqlDB, err := sql.Open("sqlite", file)
	if err != nil {
		return nil, err
	}
	sqlDB.SetMaxOpenConns(1)
	sqlDB.SetMaxIdleConns(1)
	ctx := context.Background()
	for _, pragma := range []string{
		"PRAGMA journal_mode = WAL",
		"PRAGMA foreign_keys = ON",
		"PRAGMA busy_timeout = 5000",
	} {
		if _, err := sqlDB.ExecContext(ctx, pragma); err != nil {
			_ = sqlDB.Close()
			return nil, fmt.Errorf("gagal menjalankan %s: %w", pragma, err)
		}
	}
	instance := &DB{sqlDB: sqlDB, file: file}
	if err := instance.applySchema(ctx); err != nil {
		_ = sqlDB.Close()
		return nil, err
	}
	return instance, nil
}

// SchemaSQL isi skema yang tertanam di biner, dipakai juga oleh perintah db:init.
func SchemaSQL() string { return schemaSQLite }

// File lokasi berkas SQLite yang sedang dipakai.
func (d *DB) File() string { return d.file }

// Close menutup koneksi sehingga berkas dapat dihapus pada Windows.
func (d *DB) Close() error { return d.sqlDB.Close() }

// applySchema menjalankan setiap pernyataan skema. Skema berisi
// CREATE TABLE IF NOT EXISTS dan INSERT OR IGNORE sehingga aman dipanggil ulang.
func (d *DB) applySchema(ctx context.Context) error {
	for _, statement := range SplitStatements(schemaSQLite) {
		if _, err := d.sqlDB.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("gagal menerapkan skema: %w", err)
		}
	}
	return nil
}

// SplitStatements memisahkan pernyataan per titik koma di luar tanda kutip.
func SplitStatements(script string) []string {
	var (
		statements []string
		current    strings.Builder
		inSingle   bool
		inDouble   bool
		escaped    bool
	)
	for _, r := range script {
		if escaped {
			escaped = false
			current.WriteRune(r)
			continue
		}
		switch r {
		case '\\':
			escaped = true
		case '\'':
			if !inDouble {
				inSingle = !inSingle
			}
		case '"':
			if !inSingle {
				inDouble = !inDouble
			}
		case ';':
			if !inSingle && !inDouble {
				statements = append(statements, current.String())
				current.Reset()
				continue
			}
		}
		current.WriteRune(r)
	}
	statements = append(statements, current.String())
	out := make([]string, 0, len(statements))
	for _, statement := range statements {
		if trimmed := strings.TrimSpace(statement); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

// Select menjalankan query dan mengembalikan semua baris sebagai Row. Slice selalu
// non-nil agar keluaran JSON berupa array kosong, bukan null.
func (d *DB) Select(query string, args ...any) ([]Row, error) {
	return queryRows(context.Background(), d.sqlDB, query, args...)
}

// SelectOne seperti Select tetapi hanya baris pertama; nil bila tidak ada baris.
func (d *DB) SelectOne(query string, args ...any) (Row, error) {
	rows, err := d.Select(query, args...)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

// Exec menjalankan pernyataan perubahan data.
func (d *DB) Exec(query string, args ...any) (Result, error) {
	return execStatement(context.Background(), d.sqlDB, query, args...)
}

// Tx transaksi aktif di atas satu koneksi khusus, sehingga BEGIN IMMEDIATE
// benar-benar mengunci basis data sampai Commit atau Rollback.
type Tx struct {
	conn *sql.Conn
	ctx  context.Context
}

// Begin membuka koneksi khusus lalu menjalankan BEGIN IMMEDIATE.
func (d *DB) Begin() (*Tx, error) {
	ctx := context.Background()
	conn, err := d.sqlDB.Conn(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := conn.ExecContext(ctx, "BEGIN IMMEDIATE"); err != nil {
		_ = conn.Close()
		return nil, err
	}
	return &Tx{conn: conn, ctx: ctx}, nil
}

func (t *Tx) Select(query string, args ...any) ([]Row, error) {
	return queryRows(t.ctx, t.conn, query, args...)
}

func (t *Tx) SelectOne(query string, args ...any) (Row, error) {
	rows, err := t.Select(query, args...)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

func (t *Tx) Exec(query string, args ...any) (Result, error) {
	return execStatement(t.ctx, t.conn, query, args...)
}

// Commit mengakhiri transaksi sukses.
func (t *Tx) Commit() error {
	_, err := t.conn.ExecContext(t.ctx, "COMMIT")
	if closeErr := t.conn.Close(); err == nil {
		err = closeErr
	}
	return err
}

// Rollback membatalkan transaksi; dipanggil otomatis oleh WithTransaction.
func (t *Tx) Rollback() error {
	_, err := t.conn.ExecContext(t.ctx, "ROLLBACK")
	if closeErr := t.conn.Close(); err == nil {
		err = closeErr
	}
	return err
}

// WithTransaction menjalankan fn dalam satu transaksi dan rollback saat error atau
// panic, meniru withTransaction pada backend Node lama.
func (d *DB) WithTransaction(fn func(*Tx) error) error {
	tx, err := d.Begin()
	if err != nil {
		return err
	}
	defer func() {
		if recovered := recover(); recovered != nil {
			_ = tx.Rollback()
			panic(recovered)
		}
	}()
	if err := fn(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

type queryable interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func queryRows(ctx context.Context, target queryable, query string, args ...any) ([]Row, error) {
	rows, err := target.QueryContext(ctx, strings.TrimSpace(query), normalizeArgs(args...)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	result := []Row{}
	for rows.Next() {
		raw := make([]any, len(columns))
		pointers := make([]any, len(columns))
		for i := range raw {
			pointers[i] = &raw[i]
		}
		if err := rows.Scan(pointers...); err != nil {
			return nil, err
		}
		record := make(Row, len(columns))
		for i, column := range columns {
			record[column] = normalizeValue(raw[i])
		}
		result = append(result, record)
	}
	return result, rows.Err()
}

func execStatement(ctx context.Context, target queryable, query string, args ...any) (Result, error) {
	res, err := target.ExecContext(ctx, strings.TrimSpace(query), normalizeArgs(args...)...)
	if err != nil {
		return Result{}, err
	}
	insertID, _ := res.LastInsertId()
	affected, _ := res.RowsAffected()
	return Result{InsertID: insertID, AffectedRows: affected}, nil
}

// normalizeValue mengubah BLOB menjadi string agar tidak ter-encode base64 di JSON.
func normalizeValue(value any) any {
	switch typed := value.(type) {
	case []byte:
		return string(typed)
	case int:
		return int64(typed)
	default:
		return value
	}
}

// normalizeArgs meniru normalisasi parameter backend lama: boolean -> 0/1 dan
// angka bulat dikirim sebagai INTEGER (mis. debit 100000 yang tiba sebagai float64 JSON).
func normalizeArgs(args ...any) []any {
	out := make([]any, 0, len(args))
	for _, arg := range args {
		switch typed := arg.(type) {
		case bool:
			out = append(out, boolToInt(typed))
		case float64:
			if typed == float64(int64(typed)) {
				out = append(out, int64(typed))
			} else {
				out = append(out, typed)
			}
		case int:
			out = append(out, int64(typed))
		case uint:
			out = append(out, int64(typed))
		default:
			out = append(out, typed)
		}
	}
	return out
}

func boolToInt(value bool) int64 {
	if value {
		return 1
	}
	return 0
}

// IsUniqueViolation mendeteksi pelanggaran UNIQUE agar handler dapat membalas 409.
func IsUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	message := err.Error()
	return strings.Contains(message, "UNIQUE constraint failed") ||
		strings.Contains(message, "SQLITE_CONSTRAINT_UNIQUE") ||
		strings.Contains(message, "SQLITE_CONSTRAINT_PRIMARYKEY")
}

// AsInt membaca nilai INTEGER / REAL / TEXT sebagai int64.
func AsInt(value any) int64 {
	switch typed := value.(type) {
	case int64:
		return typed
	case int:
		return int64(typed)
	case float64:
		return int64(typed)
	case json.Number:
		return parseInt64(typed.String())
	case []byte:
		return parseInt64(string(typed))
	case string:
		return parseInt64(typed)
	default:
		return 0
	}
}

// AsFloat membaca nilai numerik apa pun sebagai float64.
func AsFloat(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case int64:
		return float64(typed)
	case int:
		return float64(typed)
	case json.Number:
		return parseFloat(typed.String())
	case []byte:
		return parseFloat(string(typed))
	case string:
		return parseFloat(typed)
	default:
		return 0
	}
}

// AsString membaca nilai teks; nil menjadi string kosong.
func AsString(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case []byte:
		return string(typed)
	case nil:
		return ""
	case json.Number:
		return typed.String()
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case int64:
		return strconv.FormatInt(typed, 10)
	case bool:
		return strconv.FormatBool(typed)
	default:
		return fmt.Sprint(typed)
	}
}

// AsBoolSQLite kolom boolean pada skema ini disimpan sebagai INTEGER 0/1.
func AsBoolSQLite(value any) bool {
	if typed, ok := value.(bool); ok {
		return typed
	}
	return value != nil && AsFloat(value) != 0
}

// StringPtr pointer *string untuk kolom nullable; nil bila NULL.
func StringPtr(value any) *string {
	if value == nil {
		return nil
	}
	text := AsString(value)
	return &text
}

func parseInt64(text string) int64 {
	parsed, err := strconv.ParseInt(strings.TrimSpace(text), 10, 64)
	if err != nil {
		return 0
	}
	return parsed
}

func parseFloat(text string) float64 {
	parsed, err := strconv.ParseFloat(strings.TrimSpace(text), 64)
	if err != nil {
		return 0
	}
	return parsed
}
