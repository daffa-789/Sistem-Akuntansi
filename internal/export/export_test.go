package export

import (
	"bytes"
	"compress/zlib"
	"io"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"
)

func TestMoneyMatchesIndonesianIntlFormat(t *testing.T) {
	cases := []struct {
		in   float64
		want string
	}{
		{0, "Rp 0"},
		{1234567, "Rp 1.234.567"},
		{1500000.5, "Rp 1.500.001"},
		{-250000, "-Rp 250.000"},
		{999, "Rp 999"},
		{1000, "Rp 1.000"},
		{1000000000, "Rp 1.000.000.000"},
	}
	for _, item := range cases {
		if got := Money(item.in); got != item.want {
			t.Fatalf("Money(%v)=%q, ingin %q", item.in, got, item.want)
		}
	}
}

func TestNumberUsesCommaForDecimals(t *testing.T) {
	cases := []struct {
		in   float64
		want string
	}{
		{1500.5, "1.500,5"},
		{1234.56, "1.234,56"},
		{0, "0"},
	}
	for _, item := range cases {
		if got := Number(item.in); got != item.want {
			t.Fatalf("Number(%v)=%q, ingin %q", item.in, got, item.want)
		}
	}
}

func TestDateLabelUsesIndonesianMonths(t *testing.T) {
	cases := []struct{ in, want string }{
		{"2026-09-15", "15 Sep 2026"},
		{"2026-05-01", "1 Mei 2026"},
		{"2026-12-31", "31 Des 2026"},
		{"", "—"},
		{"bukan tanggal", "bukan tanggal"},
	}
	for _, item := range cases {
		if got := DateLabel(item.in); got != item.want {
			t.Fatalf("DateLabel(%q)=%q, ingin %q", item.in, got, item.want)
		}
	}
}

func sampleJournalData() JournalData {
	debit := "1100"
	name := "Kas"
	creditName := "Pendapatan Jasa"
	_ = debit
	return JournalData{
		Company:     "CV Uji Coba",
		From:        "2026-01-01",
		To:          "2026-01-31",
		TotalDebit:  1500000,
		TotalCredit: 1500000,
		Entries: []JournalRow{
			{Date: "2026-01-05", Voucher: "JRN-001", ShowHead: true, Account: name, Ref: "1100", Debit: 1500000},
			{Account: CreditMarker(false) + creditName, Ref: "4100", Credit: 1500000, IsCredit: true, EndMemo: "Pendapatan jasa bulan Januari"},
		},
		Recap: Recap{
			Debits:      []RecapItem{{Code: "1100", Name: "Kas", Amount: 1500000}},
			Credits:     []RecapItem{{Code: "4100", Name: "Pendapatan Jasa", Amount: 1500000}},
			TotalDebit:  1500000,
			TotalCredit: 1500000,
			IsBalanced:  true,
		},
		Signers:   Signers{Maker: "Budi", Checker: "Sari", Approver: "Direktur"},
		PrintedOn: "2026-02-01",
	}
}

func TestJournalWorkbookStructure(t *testing.T) {
	book, err := JournalWorkbook(sampleJournalData())
	if err != nil {
		t.Fatalf("JournalWorkbook gagal: %v", err)
	}
	if len(book) < 3000 {
		t.Fatalf("berkas xlsx terlalu kecil: %d byte", len(book))
	}
	if !bytes.HasPrefix(book, []byte("PK")) {
		t.Fatal("hasil bukan arsip .xlsx (harus diawali PK)")
	}

	file, err := excelize.OpenReader(bytes.NewReader(book))
	if err != nil {
		t.Fatalf("xlsx tidak dapat dibaca ulang: %v", err)
	}
	defer func() { _ = file.Close() }()

	sheets := file.GetSheetList()
	if len(sheets) != 2 || sheets[0] != "Jurnal Umum" || sheets[1] != "Rekapitulasi Jurnal" {
		t.Fatalf("susunan sheet salah: %#v", sheets)
	}
	cell := func(sheet, coordinate string) string {
		value, err := file.GetCellValue(sheet, coordinate)
		if err != nil {
			t.Fatalf("baca %s!%s: %v", sheet, coordinate, err)
		}
		return value
	}
	if got := cell("Jurnal Umum", "A1"); got != "CV Uji Coba" {
		t.Fatalf("kop nama perusahaan salah: %q", got)
	}
	if got := cell("Jurnal Umum", "A6"); got != "Tanggal" {
		t.Fatalf("judul kolom pertama salah (baris 6): %q", got)
	}
	if got := cell("Jurnal Umum", "A7"); got != "2026-01-05" {
		t.Fatalf("tanggal hanya pada baris pertama entri: %q", got)
	}
	if got := cell("Jurnal Umum", "C7"); got != "Kas" {
		t.Fatalf("akun debit harus rata kiri: %q", got)
	}
	if got := cell("Jurnal Umum", "C8"); !strings.HasPrefix(got, "     ↳ ") || !strings.HasSuffix(got, "Pendapatan Jasa") {
		t.Fatalf("akun kredit harus menjorok dengan panah: %q", got)
	}
	// Sel nominal harus tetap berupa angka (bukan teks) agar dapat dijumlah Excel;
	// format '#,##0' menampilkannya dengan pemisah ribuan.
	if raw, err := file.GetCellValue("Jurnal Umum", "E7", excelize.Options{RawCellValue: true}); err != nil || raw != "1500000" {
		t.Fatalf("debit harus tersimpan sebagai angka, dapat %q (err %v)", raw, err)
	}
	if got := cell("Jurnal Umum", "C9"); !strings.Contains(got, "Pendapatan jasa bulan Januari") {
		t.Fatalf("baris keterangan harus mengikuti seluruh entri: %q", got)
	}
	if got := cell("Jurnal Umum", "C10"); !strings.Contains(got, "JUMLAH TOTAL") {
		t.Fatalf("baris total salah: %q", got)
	}
	if got := cell("Rekapitulasi Jurnal", "A1"); got != "CV Uji Coba" {
		t.Fatalf("kop sheet rekapitulasi salah: %q", got)
	}
	recapRows, err := file.GetRows("Rekapitulasi Jurnal", excelize.Options{RawCellValue: true})
	if err != nil {
		t.Fatalf("baca sheet rekapitulasi: %v", err)
	}
	recapText := strings.Join(flattenRows(recapRows), "|")
	for _, want := range []string{"DEBIT: Kode Akun", "KREDIT: Kode Akun", "1100", "4100", "TOTAL DEBIT", "TOTAL KREDIT", "1500000"} {
		if !strings.Contains(recapText, want) {
			t.Fatalf("sheet rekapitulasi harus memuat %q, dapat: %s", want, recapText)
		}
	}
}

