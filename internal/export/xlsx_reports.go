package export

import (
	"fmt"
	"math"
)

// headerStyle gaya judul dokumen (nama perusahaan).
var headerStyle = styleSpec{Bold: true, Size: 14, FontColor: colorAccent}
var subTitleStyle = styleSpec{Bold: true, Size: 11, FontColor: colorTextDark}
var metaStyle = styleSpec{Italic: true, Size: 10, FontColor: colorTextMuted}
var noteStyle = styleSpec{Italic: true, Size: 9, FontColor: colorTextMuted}
var tableHeadStyle = styleSpec{Bold: true, Size: 10, FontColor: colorWhite, Fill: colorPrimary, Align: "center", Valign: "middle", Border: "header"}
var cellStyle = styleSpec{Size: 10, FontColor: colorTextDark}
var cellCenterStyle = styleSpec{Size: 10, FontColor: colorTextDark, Align: "center"}
var cellRightStyle = styleSpec{Size: 10, FontColor: colorTextDark, Align: "right", Thousands: true}
var creditStyle = styleSpec{Size: 10, FontColor: colorCredit}
var memoStyle = styleSpec{Italic: true, Size: 9, FontColor: colorTextMuted}
var totalStyle = styleSpec{Bold: true, Size: 10, FontColor: colorAccent, Fill: colorPrimarySoft, Border: "total"}
var totalNumberStyle = styleSpec{Bold: true, Size: 10, FontColor: colorAccent, Fill: colorPrimarySoft, Align: "right", Thousands: true, Border: "total"}
var zebraStyle = styleSpec{Size: 10, FontColor: colorTextDark, Fill: colorZebra}
var zebraCenterStyle = styleSpec{Size: 10, FontColor: colorTextDark, Fill: colorZebra, Align: "center"}
var zebraRightStyle = styleSpec{Size: 10, FontColor: colorTextDark, Fill: colorZebra, Align: "right", Thousands: true}
var zebraCreditStyle = styleSpec{Size: 10, FontColor: colorCredit, Fill: colorZebra}

