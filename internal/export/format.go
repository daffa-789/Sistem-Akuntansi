// Package export membuat berkas laporan (.xlsx dan .pdf) di sisi server memakai
// excelize dan go-pdf/fpdf, menggantikan ExcelJS + jsPDF yang sebelumnya berjalan
// di peramban. Tata letak, warna, dan format angka mengikuti versi klien agar
// hasil unduhan tidak berubah bagi pengguna.
package export

import (
	"math"
	"strconv"
	"strings"
	"time"
)

// currencySpace adalah U+00A0 yang dipakai Intl.NumberFormat('id-ID') antara "Rp"
// dan angkanya; diganti spasi biasa akan terlihat beda di Excel/PDF.
const currencySpace = " "

// emDash menandai tanggal kosong, sama seperti dateLabel() di peramban.
const emDash = "—"

// monthLabels adalah singkatan tanggal id-ID gaya "medium" (15 Sep 2026).
var monthLabels = [...]string{
	"Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
	"Jul", "Agu", "Sep", "Okt", "Nov", "Des",
}

// Money memformat nilai sebagai "Rp\u00a01.234.567" dengan pembulatan ke rupiah
// terdekat (setengah menjauhi nol), persis Intl.NumberFormat id-ID currency IDR.
func Money(value float64) string {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return "Rp" + currencySpace + "0"
	}
	rounded := math.Round(math.Abs(value))
	negative := value < 0 && rounded != 0
	grouped := groupThousands(uint64(rounded))
	sign := ""
	if negative {
		sign = "-"
	}
	return sign + "Rp" + currencySpace + grouped
}

// Number memformat nilai dengan maksimal dua desimal dan pemisah ribuan titik,
// meniru Intl.NumberFormat('id-ID', {maximumFractionDigits: 2}).
func Number(value float64) string {
	rounded := math.Round(value*100) / 100
	negative := rounded < 0
	if negative {
		rounded = -rounded
	}
	whole := uint64(math.Floor(rounded + 1e-9))
	fraction := rounded - float64(whole)
	text := groupThousands(whole)
	cents := int(math.Round(fraction * 100))
	switch {
	case cents%10 == 0 && cents/10 > 0:
		text += "," + strconv.Itoa(cents/10)
	case cents > 0:
		text += "," + strings.Replace(strconv.Itoa(cents + 100)[1:], " ", "", -1)
	}
	if negative {
		return "-" + text
	}
	return text
}

// groupThousands menulis angka bulat dengan titik sebagai pemisah ribuan.
func groupThousands(value uint64) string {
	digits := strconv.FormatUint(value, 10)
	if len(digits) <= 3 {
		return digits
	}
	var builder strings.Builder
	lead := len(digits) % 3
	if lead > 0 {
		builder.WriteString(digits[:lead])
	}
	for i := lead; i < len(digits); i += 3 {
		if builder.Len() > 0 {
			builder.WriteByte('.')
		}
		builder.WriteString(digits[i : i+3])
	}
	return builder.String()
}

// DateLabel mengubah "2026-09-15" menjadi "15 Sep 2026"; nilai kosong menjadi "—".
func DateLabel(value string) string {
	text := strings.TrimSpace(value)
	if len(text) < 10 {
		if text == "" {
			return emDash
		}
		return text
	}
	year, err1 := strconv.Atoi(text[0:4])
	month, err2 := strconv.Atoi(text[5:7])
	day, err3 := strconv.Atoi(text[8:10])
	if err1 != nil || err2 != nil || err3 != nil || month < 1 || month > 12 || day < 1 || day > 31 {
		return text
	}
	return strconv.Itoa(day) + " " + monthLabels[month-1] + " " + strconv.Itoa(year)
}

// Today mengembalikan tanggal berjalan dalam format ISO (YYYY-MM-DD).
func Today() string { return time.Now().Format("2006-01-02") }
