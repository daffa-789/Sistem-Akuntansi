package export

import (
	"fmt"
	"strconv"

	"github.com/xuri/excelize/v2"
)

// Palet Finova (tanpa tanda pagar, format ARGB excelize).
const (
	colorPrimary     = "0E7145"
	colorPrimarySoft = "EAF7F0"
	colorAccent      = "0A5835"
	colorWhite       = "FFFFFF"
	colorTextDark    = "1E293B"
	colorTextMuted   = "64748B"
	colorCredit      = "0369A1"
	colorBorder      = "E2E8F0"
	colorBorderSoft  = "F1F5F9"
	colorZebra       = "F8FAFC"
)

// numberFmtThousands meniru '#,##0' milik ExcelJS (pemisah ribuan, tanpa desimal).
const numberFmtThousands = "#,##0"

// styleSpec adalah kombinasi format sel yang dipakai berulang kali.
type styleSpec struct {
	Bold      bool
	Italic    bool
	Size      float64
	FontColor string
	Fill      string
	Align     string // left|center|right
	Valign    string
	Wrap      bool
	Thousands bool
	Border    string // "", "bottom", "header", "total"
}

// book membungkus excelize.File dengan cache gaya agar tidak membuat gaya duplikat
// (excelize menolak terlalu banyak gaya, dan pemborosan gaya memperbesar berkas).
type book struct {
	file   *excelize.File
	cache  map[string]int
	sheets map[string]bool
}

func newBook() *book {
	return &book{file: excelize.NewFile(), cache: map[string]int{}, sheets: map[string]bool{}}
}

func (b *book) addSheet(name string) error {
	if b.sheets[name] {
		return nil
	}
	index, err := b.file.NewSheet(name)
	if err != nil {
		return err
	}
	b.sheets[name] = true
	if !b.sheets["Sheet1"] {
		if defaultIndex, lookupErr := b.file.GetSheetIndex("Sheet1"); lookupErr == nil && defaultIndex >= 0 && defaultIndex != index {
			_ = b.file.DeleteSheet("Sheet1")
		}
	}
	b.file.SetActiveSheet(index)
	return nil
}

func (b *book) styleFor(spec styleSpec) int {
	if spec.Size == 0 {
		spec.Size = 10
	}
	key := fmt.Sprintf("%v|%v|%v|%s|%s|%s|%s|%v|%s", spec.Bold, spec.Italic, spec.Size, spec.FontColor,
		spec.Fill, spec.Align, spec.Valign, spec.Wrap, spec.Border)
	if cached, ok := b.cache[key]; ok {
		return cached
	}
	style := &excelize.Style{}
	font := &excelize.Font{Family: "Arial", Size: spec.Size, Bold: spec.Bold, Italic: spec.Italic}
	if spec.FontColor != "" {
		font.Color = spec.FontColor
	}
	style.Font = font
	if spec.Fill != "" {
		style.Fill = excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{spec.Fill}}
	}
	alignment := &excelize.Alignment{}
	switch spec.Align {
	case "center":
		alignment.Horizontal = "center"
	case "right":
		alignment.Horizontal = "right"
	case "left":
		alignment.Horizontal = "left"
	}
	if spec.Valign == "middle" {
		alignment.Vertical = "middle"
	}
	if spec.Wrap {
		alignment.WrapText = true
	}
	style.Alignment = alignment
	if spec.Thousands {
		style.NumFmt = 3
	}
	switch spec.Border {
	case "bottom":
		style.Border = []excelize.Border{
			{Type: "bottom", Color: colorBorder, Style: 1},
		}
	case "header":
		style.Border = []excelize.Border{
			{Type: "top", Color: colorBorder, Style: 1},
			{Type: "bottom", Color: colorAccent, Style: 2},
		}
	case "total":
		style.Border = []excelize.Border{
			{Type: "top", Color: colorPrimary, Style: 1},
			{Type: "bottom", Color: colorPrimary, Style: 6},
		}
	}
	id, err := b.file.NewStyle(style)
	if err != nil {
		id = 0
	}
	b.cache[key] = id
	return id
}

