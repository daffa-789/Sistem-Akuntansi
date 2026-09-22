package db

import (
	"fmt"
	"strings"
)

// cleanTables tabel transaksi/riwayat yang dikosongkan oleh perintah db:clean.
// Bagan akun, periode, perusahaan, dan pengguna sengaja TIDAK dihapus agar
// pengaturan pengguna tetap ada setelah pembersihan.
var cleanTables = []string{
	"journal_lines",
	"journal_entries",
	"audit_logs",
	"import_batches",
	"journal_templates",
}

// TableCount jumlah baris satu tabel beserta nama tabel yang ada di database.
type TableCount struct {
	Table string
	Rows  int64
}

// Counts membaca jumlah baris seluruh tabel basis data (untuk laporan ringkas).
func (d *DB) Counts() ([]TableCount, error) {
	rows, err := d.Select("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
	if err != nil {
		return nil, err
	}
	counts := make([]TableCount, 0, len(rows))
	for _, row := range rows {
		name := AsString(row["name"])
		if name == "" {
			continue
		}
		single, err := d.SelectOne("SELECT COUNT(*) AS rows FROM \"" + strings.ReplaceAll(name, `"`, `""`) + "\"")
		if err != nil {
			return nil, err
		}
		counts = append(counts, TableCount{Table: name, Rows: AsInt(single["rows"])})
	}
	return counts, nil
}

// Clean mengosongkan tabel transaksi, mereset auto-increment, lalu VACUUM.
// Mengembalikan jumlah baris sebelum dan sesudah untuk dicetak pengguna.
func (d *DB) Clean() (before, after []TableCount, err error) {
	if before, err = d.Counts(); err != nil {
		return nil, nil, err
	}
	if _, err = d.Exec("PRAGMA foreign_keys = OFF"); err != nil {
		return nil, nil, err
	}
	err = d.WithTransaction(func(tx *Tx) error {
		for _, table := range cleanTables {
			if _, execErr := tx.Exec("DELETE FROM " + table); execErr != nil {
				return fmt.Errorf("gagal membersihkan %s: %w", table, execErr)
			}
		}
		placeholders := strings.TrimSuffix(strings.Repeat("?,", len(cleanTables)), ",")
		args := make([]any, 0, len(cleanTables))
		for _, table := range cleanTables {
			args = append(args, table)
		}
		if _, execErr := tx.Exec(
			"DELETE FROM sqlite_sequence WHERE name IN ("+placeholders+")", args...); execErr != nil {
			// sqlite_sequence belum ada bila belum ada AUTOINCREMENT yang terpakai.
			if !strings.Contains(execErr.Error(), "no such table") {
				return execErr
			}
		}
		return nil
	})
	if _, pragmaErr := d.Exec("PRAGMA foreign_keys = ON"); err == nil && pragmaErr != nil {
		err = pragmaErr
	}
	if err != nil {
		return before, nil, err
	}
	if _, err = d.Exec("VACUUM"); err != nil {
		return before, nil, err
	}
	if after, err = d.Counts(); err != nil {
		return before, nil, err
	}
	return before, after, nil
}

// FormatCounts merangkai daftar jumlah baris menjadi teks multi-baris.
func FormatCounts(counts []TableCount) string {
	if len(counts) == 0 {
		return "(belum ada tabel)"
	}
	lines := make([]string, 0, len(counts))
	for _, count := range counts {
		lines = append(lines, fmt.Sprintf("- %s: %d baris", count.Table, count.Rows))
	}
	return strings.Join(lines, "\n")
}
