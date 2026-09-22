// Package xlsx menggantikan ExcelJS pada backend: membuat templat impor dan membaca
// berkas Excel yang diunggah pengguna menjadi baris teks mentah.
package xlsx

import (
	"bytes"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/xuri/excelize/v2"
)

// TemplateHeaders kolom yang dikenali parser impor.
var TemplateHeaders = []string{"Tanggal", "NoBukti", "Keterangan", "KodeAkun", "Debit", "Kredit"}

// SampleRows contoh transaksi yang ikut ditulis ke dalam templat.
var SampleRows = [][]any{
	{"2026-01-01", "JRN-001", "Setoran modal awal", "1100", 10000000, 0},
	{"2026-01-01", "JRN-001", "Setoran modal awal", "3100", 0, 10000000},
}

// JournalTemplate menyusun berkas .xlsx templat jurnal (sheet "Jurnal", judul tebal).
func JournalTemplate() ([]byte, error) {
	file := excelize.NewFile()
	defer func() { _ = file.Close() }()

	const sheet = "Jurnal"
	index, err := file.NewSheet(sheet)
	if err != nil {
		return nil, fmt.Errorf("gagal membuat sheet Jurnal: %w", err)
	}
	if defaultIndex, lookupErr := file.GetSheetIndex("Sheet1"); lookupErr == nil && defaultIndex >= 0 && defaultIndex != index {
		if err := file.DeleteSheet("Sheet1"); err != nil {
			return nil, fmt.Errorf("gagal menghapus sheet bawaan: %w", err)
		}
	}
	file.SetActiveSheet(index)

	header := make([]any, 0, len(TemplateHeaders))
	for _, title := range TemplateHeaders {
		header = append(header, title)
	}
	if err := file.SetSheetRow(sheet, "A1", &header); err != nil {
		return nil, err
	}
	for offset, row := range SampleRows {
		cell, err := excelize.CoordinatesToCellName(1, offset+2)
		if err != nil {
			return nil, err
		}
		values := row
		if err := file.SetSheetRow(sheet, cell, &values); err != nil {
			return nil, err
		}
	}
	for column, letter := range []string{"A", "B", "C", "D", "E", "F"} {
		if err := file.SetColWidth(sheet, letter, letter, 16+float64(column%2)*2); err != nil {
			return nil, err
		}
	}
	bold, err := file.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true}})
	if err != nil {
		return nil, err
	}
	if err := file.SetRowStyle(sheet, 1, 1, bold); err != nil {
		return nil, err
	}

	buffer, err := file.WriteToBuffer()
	if err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