// set menulis satu sel (nomor ditulis sebagai angka agar dapat dijumlah Excel).
func (b *book) set(sheet string, row, column int, value any, spec styleSpec) error {
	cell, err := excelize.CoordinatesToCellName(column, row)
	if err != nil {
		return err
	}
	style := b.styleFor(spec)
	if text, isString := value.(string); isString && value != "" && !isNumeric(text) {
		if err := b.file.SetCellStr(sheet, cell, text); err != nil {
			return err
		}
	} else if value != nil && value != "" {
		switch typed := value.(type) {
		case float64:
			if err := b.file.SetCellFloat(sheet, cell, typed, -1, 64); err != nil {
				return err
			}
		case int:
			if err := b.file.SetCellInt(sheet, cell, int64(typed)); err != nil {
				return err
			}
		case int64:
			if err := b.file.SetCellInt(sheet, cell, typed); err != nil {
				return err
			}
		default:
			if err := b.file.SetCellStr(sheet, cell, fmt.Sprint(typed)); err != nil {
				return err
			}
		}
	}
	return b.file.SetCellStyle(sheet, cell, cell, style)
}

func isNumeric(text string) bool {
	if text == "" {
		return false
	}
	if _, err := strconv.ParseFloat(text, 64); err == nil {
		return true
	}
	return false
}

func (b *book) setWidths(sheet string, widths []float64) error {
	for index, width := range widths {
		if width <= 0 {
			continue
		}
		start, err := excelize.ColumnNumberToName(index + 1)
		if err != nil {
			return err
		}
		if err := b.file.SetColWidth(sheet, start, start, width); err != nil {
			return err
		}
	}
	return nil
}

func (b *book) freeze(sheet, cell string) error {
	return b.file.SetPanes(sheet, &excelize.Panes{Freeze: true, TopLeftCell: cell, ActivePane: "bottomLeft"})
}

func (b *book) bytes() ([]byte, error) {
	buffer, err := b.file.WriteToBuffer()
	if err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

// Signers isi lembar pengesahan dokumen.
type Signers struct {
	Maker    string
	Checker  string
	Approver string
}

// WithDefaults mengisi nama penanda tangan bawaan seperti aplikasi klien.
func (s Signers) WithDefaults() Signers {
	if s.Maker == "" {
		s.Maker = "Staf Keuangan"
	}
	if s.Checker == "" {
		s.Checker = "Auditor / Penguji"
	}
	if s.Approver == "" {
		s.Approver = "Pimpinan / Direktur"
	}
	return s
}

// RecapItem jumlah satu akun pada rekapitulasi.
type RecapItem struct {
	Code   string
	Name   string
	Amount float64
}

// Recap rekapitulasi debit/kredit untuk sheet kedua dan lampiran PDF.
type Recap struct {
	Debits      []RecapItem
	Credits     []RecapItem
	TotalDebit  float64
	TotalCredit float64
	IsBalanced  bool
}

// Empty apakah rekapitulasi tidak berisi apa pun (maka sheet kedua dilewati).
func (r Recap) Empty() bool { return len(r.Debits) == 0 && len(r.Credits) == 0 }

// JournalData data yang dibutuhkan laporan Jurnal Umum.
type JournalData struct {
	Company     string
	From        string
	To          string
	Entries     []JournalRow
	TotalDebit  float64
	TotalCredit float64
	Recap       Recap
	Signers     Signers
	PrintedOn   string
}

// JournalRow satu baris tabel jurnal (entri sudah diuraikan per baris).
type JournalRow struct {
	Date      string
	Voucher   string
	ShowHead  bool
	Account   string
	Ref       string
	Memo      string
	LineMemo  string
	// EndMemo ditulis pada baris TERAKHIR satu entri; lembar Excel mencetaknya sebagai
	// baris keterangan terpisah di bawah seluruh baris jurnal entri tersebut.
	EndMemo   string
	Debit     float64
	Credit    float64
	IsCredit  bool
	Alternate bool
}

// LedgerData data buku besar satu akun.
type LedgerData struct {
	Company       string
	AccountLabel  string
	NormalBalance string
	From          string
	To            string
	Opening       float64
	Rows          []LedgerRow
	Closing       float64
}

// LedgerRow satu mutasi buku besar dengan saldo berjalan.
type LedgerRow struct {
	Date        string
	Voucher     string
	Description string
	Debit       float64
	Credit      float64
	Balance     float64
}

// TrialBalanceData data neraca saldo.
type TrialBalanceData struct {
	Company     string
	AsOf        string
	Rows        []TrialBalanceRow
	TotalDebit  float64
	TotalCredit float64
}

// TrialBalanceRow satu baris neraca saldo.
type TrialBalanceRow struct {
	Code   string
	Name   string
	Group  string
	Debit  float64
	Credit float64
}

// AccountsData data master bagan akun.
type AccountsData struct {
	Company string
	Rows    []AccountRow
}

// AccountRow satu akun pada bagan akun.
type AccountRow struct {
	Code          string
	Name          string
	Group         string
	Subtype       string
	NormalBalance string
	CashFlow      string
	CashLabel     string
}