// flattenRows menggabungkan seluruh sel dari hasil GetRows menjadi daftar teks.
func flattenRows(rows [][]string) []string {
	flat := []string{}
	for _, row := range rows {
		flat = append(flat, row...)
	}
	return flat
}

func TestJournalPDFContainsTables(t *testing.T) {
	pdf, err := JournalPDF(sampleJournalData())
	if err != nil {
		t.Fatalf("JournalPDF gagal: %v", err)
	}
	if len(pdf) < 1500 {
		t.Fatalf("berkas pdf terlalu kecil: %d byte", len(pdf))
	}
	if !bytes.HasPrefix(pdf, []byte("%PDF-1.")) {
		t.Fatalf("header pdf salah: %q", pdf[:8])
	}
	if !bytes.Contains(pdf, []byte("%%EOF")) {
		t.Fatal("pdf tidak lengkap, penutup EOF hilang")
	}

	// Isi halaman dikompresi Flate; buka stream-nya untuk memastikan teks laporan
	// benar-benar tertulis (bukan hanya kerangka pdf).
	text := pdfStreamText(t, pdf)
	for _, want := range []string{
		"CV Uji Coba", "JURNAL UMUM", "Tanggal", "JRN-001", "Kas", "Pendapatan Jasa",
		"TOTAL", "REKAPITULASI", "Dibuat Oleh", "Budi", "1.500.000",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("isi pdf harus memuat %q.\n--- teks hasil dekompressi ---\n%s", want, text)
		}
	}
	// Font inti pdf memakai cp1252, jadi penanda kredit ditulis sebagai satu byte 0xBB.
	if !strings.Contains(text, string([]byte{0xBB})) {
		t.Fatal("baris kredit pdf harus memakai penanda pengganti panah")
	}
}

// pdfStreamText membuka semua stream FlateDecode dalam berkas pdf dan menggabungkannya.
func pdfStreamText(t *testing.T, pdf []byte) string {
	t.Helper()
	var builder strings.Builder
	rest := pdf
	for {
		start := bytes.Index(rest, []byte("stream"))
		if start < 0 {
			break
		}
		rest = rest[start+len("stream"):]
		if len(rest) > 2 && rest[0] == '\r' {
			rest = rest[1:]
		}
		rest = bytes.TrimPrefix(rest, []byte("\n"))
		end := bytes.Index(rest, []byte("endstream"))
		if end < 0 {
			break
		}
		raw := rest[:end]
		rest = rest[end+len("endstream"):]
		reader, err := zlib.NewReader(bytes.NewReader(raw))
		if err != nil {
			continue
		}
		decompressed, err := io.ReadAll(reader)
		_ = reader.Close()
		if err != nil {
			continue
		}
		builder.Write(decompressed)
		builder.WriteByte('\n')
	}
	if builder.Len() == 0 {
		t.Fatal("tidak ada stream pdf yang dapat dibaca")
	}
	return builder.String()
}

func TestOtherWorkbooksBuild(t *testing.T) {
	ledger, err := LedgerWorkbook(LedgerData{
		Company: "CV Uji", AccountLabel: "1100 - Kas", NormalBalance: "DEBIT",
		From: "2026-01-01", To: "2026-01-31", Opening: 100000,
		Rows: []LedgerRow{{Date: "2026-01-05", Voucher: "JRN-001", Description: "Masuk", Debit: 50000, Balance: 150000}},
	})
	if err != nil || len(ledger) < 2000 {
		t.Fatalf("buku besar gagal: %v (%d byte)", err, len(ledger))
	}
	trial, err := TrialBalanceWorkbook(TrialBalanceData{
		Company: "CV Uji", AsOf: "2026-01-31",
		Rows:        []TrialBalanceRow{{Code: "1100", Name: "Kas", Group: "ASSET", Debit: 150000}},
		TotalDebit:  150000,
		TotalCredit: 0,
	})
	if err != nil || len(trial) < 2000 {
		t.Fatalf("neraca saldo gagal: %v", err)
	}
	accounts, err := AccountsWorkbook(AccountsData{
		Company: "CV Uji",
		Rows:    []AccountRow{{Code: "1100", Name: "Kas", Group: "ASSET", NormalBalance: "DEBIT", CashLabel: "Ya (Kas/Bank)"}},
	})
	if err != nil || len(accounts) < 2000 {
		t.Fatalf("bagan akun gagal: %v", err)
	}
}

func TestSignersDefaults(t *testing.T) {
	got := Signers{Maker: "Budi"}.WithDefaults()
	if got.Maker != "Budi" || got.Checker != "Auditor / Penguji" || got.Approver != "Pimpinan / Direktur" {
		t.Fatalf("bawaan penanda tangan salah: %+v", got)
	}
}