// JournalWorkbook membuat berkas .xlsx berisi sheet Jurnal Umum dan Rekapitulasi Jurnal,
// meniru exportJournalToExcel() pada klien lama.
func JournalWorkbook(data JournalData) ([]byte, error) {
	data.Signers = data.Signers.WithDefaults()
	workbook := newBook()
	const sheet = "Jurnal Umum"
	if err := workbook.addSheet(sheet); err != nil {
		return nil, err
	}
	company := fallback(data.Company, "PT Finova Akuntansi Indonesia")

	row := 1
	write := func(column int, value any, spec styleSpec) error {
		return workbook.set(sheet, row, column, value, spec)
	}

	if err := write(1, company, headerStyle); err != nil {
		return nil, err
	}
	row++
	if err := write(1, "BUKU JURNAL UMUM (GENERAL JOURNAL)", subTitleStyle); err != nil {
		return nil, err
	}
	row++
	if err := write(1, fmt.Sprintf("Periode: %s s.d. %s", DateLabel(data.From), DateLabel(data.To)), metaStyle); err != nil {
		return nil, err
	}
	row++
	if err := write(1, "(Dinyatakan dalam Rupiah / IDR — Standar Akuntansi Indonesia)", noteStyle); err != nil {
		return nil, err
	}
	row += 2

	headers := []string{"Tanggal", "No. Bukti", "Keterangan Akun & Transaksi", "Ref", "Debit (Rp)", "Kredit (Rp)"}
	for column, title := range headers {
		if err := write(column+1, title, tableHeadStyle); err != nil {
			return nil, err
		}
	}
	row++

	if len(data.Entries) == 0 {
		if err := write(3, "Belum ada transaksi pada periode ini.", styleSpec{Italic: true, Size: 10, FontColor: colorTextMuted}); err != nil {
			return nil, err
		}
		row++
	}

	for _, entry := range data.Entries {
		plain, zebra, right, center, credit := cellStyle, zebraStyle, cellRightStyle, cellCenterStyle, creditStyle
		if entry.Alternate {
			plain, zebra, right, center, credit = zebraStyle, zebraStyle, zebraRightStyle, zebraCenterStyle, zebraCreditStyle
		}
		_ = plain
		accountSpec := zebra
		if entry.IsCredit {
			accountSpec = credit
		}
		if entry.ShowHead {
			if err := write(1, entry.Date, center); err != nil {
				return nil, err
			}
			if err := write(2, entry.Voucher, center); err != nil {
				return nil, err
			}
		} else {
			if err := write(1, "", center); err != nil {
				return nil, err
			}
			if err := write(2, "", center); err != nil {
				return nil, err
			}
		}
		if err := write(3, entry.Account, accountSpec); err != nil {
			return nil, err
		}
		if err := write(4, entry.Ref, center); err != nil {
			return nil, err
		}
		debit, creditValue := any(""), any("")
		if entry.Debit > 0 {
			debit = entry.Debit
		}
		if entry.Credit > 0 {
			creditValue = entry.Credit
		}
		if err := write(5, debit, right); err != nil {
			return nil, err
		}
		if err := write(6, creditValue, right); err != nil {
			return nil, err
		}
		row++

		if entry.EndMemo != "" {
			if err := write(1, "", center); err != nil {
				return nil, err
			}
			if err := write(2, "", center); err != nil {
				return nil, err
			}
			if err := write(3, "("+entry.EndMemo+")", styleSpec{Italic: true, Size: 9, FontColor: colorTextMuted, Fill: fillOf(zebra)}); err != nil {
				return nil, err
			}
			if err := write(4, "", center); err != nil {
				return nil, err
			}
			if err := write(5, "", right); err != nil {
				return nil, err
			}
			if err := write(6, "", right); err != nil {
				return nil, err
			}
			row++
		}
	}

	totalCells := []any{"", "", "JUMLAH TOTAL JURNAL", "", data.TotalDebit, data.TotalCredit}
	for index, value := range totalCells {
		spec := totalStyle
		if index >= 4 {
			spec = totalNumberStyle
		}
		if index == 2 {
			spec = styleSpec{Bold: true, Size: 10, FontColor: colorAccent, Fill: colorPrimarySoft, Align: "right", Border: "total"}
		}
		if err := workbook.set(sheet, row, index+1, value, spec); err != nil {
			return nil, err
		}
	}
	row += 3

	printedOn := data.PrintedOn
	if printedOn == "" {
		printedOn = Today()
	}
	if err := workbook.set(sheet, row, 5, "Dicetak pada:", noteStyle); err != nil {
		return nil, err
	}
	if err := workbook.set(sheet, row, 6, DateLabel(printedOn), noteStyle); err != nil {
		return nil, err
	}
	row += 2

	signTitles := []string{"Dibuat Oleh,", "Diperiksa Oleh,", "Disetujui Oleh,"}
	signNames := []string{data.Signers.Maker, data.Signers.Checker, data.Signers.Approver}
	for index, title := range signTitles {
		column := index*2 + 2
		if column > 6 {
			column = 6
		}
		if err := workbook.set(sheet, row, column, title, styleSpec{Bold: true, Size: 10, Align: "center"}); err != nil {
			return nil, err
		}
	}
	row += 4
	for index, name := range signNames {
		column := index*2 + 2
		if column > 6 {
			column = 6
		}
		if err := workbook.set(sheet, row, column, fmt.Sprintf("( %s )", name), styleSpec{Bold: true, Size: 10, FontColor: colorTextDark, Align: "center"}); err != nil {
			return nil, err
		}
	}

	if err := workbook.setWidths(sheet, []float64{14, 16, 44, 10, 18, 18}); err != nil {
		return nil, err
	}
	if err := workbook.freeze(sheet, "A7"); err != nil {
		return nil, err
	}

	if !data.Recap.Empty() {
		if err := journalRecapSheet(workbook, data, company); err != nil {
			return nil, err
		}
	}
	return workbook.bytes()
}

// fillOf mengambil warna isian dari sebuah gaya (untuk baris keterangan).
func fillOf(spec styleSpec) string { return spec.Fill }