// WorkbookFromRows menyusun berkas .xlsx sederhana dari judul kolom dan baris teks.
// Dipakai tes untuk membuat berkas impor tanpa bergantung pada templat produksi.
func WorkbookFromRows(headers []string, rows [][]string) ([]byte, error) {
	file := excelize.NewFile()
	defer func() { _ = file.Close() }()

	const sheet = "Jurnal"
	index, err := file.NewSheet(sheet)
	if err != nil {
		return nil, err
	}
	if defaultIndex, lookupErr := file.GetSheetIndex("Sheet1"); lookupErr == nil && defaultIndex >= 0 && defaultIndex != index {
		if err := file.DeleteSheet("Sheet1"); err != nil {
			return nil, err
		}
	}
	file.SetActiveSheet(index)

	for column, title := range headers {
		cell, err := excelize.CoordinatesToCellName(column+1, 1)
		if err != nil {
			return nil, err
		}
		if err := file.SetCellStr(sheet, cell, title); err != nil {
			return nil, err
		}
	}
	for rowIndex, row := range rows {
		for column, value := range row {
			cell, err := excelize.CoordinatesToCellName(column+1, rowIndex+2)
			if err != nil {
				return nil, err
			}
			if value == "" {
				continue
			}
			if err := file.SetCellStr(sheet, cell, value); err != nil {
				return nil, err
			}
		}
	}

	buffer, err := file.WriteToBuffer()
	if err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

// SheetRow satu baris data hasil baca, dengan kunci nama kolom pada baris pertama.
type SheetRow struct {
	Cells map[string]string
	Order []string
}

// Get mengembalikan nilai kolom pertama yang cocok dengan salah satu nama diberikan.
func (r SheetRow) Get(names ...string) string {
	for _, name := range names {
		if value, ok := r.Cells[name]; ok {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

// IsEmpty baris dianggap kosong bila seluruh selnya kosong setelah dipangkas.
func (r SheetRow) IsEmpty() bool {
	for _, value := range r.Cells {
		if strings.TrimSpace(value) != "" {
			return false
		}
	}
	return true
}

// ReadJournalSheet membaca sheet pertama sebagai baris ber-nama kolom.
// RawCellValue dipakai agar angka tidak membawa format ribuan/tanggal Excel,
// sehingga nilainya identik dengan nilai mentah yang dikembalikan ExcelJS.
func ReadJournalSheet(data []byte) ([]SheetRow, error) {
	if len(data) == 0 {
		return nil, errors.New("Berkas Excel kosong.")
	}
	file, err := excelize.OpenReader(bytes.NewReader(data), excelize.Options{RawCellValue: true})
	if err != nil {
		return nil, fmt.Errorf("berkas Excel tidak dapat dibaca: %w", err)
	}
	defer func() { _ = file.Close() }()

	sheets := file.GetSheetList()
	if len(sheets) == 0 {
		return nil, errors.New("Workbook tidak memiliki sheet.")
	}
	raw, err := file.GetRows(sheets[0], excelize.Options{RawCellValue: true})
	if err != nil {
		return nil, fmt.Errorf("sheet tidak dapat dibaca: %w", err)
	}
	if len(raw) == 0 {
		return nil, errors.New("Sheet Excel tidak memiliki transaksi.")
	}

	headers := map[int]string{}
	for column, title := range raw[0] {
		trimmed := strings.TrimSpace(title)
		if trimmed != "" {
			headers[column] = trimmed
		}
	}
	if len(headers) == 0 {
		return nil, errors.New("Baris pertama harus berisi judul kolom.")
	}

	rows := make([]SheetRow, 0, len(raw)-1)
	for _, values := range raw[1:] {
		record := SheetRow{Cells: map[string]string{}}
		for column, header := range headers {
			value := ""
			if column < len(values) {
				value = values[column]
			}
			if _, exists := record.Cells[header]; !exists {
				record.Cells[header] = value
				record.Order = append(record.Order, header)
			}
		}
		if !record.IsEmpty() {
			rows = append(rows, record)
		}
	}
	return rows, nil
}

// CleanAmount membersihkan teks nominal gaya Indonesia lalu mengembalikan angkanya.
// Menghilangkan "Rp", spasi, lalu menafsirkan titik sebagai pemisah ribuan
// bila ada koma desimal — aturan yang sama seperti excelAmount() pada backend lama.
func CleanAmount(value string) (float64, bool) {
	raw := stripCurrency(value)
	if raw == "" {
		return 0, true
	}
	normalized := raw
	if strings.Contains(raw, ",") && strings.Contains(raw, ".") {
		normalized = strings.ReplaceAll(strings.ReplaceAll(raw, ".", ""), ",", ".")
	} else {
		normalized = strings.ReplaceAll(raw, ",", ".")
	}
	parsed, err := strconv.ParseFloat(strings.TrimSpace(normalized), 64)
	if err != nil {
		return 0, false
	}
	return parsed, true
}

func stripCurrency(value string) string {
	var builder strings.Builder
	for _, r := range value {
		switch r {
		case 'R', 'r', 'p', 'P', ' ', '\t', '\n', '\r', '\u00a0', '\u202f':
			continue
		}
		builder.WriteRune(r)
	}
	return builder.String()
}
