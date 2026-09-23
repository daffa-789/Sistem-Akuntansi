package httpapi

import (
	"bytes"
	"net/http"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"

	"finova/internal/db"
)

// downloadFile mengambil berkas dari endpoint ekspor dan mengembalikan header + isinya.
func (s *testServer) downloadFile(path string) (http.Header, []byte) {
	s.t.Helper()
	response, err := http.Get(s.base + path)
	if err != nil {
		s.t.Fatalf("GET %s gagal: %v", path, err)
	}
	defer func() { _ = response.Body.Close() }()
	buffer := &bytes.Buffer{}
	if _, err := buffer.ReadFrom(response.Body); err != nil {
		s.t.Fatalf("baca body %s: %v", path, err)
	}
	if response.StatusCode != http.StatusOK {
		s.t.Fatalf("GET %s status=%d body=%s", path, response.StatusCode, buffer.String())
	}
	return response.Header, buffer.Bytes()
}

func seedJournalForExport(t *testing.T, server *testServer) {
	t.Helper()
	posted := server.journal("EXP-001", 1500000, 1500000, map[string]any{"status": "POSTED", "entryDate": server.entryDate})
	if status, payload := server.json(http.MethodPost, "/api/journals", posted); status != http.StatusCreated {
		t.Fatalf("jurnal ekspor harus 201, dapat %d %+v", status, payload)
	}
	draft := server.journal("EXP-002", 400000, 400000, map[string]any{"status": "DRAFT", "entryDate": server.entryDate})
	if status, payload := server.json(http.MethodPost, "/api/journals", draft); status != http.StatusCreated {
		t.Fatalf("draft ekspor harus 201, dapat %d %+v", status, payload)
	}
}

func TestExportJournalXLSX(t *testing.T) {
	server := newTestServer(t)
	seedJournalForExport(t, server)

	header, body := server.downloadFile("/api/exports/journal.xlsx?from=" + server.entryDate[:8] + "01&to=" + server.entryDate)
	if !strings.HasPrefix(string(body), "PK") {
		t.Fatal("hasil unduhan bukan berkas .xlsx")
	}
	if !strings.Contains(header.Get("Content-Type"), "spreadsheetml") {
		t.Fatalf("Content-Type salah: %q", header.Get("Content-Type"))
	}
	disposition := header.Get("Content-Disposition")
	if !strings.Contains(disposition, "Finova_Jurnal_Umum_") || !strings.Contains(disposition, ".xlsx") {
		t.Fatalf("Content-Disposition salah: %q", disposition)
	}

	file, err := excelize.OpenReader(bytes.NewReader(body))
	if err != nil {
		t.Fatalf("xlsx tidak terbaca: %v", err)
	}
	defer func() { _ = file.Close() }()
	sheets := file.GetSheetList()
	if len(sheets) != 2 {
		t.Fatalf("harus dua sheet (jurnal + rekapitulasi), dapat %#v", sheets)
	}
	joined := strings.Join(mustRows(t, file, "Jurnal Umum"), "|")
	for _, want := range []string{"EXP-001", "EXP-002", "Kas", "JUMLAH TOTAL JURNAL", "Dibuat Oleh,"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("isi xlsx harus memuat %q, dapat: %s", want, joined)
		}
	}
	if !strings.Contains(joined, "Pembalik") && !strings.Contains(joined, "Uji EXP-002") {
		t.Fatal("keterangan entri tidak tertulis pada lembar jurnal")
	}
}

func TestExportJournalPDF(t *testing.T) {
	server := newTestServer(t)
	seedJournalForExport(t, server)

	header, body := server.downloadFile("/api/exports/journal.pdf?from=" + server.entryDate[:8] + "01&to=" + server.entryDate)
	if !bytes.HasPrefix(body, []byte("%PDF-1.")) {
		t.Fatalf("bukan berkas PDF: %q", body[:min(len(body), 12)])
	}
	if !bytes.Contains(body, []byte("%%EOF")) {
		t.Fatal("PDF tidak lengkap")
	}
	if !strings.Contains(header.Get("Content-Type"), "application/pdf") {
		t.Fatalf("Content-Type salah: %q", header.Get("Content-Type"))
	}
	if !strings.Contains(header.Get("Content-Disposition"), ".pdf") {
		t.Fatalf("nama berkas salah: %q", header.Get("Content-Disposition"))
	}
}