// journalRecapSheet menulis sheet kedua berisi rekapitulasi debit/kredit per akun.
func journalRecapSheet(workbook *book, data JournalData, company string) error {
	const sheet = "Rekapitulasi Jurnal"
	if err := workbook.addSheet(sheet); err != nil {
		return err
	}
	row := 1
	if err := workbook.set(sheet, row, 1, company, headerStyle); err != nil {
		return err
	}
	row++
	if err := workbook.set(sheet, row, 1, "TABEL REKAPITULASI JURNAL UMUM", styleSpec{Bold: true, Size: 11}); err != nil {
		return err
	}
	row++
	if err := workbook.set(sheet, row, 1, fmt.Sprintf("Periode: %s s.d. %s", DateLabel(data.From), DateLabel(data.To)), metaStyle); err != nil {
		return err
	}
	row += 2

	head := []string{"DEBIT: Kode Akun", "Nama Akun", "Jumlah (Rp)", "", "KREDIT: Kode Akun", "Nama Akun", "Jumlah (Rp)"}
	for column, title := range head {
		if column == 3 {
			continue
		}
		if err := workbook.set(sheet, row, column+1, title, tableHeadStyle); err != nil {
			return err
		}
	}
	row++

	maxLength := len(data.Recap.Debits)
	if len(data.Recap.Credits) > maxLength {
		maxLength = len(data.Recap.Credits)
	}
	for index := 0; index < maxLength; index++ {
		var debit, credit *RecapItem
		if index < len(data.Recap.Debits) {
			item := data.Recap.Debits[index]
			debit = &item
		}
		if index < len(data.Recap.Credits) {
			item := data.Recap.Credits[index]
			credit = &item
		}
		values := []any{"", "", "", "", "", "", ""}
		if debit != nil {
			values[0], values[1], values[2] = debit.Code, debit.Name, debit.Amount
		}
		if credit != nil {
			values[4], values[5], values[6] = credit.Code, credit.Name, credit.Amount
		}
		for column, value := range values {
			if column == 3 {
				continue
			}
			spec := cellStyle
			if column == 2 || column == 6 {
				spec = cellRightStyle
			}
			if err := workbook.set(sheet, row, column+1, value, spec); err != nil {
				return err
			}
		}
		row++
	}

	totals := []any{"", "TOTAL DEBIT", data.Recap.TotalDebit, "", "", "TOTAL KREDIT", data.Recap.TotalCredit}
	for column, value := range totals {
		if column == 3 {
			continue
		}
		spec := totalStyle
		if column == 2 || column == 6 {
			spec = totalNumberStyle
		}
		if err := workbook.set(sheet, row, column+1, value, spec); err != nil {
			return err
		}
	}
	return workbook.setWidths(sheet, []float64{16, 30, 18, 4, 16, 30, 18})
}

// LedgerWorkbook membuat .xlsx Buku Besar satu akun, meniru exportLedgerToExcel().
func LedgerWorkbook(data LedgerData) ([]byte, error) {
	workbook := newBook()
	const sheet = "Buku Besar"
	if err := workbook.addSheet(sheet); err != nil {
		return nil, err
	}
	company := fallback(data.Company, "PT Finova Akuntansi Indonesia")
	row := 1
	must := func(column int, value any, spec styleSpec) error {
		return workbook.set(sheet, row, column, value, spec)
	}
	if err := must(1, company, headerStyle); err != nil {
		return nil, err
	}
	row++
	if err := must(1, fmt.Sprintf("BUKU BESAR (GENERAL LEDGER) — %s", fallback(data.AccountLabel, "SEMUA AKUN")), styleSpec{Bold: true, Size: 11}); err != nil {
		return nil, err
	}
	row++
	if err := must(1, fmt.Sprintf("Periode: %s s.d. %s", DateLabel(data.From), DateLabel(data.To)), metaStyle); err != nil {
		return nil, err
	}
	row++
	normal := data.NormalBalance
	if normal == "" {
		normal = "DEBIT"
	}
	if err := must(1, "Saldo Normal: "+normal, styleSpec{Bold: true, Size: 9, FontColor: colorPrimary}); err != nil {
		return nil, err
	}
	row += 2

	for column, title := range []string{"Tanggal", "No. Bukti", "Keterangan Transaksi", "Debit (Rp)", "Kredit (Rp)", "Saldo Akhir (Rp)"} {
		if err := must(column+1, title, tableHeadStyle); err != nil {
			return nil, err
		}
	}
	row++

	if err := workbook.set(sheet, row, 1, data.From, cellCenterStyle); err != nil {
		return nil, err
	}
	if err := workbook.set(sheet, row, 3, "SALDO AWAL PERIODE", styleSpec{Bold: true, Italic: true}); err != nil {
		return nil, err
	}
	if err := workbook.set(sheet, row, 6, data.Opening, cellRightStyle); err != nil {
		return nil, err
	}
	row++

	totalDebit, totalCredit := 0.0, 0.0
	for _, item := range data.Rows {
		totalDebit += item.Debit
		totalCredit += item.Credit
		values := []any{item.Date, item.Voucher, item.Description, blankZero(item.Debit), blankZero(item.Credit), item.Balance}
		for column, value := range values {
			spec := cellStyle
			switch column {
			case 0, 1:
				spec = cellCenterStyle
			case 3, 4, 5:
				spec = cellRightStyle
			}
			if err := workbook.set(sheet, row, column+1, value, spec); err != nil {
				return nil, err
			}
		}
		row++
	}

	totals := []any{"", "", "TOTAL MUTASI PERIODE", totalDebit, totalCredit, data.Closing}
	for column, value := range totals {
		spec := totalStyle
		if column >= 3 {
			spec = totalNumberStyle
		}
		if err := workbook.set(sheet, row, column+1, value, spec); err != nil {
			return nil, err
		}
	}
	if err := workbook.setWidths(sheet, []float64{14, 16, 36, 18, 18, 20}); err != nil {
		return nil, err
	}
	if err := workbook.freeze(sheet, "A7"); err != nil {
		return nil, err
	}
	return workbook.bytes()
}

