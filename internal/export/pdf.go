package export

import (
	"bytes"
	"fmt"
	"strings"

	"github.com/go-pdf/fpdf"
)

// creditMarkerPDF memakai "»" karena panah "↳" tidak ada pada font inti Helvetica
// (cp1252) yang dipakai pdf; di berkas .xlsx panah aslinya tetap dipakai.
const creditMarkerPDF = "     » "

const creditMarkerExcel = "     ↳ "

// CreditMarker mengembalikan awalan baris kredit untuk media yang dipilih.
func CreditMarker(pdf bool) string {
	if pdf {
		return creditMarkerPDF
	}
	return creditMarkerExcel
}

type pdfColumn struct {
	Title string
	Width float64
	Align string
}

// JournalPDF membuat laporan Jurnal Umum A4 portrait: kop, tabel jurnal,
// rekapitulasi, dan lembar pengesahan — menggantikan jsPDF + autoTable.
func JournalPDF(data JournalData) ([]byte, error) {
	data.Signers = data.Signers.WithDefaults()
	pdf := fpdf.New("P", "mm", "A4", "")
	pdf.SetTitle("Jurnal Umum - "+fallback(data.Company, "Finova"), false)
	pdf.SetAuthor("Finova", false)
	pdf.SetSubject("Buku Jurnal Umum (General Journal)", false)
	pdf.SetMargins(14, 14, 16)
	pdf.SetCompression(true)
	pdf.AddPage()

	company := fallback(data.Company, "PT Finova Akuntansi Indonesia")
	pdf.SetTextColor(10, 88, 53)
	pdf.SetFont("Helvetica", "B", 14)
	pdf.Cell(0, 7, company)
	pdf.Ln(8)

	pdf.SetTextColor(30, 41, 59)
	pdf.SetFont("Helvetica", "B", 11)
	pdf.Cell(0, 6, "JURNAL UMUM (GENERAL JOURNAL)")
	pdf.Ln(7)

	printedOn := data.PrintedOn
	if printedOn == "" {
		printedOn = Today()
	}
	pdf.SetTextColor(100, 116, 139)
	pdf.SetFont("Helvetica", "I", 9)
	pdf.Cell(0, 5, fmt.Sprintf("Periode: %s s.d. %s | Dicetak: %s", DateLabel(data.From), DateLabel(data.To), DateLabel(printedOn)))
	pdf.Ln(9)

	columns := []pdfColumn{
		{Title: "Tanggal", Width: 22, Align: "C"},
		{Title: "No. Bukti", Width: 26, Align: "C"},
		{Title: "Keterangan Akun & Transaksi", Width: 70, Align: "L"},
		{Title: "Ref", Width: 15, Align: "C"},
		{Title: "Debit (Rp)", Width: 28, Align: "R"},
		{Title: "Kredit (Rp)", Width: 28, Align: "R"},
	}
	rows := make([][][]byte, 0, len(data.Entries)+1)
	for _, entry := range data.Entries {
		// Font inti pdf hanya cp1252: panah "↳" akan hilang tanpa suara, jadi
		// penanda kredit dinormalisasi ke "»" apa pun yang dikirim pemanggil.
		description := strings.ReplaceAll(entry.Account, creditMarkerExcel, creditMarkerPDF)
		// Keterangan: memo per baris bila ada, jika tidak keterangan entri pada baris
		// pertama (sama seperti klien lama).
		extra := entry.LineMemo
		if extra == "" && entry.ShowHead {
			extra = firstNonEmptyString(entry.Memo, entry.EndMemo)
		}
		if extra != "" {
			description += "\n(" + extra + ")"
		}
		rows = append(rows, [][]byte{
			[]byte(entry.Date),
			[]byte(entry.Voucher),
			[]byte(description),
			[]byte(entry.Ref),
			[]byte(moneyOrEmpty(entry.Debit)),
			[]byte(moneyOrEmpty(entry.Credit)),
		})
	}
	rows = append(rows, [][]byte{
		[]byte(""), []byte(""), []byte("TOTAL"), []byte(""),
		[]byte(Money(data.TotalDebit)), []byte(Money(data.TotalCredit)),
	})
	y := drawPDFTable(pdf, columns, rows, 8, [3]int{14, 113, 69}, len(rows)-1, [3]int{240, 253, 244})

	if y < 215 && !data.Recap.Empty() {
		pdf.SetTextColor(30, 41, 59)
		pdf.SetFont("Helvetica", "B", 10)
		pdf.SetXY(14, y+6)
		pdf.Cell(0, 6, "REKAPITULASI JURNAL UMUM")
		y += 12

		recapColumns := []pdfColumn{
			{Title: "Akun Debit", Width: 55, Align: "L"},
			{Title: "Jumlah", Width: 35, Align: "R"},
			{Title: "Akun Kredit", Width: 55, Align: "L"},
			{Title: "Jumlah", Width: 35, Align: "R"},
		}
		maxLength := len(data.Recap.Debits)
		if len(data.Recap.Credits) > maxLength {
			maxLength = len(data.Recap.Credits)
		}
		recapRows := make([][][]byte, 0, maxLength+1)
		for index := 0; index < maxLength; index++ {
			var debit, credit string
			var debitAmount, creditAmount string
			if index < len(data.Recap.Debits) {
				item := data.Recap.Debits[index]
				debit = fmt.Sprintf("%s - %s", item.Code, item.Name)
				debitAmount = Money(item.Amount)
			}
			if index < len(data.Recap.Credits) {
				item := data.Recap.Credits[index]
				credit = fmt.Sprintf("%s - %s", item.Code, item.Name)
				creditAmount = Money(item.Amount)
			}
			recapRows = append(recapRows, [][]byte{[]byte(debit), []byte(debitAmount), []byte(credit), []byte(creditAmount)})
		}
		recapRows = append(recapRows, [][]byte{
			[]byte("TOTAL DEBIT"), []byte(Money(data.Recap.TotalDebit)),
			[]byte("TOTAL KREDIT"), []byte(Money(data.Recap.TotalCredit)),
		})
		y = drawPDFTable(pdf, recapColumns, recapRows, 7, [3]int{2, 132, 199}, -1, [3]int{})
	}

	if y > 235 {
		pdf.AddPage()
		y = 20
	}
	drawSignatures(pdf, y+12, data.Signers)

	buffer := &bytes.Buffer{}
	if err := pdf.Output(buffer); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

// drawPDFTable menggambar tabel sederhana dengan pemenggalan baris dan ganti halaman.
// barisTebal menandai indeks baris total (=-1 bila tidak ada).
func drawPDFTable(pdf *fpdf.Fpdf, columns []pdfColumn, rows [][][]byte, fontSize float64, headColor [3]int, boldRow int, boldColor [3]int) float64 {
	const padding = 2.5
	const lineFactor = 1.25
	lineHeight := fontSize * lineFactor

	pdf.SetLineWidth(0.15)
	pdf.SetDrawColor(226, 232, 240)
	left, top, _, bottom := pdf.GetMargins()
	_, pageHeight := pdf.GetPageSize()
	bottomLimit := pageHeight - bottom

	// drawRow menggambar satu baris sel; posisi X diatur ulang tiap sel agar tidak
	// bergantung pada efek samping MultiCell.
	drawRow := func(cells [][]byte, y, height float64, bold, fill bool, textColor [3]int) float64 {
		x := left
		style := ""
		if bold {
			style = "B"
		}
		pdf.SetFont("Helvetica", style, fontSize)
		pdf.SetTextColor(textColor[0], textColor[1], textColor[2])
		for position, column := range columns {
			text := ""
			if position < len(cells) {
				text = string(cells[position])
			}
			pdf.SetXY(x, y)
			pdf.MultiCell(column.Width, lineHeight, text, "1", column.Align, fill)
			x += column.Width
		}
		return y + height
	}

	// Judul tabel.
	pdf.SetTextColor(255, 255, 255)
	pdf.SetFillColor(headColor[0], headColor[1], headColor[2])
	headerCells := make([][]byte, 0, len(columns))
	for _, column := range columns {
		headerCells = append(headerCells, []byte(column.Title))
	}
	y := drawRow(headerCells, pdf.GetY(), lineHeight+1.5, true, true, [3]int{255, 255, 255})

	for index, row := range rows {
		// Tinggi baris = jumlah baris teks terbanyak di antara sel-selnya.
		lines := 1
		for position, column := range columns {
			if position >= len(row) {
				continue
			}
			split := pdf.SplitLines(row[position], column.Width-padding*2)
			if len(split) > lines {
				lines = len(split)
			}
		}
		rowHeight := float64(lines)*lineHeight + padding
		if y+rowHeight > bottomLimit {
			pdf.AddPage()
			y = top
		}

		isBoldRow := index == boldRow
		zebra := index%2 == 1
		switch {
		case isBoldRow:
			pdf.SetFillColor(boldColor[0], boldColor[1], boldColor[2])
		case zebra:
			pdf.SetFillColor(248, 250, 252)
		default:
			pdf.SetFillColor(255, 255, 255)
		}
		y = drawRow(row, y, rowHeight, isBoldRow, isBoldRow || zebra, [3]int{30, 41, 59})
	}
	return y
}

// drawSignatures menulis blok "Dibuat / Diperiksa / Disetujui" lengkap dengan garis.
func drawSignatures(pdf *fpdf.Fpdf, y float64, signers Signers) {
	pdf.SetTextColor(30, 41, 59)
	pdf.SetFont("Helvetica", "B", 9)
	pdf.SetXY(25, y)
	pdf.Cell(0, 5, "Dibuat Oleh:")
	pdf.SetXY(90, y)
	pdf.Cell(0, 5, "Diperiksa Oleh:")
	pdf.SetXY(155, y)
	pdf.Cell(0, 5, "Disetujui Oleh:")

	pdf.SetFont("Helvetica", "", 9)
	pdf.SetDrawColor(30, 41, 59)
	pdf.Line(20, y+18, 65, y+18)
	pdf.SetXY(25, y+20)
	pdf.Cell(0, 5, firstNonEmptyString(signers.Maker, "Staf Keuangan"))
	pdf.Line(85, y+18, 130, y+18)
	pdf.SetXY(90, y+20)
	pdf.Cell(0, 5, firstNonEmptyString(signers.Checker, "Auditor / Penguji"))
	pdf.Line(150, y+18, 195, y+18)
	pdf.SetXY(155, y+20)
	pdf.Cell(0, 5, firstNonEmptyString(signers.Approver, "Pimpinan / Direktur"))
}

func moneyOrEmpty(value float64) string {
	if value <= 0 {
		return ""
	}
	return Money(value)
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
