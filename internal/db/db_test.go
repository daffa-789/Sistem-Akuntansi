package db

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"
)

// openScratch memakai folder sementara supaya tes tidak pernah menyentuh database demo.
func openScratch(t *testing.T) *DB {
	t.Helper()
	database, err := Open(filepath.Join(t.TempDir(), "finova-uji.sqlite"))
	if err != nil {
		t.Fatalf("gagal membuka database sementara: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	return database
}

func TestSchemaAppliesAutomatically(t *testing.T) {
	database := openScratch(t)
	accounts, err := database.Select("SELECT * FROM accounts WHERE company_id = 1")
	if err != nil {
		t.Fatalf("gagal membaca bagan akun: %v", err)
	}
	if len(accounts) <= 10 {
		t.Fatalf("skema harus menanam bagan akun lengkap, dapat %d baris", len(accounts))
	}
	found := false
	for _, account := range accounts {
		if AsString(account["code"]) == "1100" {
			found = true
		}
	}
	if !found {
		t.Fatal("akun 1100 (Kas) harus tersedia dari skema")
	}
}

func TestTransactionCommitsAndReadsBack(t *testing.T) {
	database := openScratch(t)
	err := database.WithTransaction(func(tx *Tx) error {
		_, err := tx.Exec(
			"INSERT INTO audit_logs (company_id, entity_type, action, details_json) VALUES (1, 'TEST', 'TEST_ACTION', ?)",
			`{"ok":true}`)
		return err
	})
	if err != nil {
		t.Fatalf("transaksi gagal: %v", err)
	}
	rows, err := database.Select("SELECT * FROM audit_logs WHERE action = 'TEST_ACTION'")
	if err != nil {
		t.Fatalf("gagal membaca balik: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("baris audit harus tersimpan 1, dapat %d", len(rows))
	}
	if !strings.Contains(AsString(rows[0]["details_json"]), "\"ok\":true") {
		t.Fatalf("details_json salah: %v", rows[0]["details_json"])
	}
}

func TestTransactionRollsBackOnError(t *testing.T) {
	database := openScratch(t)
	sentinel := errors.New("Forced error for rollback test")
	err := database.WithTransaction(func(tx *Tx) error {
		if _, insertErr := tx.Exec("INSERT INTO audit_logs (company_id, entity_type, action) VALUES (1, 'FAIL_TEST', 'ROLLBACK_ME')"); insertErr != nil {
			return insertErr
		}
		return sentinel
	})
	if err == nil || !strings.Contains(err.Error(), "rollback test") {
		t.Fatalf("error transaksi harus diteruskan, dapat %v", err)
	}
	rows, err := database.Select("SELECT * FROM audit_logs WHERE action = 'ROLLBACK_ME'")
	if err != nil {
		t.Fatalf("gagal membaca audit log: %v", err)
	}
	if len(rows) != 0 {
		t.Fatalf("transaksi gagal harus di-rollback, masih ada %d baris", len(rows))
	}
}

func TestResultReportsInsertIDAndAffectedRows(t *testing.T) {
	database := openScratch(t)
	created, err := database.Exec("INSERT INTO companies (name, currency) VALUES ('PT Uji','IDR')")
	if err != nil {
		t.Fatalf("gagal menyisip perusahaan: %v", err)
	}
	if created.InsertID <= 1 {
		t.Fatalf("insertId tidak masuk akal: %+v", created)
	}
	updated, err := database.Exec("UPDATE companies SET address = ? WHERE id = ?", "Jalan Uji", created.InsertID)
	if err != nil {
		t.Fatalf("gagal memperbarui: %v", err)
	}
	if updated.AffectedRows != 1 {
		t.Fatalf("affectedRows harus 1, dapat %d", updated.AffectedRows)
	}
	missing, err := database.Exec("UPDATE companies SET address = ? WHERE id = ?", "Tidak ada", 999999)
	if err != nil {
		t.Fatalf("query tanpa cocok harus tetap sukses: %v", err)
	}
	if missing.AffectedRows != 0 {
		t.Fatalf("affectedRows harus 0, dapat %d", missing.AffectedRows)
	}
}

func TestBooleansStoredAsSQLiteIntegers(t *testing.T) {
	database := openScratch(t)
	if _, err := database.Exec(
		`INSERT INTO accounts (company_id, code, name, account_group, normal_balance, is_cash_account, is_active)
		 VALUES (1, '9999', 'Akun Uji', 'ASSET', 'DEBIT', ?, 0)`, true); err != nil {
		t.Fatalf("gagal menyimpan boolean: %v", err)
	}
	row, err := database.SelectOne("SELECT * FROM accounts WHERE code = '9999'")
	if err != nil {
		t.Fatalf("gagal membaca akun uji: %v", err)
	}
	if !AsBoolSQLite(row["is_cash_account"]) {
		t.Fatal("is_cash_account harus terbaca benar")
	}
	if AsBoolSQLite(row["is_active"]) {
		t.Fatal("is_active harus terbaca salah")
	}
}

func TestUniqueViolationIsDetected(t *testing.T) {
	database := openScratch(t)
	_, err := database.Exec(
		`INSERT INTO accounts (company_id, code, name, account_group, normal_balance)
		 VALUES (1, '1100', 'Duplikat', 'ASSET', 'DEBIT')`)
	if err == nil {
		t.Fatal("kode akun duplikat harus ditolak database")
	}
	if !IsUniqueViolation(err) {
		t.Fatalf("kesalahan harus dikenali sebagai duplikat: %v", err)
	}
}

func TestSplitStatementsKeepsSemicolonsInsideStrings(t *testing.T) {
	statements := SplitStatements("INSERT INTO t (a) VALUES ('x;y'); -- komentar\nCREATE TABLE u (a INT);")
	if len(statements) != 2 {
		t.Fatalf("harus 2 pernyataan, dapat %d: %#v", len(statements), statements)
	}
	if statements[0] != "INSERT INTO t (a) VALUES ('x;y')" {
		t.Fatalf("titik koma di dalam string terpotong: %q", statements[0])
	}
}

func TestNormalizeArgs(t *testing.T) {
	args := normalizeArgs([]any{true, false, 1.0, 2.5, 3, nil, "teks"}...)
	if args[0] != int64(1) || args[1] != int64(0) {
		t.Fatalf("boolean harus menjadi 0/1: %#v", args)
	}
	if args[2] != int64(1) {
		t.Fatalf("float bulat harus menjadi int64: %#v", args[2])
	}
	if args[3] != 2.5 {
		t.Fatalf("pecahan harus tetap float: %#v", args[3])
	}
	if args[5] != nil {
		t.Fatalf("nil harus lolos apa adanya: %#v", args[5])
	}
}