func TestExportMengikutiFilterRegister(t *testing.T) {
	server := newTestServer(t)
	seedJournalForExport(t, server)

	_, onlyPosted := server.downloadFile("/api/exports/journal.xlsx?status=POSTED&from=" + server.entryDate[:8] + "01&to=" + server.entryDate)
	file, err := excelize.OpenReader(bytes.NewReader(onlyPosted))
	if err != nil {
		t.Fatalf("xlsx berfilter tidak terbaca: %v", err)
	}
	defer func() { _ = file.Close() }()
	joined := strings.Join(mustRows(t, file, "Jurnal Umum"), "|")
	if strings.Contains(joined, "EXP-002") {
		t.Fatal("filter status=POSTED masih memuat draft")
	}
	if !strings.Contains(joined, "EXP-001") {
		t.Fatal("filter status=POSTED harus memuat jurnal terposting")
	}

	_, searched := server.downloadFile("/api/exports/journal.xlsx?q=EXP-002&from=" + server.entryDate[:8] + "01&to=" + server.entryDate)
	file2, err := excelize.OpenReader(bytes.NewReader(searched))
	if err != nil {
		t.Fatalf("xlsx hasil pencarian tidak terbaca: %v", err)
	}
	defer func() { _ = file2.Close() }()
	joined2 := strings.Join(mustRows(t, file2, "Jurnal Umum"), "|")
	if strings.Contains(joined2, "EXP-001") || !strings.Contains(joined2, "EXP-002") {
		t.Fatalf("pencarian q tidak menyaring dengan benar: %s", joined2)
	}
}

func TestExportLaporanLain(t *testing.T) {
	server := newTestServer(t)
	seedJournalForExport(t, server)
	kasID := server.accountByCode["1100"]

	for _, probe := range []struct{ path, want string }{
		{"/api/exports/ledger.xlsx?accountId=" + db.AsString(kasID) + "&from=" + server.entryDate[:8] + "01&to=" + server.entryDate, "1100"},
		{"/api/exports/trial-balance.xlsx?from=" + server.entryDate[:8] + "01&to=" + server.entryDate, "1100"},
		{"/api/exports/accounts.xlsx", "Kas di Bank"},
	} {
		_, body := server.downloadFile(probe.path)
		if !bytes.HasPrefix(body, []byte("PK")) {
			t.Fatalf("%s bukan berkas xlsx", probe.path)
		}
		file, err := excelize.OpenReader(bytes.NewReader(body))
		if err != nil {
			t.Fatalf("%s tidak terbaca: %v", probe.path, err)
		}
		sheets := file.GetSheetList()
		if len(sheets) == 0 {
			t.Fatalf("%s tidak punya sheet", probe.path)
		}
		joined := strings.Join(mustRows(t, file, sheets[0]), "|")
		if !strings.Contains(joined, probe.want) {
			t.Fatalf("%s harus memuat %q, dapat: %s", probe.path, probe.want, joined)
		}
		_ = file.Close()
	}
}

func TestExportTanpaAkunMenolak422(t *testing.T) {
	server := newTestServer(t)
	response, err := http.Get(server.base + "/api/exports/ledger.xlsx")
	if err != nil {
		t.Fatalf("permintaan gagal: %v", err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("buku besar tanpa accountId harus 422, dapat %d", response.StatusCode)
	}
}

// mustRows membaca seluruh baris satu sheet menjadi teks untuk pemeriksaan.
func mustRows(t *testing.T, file *excelize.File, sheet string) []string {
	t.Helper()
	rows, err := file.GetRows(sheet)
	if err != nil {
		t.Fatalf("baca sheet %s: %v", sheet, err)
	}
	flat := []string{}
	for _, row := range rows {
		flat = append(flat, row...)
	}
	return flat
}