// TrialBalanceWorkbook membuat .xlsx Neraca Saldo, meniru exportTrialBalanceToExcel().
func TrialBalanceWorkbook(data TrialBalanceData) ([]byte, error) {
	workbook := newBook()
	const sheet = "Neraca Saldo"
	if err := workbook.addSheet(sheet); err != nil {
		return nil, err
	}
	company := fallback(data.Company, "PT Finova Akuntansi Indonesia")
	row := 1
	if err := workbook.set(sheet, row, 1, company, headerStyle); err != nil {
		return nil, err
	}
	row++
	if err := workbook.set(sheet, row, 1, "NERACA SALDO (TRIAL BALANCE)", styleSpec{Bold: true, Size: 11}); err != nil {
		return nil, err
	}
	row++
	if err := workbook.set(sheet, row, 1, "Per Tanggal: "+DateLabel(data.AsOf), metaStyle); err != nil {
		return nil, err
	}
	row++
	if err := workbook.set(sheet, row, 1, "(Dinyatakan dalam Rupiah / IDR)", noteStyle); err != nil {
		return nil, err
	}
	row += 2

	for column, title := range []string{"Kode Akun", "Nama Akun", "Kelompok", "Debit (Rp)", "Kredit (Rp)"} {
		if err := workbook.set(sheet, row, column+1, title, tableHeadStyle); err != nil {
			return nil, err
		}
	}
	row++

	for _, item := range data.Rows {
		values := []any{item.Code, item.Name, item.Group, blankZero(item.Debit), blankZero(item.Credit)}
		for column, value := range values {
			spec := cellStyle
			if column >= 3 {
				spec = cellRightStyle
			}
			if err := workbook.set(sheet, row, column+1, value, spec); err != nil {
				return nil, err
			}
		}
		row++
	}

	totals := []any{"", "TOTAL NERACA SALDO", "", data.TotalDebit, data.TotalCredit}
	for column, value := range totals {
		spec := totalStyle
		if column >= 3 {
			spec = totalNumberStyle
		}
		if err := workbook.set(sheet, row, column+1, value, spec); err != nil {
			return nil, err
		}
	}
	if err := workbook.setWidths(sheet, []float64{14, 34, 18, 20, 20}); err != nil {
		return nil, err
	}
	if err := workbook.freeze(sheet, "A7"); err != nil {
		return nil, err
	}
	return workbook.bytes()
}

// AccountsWorkbook membuat .xlsx master Bagan Akun, meniru exportAccountsToExcel().
func AccountsWorkbook(data AccountsData) ([]byte, error) {
	workbook := newBook()
	const sheet = "Bagan Akun"
	if err := workbook.addSheet(sheet); err != nil {
		return nil, err
	}
	company := fallback(data.Company, "PT Finova Akuntansi Indonesia")
	row := 1
	if err := workbook.set(sheet, row, 1, company, headerStyle); err != nil {
		return nil, err
	}
	row++
	if err := workbook.set(sheet, row, 1, "BAGAN AKUN STANDAR INDONESIA (CHART OF ACCOUNTS)", styleSpec{Bold: true, Size: 11}); err != nil {
		return nil, err
	}
	row++
	if err := workbook.set(sheet, row, 1, fmt.Sprintf("Total Akun Terdaftar: %d Akun", len(data.Rows)), metaStyle); err != nil {
		return nil, err
	}
	row += 2

	for column, title := range []string{"Kode", "Nama Akun", "Kelompok", "Subtipe", "Saldo Normal", "Kategori Arus Kas", "Kas/Bank"} {
		if err := workbook.set(sheet, row, column+1, title, tableHeadStyle); err != nil {
			return nil, err
		}
	}
	row++

	for _, item := range data.Rows {
		values := []any{item.Code, item.Name, item.Group, fallback(item.Subtype, "-"), item.NormalBalance, fallback(item.CashFlow, "OPERATING"), item.CashLabel}
		for column, value := range values {
			if err := workbook.set(sheet, row, column+1, value, cellStyle); err != nil {
				return nil, err
			}
		}
		row++
	}
	if err := workbook.setWidths(sheet, []float64{12, 34, 18, 18, 16, 20, 14}); err != nil {
		return nil, err
	}
	if err := workbook.freeze(sheet, "A6"); err != nil {
		return nil, err
	}
	return workbook.bytes()
}

func fallback(value, instead string) string {
	if value == "" {
		return instead
	}
	return value
}

// blankZero menulis string kosong untuk nol agar kolom tetap dapat dijumlah.
func blankZero(value float64) any {
	if math.Abs(value) < 0.005 {
		return ""
	}
	return value
}
