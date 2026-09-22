package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"finova/internal/config"
	"finova/internal/db"
	"finova/internal/xlsx"
)

// testServer menjalankan API Go di atas database sementara.
// Penting: berkas database tes selalu berada di t.TempDir() agar data demo pengguna
// tidak pernah ikut tertulis.
type testServer struct {
	t             *testing.T
	base          string
	database      *db.DB
	accountByCode map[string]int64
	year          int
	entryDate     string
	rangeQuery    string
}

func newTestServer(t *testing.T) *testServer {
	t.Helper()
	cfg := config.Config{
		Port:         0,
		DatabaseFile: filepath.Join(t.TempDir(), "finova-uji.sqlite"),
		ClientOrigin: "http://localhost:3000",
		CompanyName:  "PT Finova Akuntansi Indonesia",
		OperatorName: "Operator",
		CompanyID:    1,
	}
	database, err := db.Open(cfg.DatabaseFile)
	if err != nil {
		t.Fatalf("gagal membuka database uji: %v", err)
	}
	server := New(cfg, database)
	if err := server.Bootstrap(); err != nil {
		t.Fatalf("bootstrap gagal: %v", err)
	}
	httpServer := httptest.NewServer(server.Handler())
	t.Cleanup(func() {
		httpServer.Close()
		_ = database.Close()
	})

	instance := &testServer{
		t:             t,
		base:          httpServer.URL,
		database:      database,
		year:          time.Now().Year(),
		accountByCode: map[string]int64{},
	}
	instance.entryDate = fmt.Sprintf("%d-02-15", instance.year)
	instance.rangeQuery = fmt.Sprintf("from=%d-01-01&to=%d-12-31", instance.year, instance.year)

	payload := map[string]any{}
	status, body := instance.call(http.MethodGet, "/api/accounts", nil)
	if status != http.StatusOK {
		t.Fatalf("GET /api/accounts status=%d", status)
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("decode accounts: %v", err)
	}
	accounts, _ := payload["accounts"].([]any)
	if len(accounts) == 0 {
		t.Fatal("bagan akun kosong pada database uji")
	}
	for _, item := range accounts {
		row, _ := item.(map[string]any)
		instance.accountByCode[db.AsString(row["code"])] = db.AsInt(row["id"])
	}
	return instance
}

// call mengirim permintaan dan mengembalikan status plus body mentah.
func (s *testServer) call(method, path string, body any) (int, []byte) {
	s.t.Helper()
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			s.t.Fatalf("encode body: %v", err)
		}
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequest(method, s.base+path, reader)
	if err != nil {
		s.t.Fatalf("buat permintaan: %v", err)
	}
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		s.t.Fatalf("permintaan gagal: %v", err)
	}
	defer func() { _ = response.Body.Close() }()
	raw, err := io.ReadAll(response.Body)
	if err != nil {
		s.t.Fatalf("baca respons: %v", err)
	}
	return response.StatusCode, raw
}

func (s *testServer) json(method, path string, body any) (int, map[string]any) {
	s.t.Helper()
	status, raw := s.call(method, path, body)
	payload := map[string]any{}
	if len(bytes.TrimSpace(raw)) > 0 {
		if err := json.Unmarshal(raw, &payload); err != nil {
			s.t.Fatalf("respons %s %s bukan JSON: %v -> %s", method, path, err, raw)
		}
	}
	return status, payload
}

// journal membangun body jurnal dua baris Kas <-> Pendapatan.
func (s *testServer) journal(voucherNo string, debit, credit float64, extra map[string]any) map[string]any {
	body := map[string]any{
		"voucherNo":   voucherNo,
		"entryDate":   s.entryDate,
		"description": "Uji " + voucherNo,
		"lines": []any{
			map[string]any{"account_id": s.accountByCode["1100"], "debit": debit, "credit": 0, "memo": "Kas diterima"},
			map[string]any{"account_id": s.accountByCode["4100"], "debit": 0, "credit": credit, "memo": "Pendapatan jasa"},
		},
	}
	for key, value := range extra {
		body[key] = value
	}
	return body
}

func entryField(payload map[string]any, keys ...string) map[string]any {
	current := payload
	for i, key := range keys {
		value, ok := current[key]
		if !ok {
			return nil
		}
		if i == len(keys)-1 {
			row, _ := value.(map[string]any)
			return row
		}
		current, ok = value.(map[string]any)
		if !ok {
			return nil
		}
	}
	return nil
}

func TestHealthTanpaKredensial(t *testing.T) {
	server := newTestServer(t)
	status, payload := server.json(http.MethodGet, "/api/health", nil)
	if status != http.StatusOK || payload["ok"] != true {
		t.Fatalf("health buruk: %d %+v", status, payload)
	}
}

func TestEndpointLoginSudahDihapus(t *testing.T) {
	server := newTestServer(t)
	for _, probe := range []struct{ method, path string }{
		{http.MethodPost, "/api/auth/login"},
		{http.MethodGet, "/api/auth/me"},
		{http.MethodPost, "/api/auth/logout"},
	} {
		if status, _ := server.json(probe.method, probe.path, map[string]any{}); status != http.StatusNotFound {
			t.Fatalf("%s %s harus 404, dapat %d", probe.method, probe.path, status)
		}
	}
}

func TestKoreksiJurnalDanJejakAudit(t *testing.T) {
	server := newTestServer(t)

	status, payload := server.json(http.MethodPost, "/api/journals", server.journal("TST-TIDAKSEIMBANG", 100000, 90000, map[string]any{"status": "POSTED"}))
	if status != http.StatusUnprocessableEntity {
		t.Fatalf("jurnal tidak seimbang harus 422, dapat %d %+v", status, payload)
	}
	if !strings.Contains(db.AsString(payload["message"]), "tidak seimbang") {
		t.Fatalf("pesan harus menyebut ketidakseimbangan: %+v", payload)
	}

	status, created := server.json(http.MethodPost, "/api/journals", server.journal("TST-DRAFT-001", 200000, 200000, map[string]any{"status": "DRAFT"}))
	if status != http.StatusCreated {
		t.Fatalf("buat draft harus 201, dapat %d %+v", status, created)
	}
	entryID := int64(db.AsFloat(created["id"]))

	status, _ = server.json(http.MethodPut, fmt.Sprintf("/api/journals/%d", entryID), server.journal("TST-DRAFT-001", 250000, 250000, nil))
	if status != http.StatusOK {
		t.Fatalf("ubah draft harus 200, dapat %d", status)
	}
	if status, _ = server.json(http.MethodPost, fmt.Sprintf("/api/journals/%d/post", entryID), map[string]any{}); status != http.StatusOK {
		t.Fatalf("posting harus 200, dapat %d", status)
	}

	_, fetched := server.json(http.MethodGet, fmt.Sprintf("/api/journals/%d", entryID), nil)
	entry := entryField(fetched, "entry")
	if entry == nil || db.AsString(entry["status"]) != "POSTED" {
		t.Fatalf("entri harus POSTED: %+v", fetched)
	}
	lines, _ := entry["lines"].([]any)
	firstLine, _ := lines[0].(map[string]any)
	if db.AsFloat(firstLine["debit"]) != 250000 {
		t.Fatalf("debit baris pertama harus 250000, dapat %v", firstLine["debit"])
	}
	if db.AsString(firstLine["code"]) != "1100" || db.AsString(firstLine["account_name"]) == "" {
		t.Fatalf("baris jurnal harus menyertakan kode dan nama akun: %+v", firstLine)
	}

	if status, _ = server.json(http.MethodPut, fmt.Sprintf("/api/journals/%d", entryID), server.journal("TST-DRAFT-001", 300000, 300000, nil)); status != http.StatusUnprocessableEntity {
		t.Fatalf("ubah jurnal terposting harus 422, dapat %d", status)
	}

	status, payload = server.json(http.MethodDelete, fmt.Sprintf("/api/journals/%d", entryID), nil)
	if status != http.StatusUnprocessableEntity || !strings.Contains(db.AsString(payload["message"]), "Pembalik") {
		t.Fatalf("hapus jurnal terposting harus diarahkan ke pembalik: %d %+v", status, payload)
	}

	status, reversal := server.json(http.MethodPost, fmt.Sprintf("/api/journals/%d/reverse", entryID), map[string]any{"voucherNo": "REV-TST-DRAFT-001"})
	if status != http.StatusCreated {
		t.Fatalf("pembalik harus 201, dapat %d %+v", status, reversal)
	}
	reversalID := int64(db.AsFloat(reversal["id"]))

	_, auditPayload := server.json(http.MethodGet, fmt.Sprintf("/api/journals/%d/audit", entryID), nil)
	logs, _ := auditPayload["logs"].([]any)
	seen := map[string]bool{}
	for _, item := range logs {
		log, _ := item.(map[string]any)
		seen[db.AsString(log["action"])] = true
		if db.AsString(log["user_name"]) == "" {
			t.Fatalf("jejak audit tanpa nama pengguna: %+v", log)
		}
		if db.AsString(log["action_label"]) == "" {
			t.Fatalf("jejak audit tanpa label aksi: %+v", log)
		}
	}
	for _, action := range []string{"CREATED", "UPDATED", "POSTED", "REVERSED"} {
		if !seen[action] {
			t.Fatalf("aksi %s hilang dari jejak audit: %+v", action, logs)
		}
	}

	_, original := server.json(http.MethodGet, fmt.Sprintf("/api/journals/%d", entryID), nil)
	_, reversalEntry := server.json(http.MethodGet, fmt.Sprintf("/api/journals/%d", reversalID), nil)
	entryReversal := entryField(reversalEntry, "entry")
	if db.AsString(entryReversal["source"]) != "REVERSAL" {
		t.Fatalf("sumber pembalik harus REVERSAL, dapat %v", entryReversal["source"])
	}
	if db.AsInt(entryReversal["reversal_of_id"]) != entryID {
		t.Fatalf("reversal_of_id harus %d, dapat %v", entryID, entryReversal["reversal_of_id"])
	}
	originalLines, _ := entryField(original, "entry")["lines"].([]any)
	reversalLines, _ := entryReversal["lines"].([]any)
	if len(originalLines) != len(reversalLines) {
		t.Fatalf("jumlah baris pembalik berbeda: %d vs %d", len(originalLines), len(reversalLines))
	}
	for i := range originalLines {
		originalLine, _ := originalLines[i].(map[string]any)
		reversalLine, _ := reversalLines[i].(map[string]any)
		if db.AsFloat(reversalLine["debit"]) != db.AsFloat(originalLine["credit"]) ||
			db.AsFloat(reversalLine["credit"]) != db.AsFloat(originalLine["debit"]) {
			t.Fatalf("baris %d tidak bertukar sisi: %+v vs %+v", i, originalLine, reversalLine)
		}
	}

	status, payload = server.json(http.MethodPost, fmt.Sprintf("/api/journals/%d/reverse", entryID), map[string]any{"voucherNo": "REV-KEDUA-001"})
	if status != http.StatusUnprocessableEntity || !strings.Contains(db.AsString(payload["message"]), "pembalik") {
		t.Fatalf("pembalik ganda harus ditolak: %d %+v", status, payload)
	}
}

func TestRegisterMenampilkanDraftTanpaMasukRekap(t *testing.T) {
	server := newTestServer(t)

	_, before := server.json(http.MethodGet, "/api/reports/journal?"+server.rangeQuery, nil)
	beforeRecap := entryField(before, "data", "recap")
	recapBefore := db.AsFloat(beforeRecap["totalDebit"])

	if status, _ := server.json(http.MethodPost, "/api/journals", server.journal("TST-DRAFT-002", 900000, 900000, map[string]any{"status": "DRAFT"})); status != http.StatusCreated {
		t.Fatalf("buat draft harus 201, dapat %d", status)
	}
	_, after := server.json(http.MethodGet, "/api/reports/journal?"+server.rangeQuery, nil)
	entries, _ := entryField(after, "data")["entries"].([]any)
	found := false
	for _, item := range entries {
		row, _ := item.(map[string]any)
		if db.AsString(row["voucher_no"]) != "TST-DRAFT-002" {
			continue
		}
		found = true
		if db.AsString(row["status"]) != "DRAFT" {
			t.Fatalf("draft harus tampil berstatus DRAFT: %+v", row)
		}
	}
	if !found {
		t.Fatal("draft tidak muncul di register jurnal")
	}
	afterRecap := db.AsFloat(entryField(after, "data", "recap")["totalDebit"])
	if afterRecap != recapBefore {
		t.Fatalf("rekapitulasi tidak boleh berubah karena draft: %v -> %v", recapBefore, afterRecap)
	}

	_, trialBefore := server.json(http.MethodGet, "/api/reports/trial-balance?"+server.rangeQuery, nil)
	totalBefore := db.AsFloat(entryField(trialBefore, "data", "totals")["debit"])
	status, draft := server.json(http.MethodPost, "/api/journals", server.journal("TST-DRAFT-003", 5000000, 5000000, map[string]any{"status": "DRAFT"}))
	if status != http.StatusCreated {
		t.Fatalf("buat draft 003 harus 201, dapat %d", status)
	}
	_, trialAfter := server.json(http.MethodGet, "/api/reports/trial-balance?"+server.rangeQuery, nil)
	if db.AsFloat(entryField(trialAfter, "data", "totals")["debit"]) != totalBefore {
		t.Fatal("neraca saldo tidak boleh terpengaruh draft")
	}
	draftID := int64(db.AsFloat(draft["id"]))
	if status, _ = server.json(http.MethodDelete, fmt.Sprintf("/api/journals/%d", draftID), nil); status != http.StatusOK {
		t.Fatalf("hapus draft harus 200, dapat %d", status)
	}
	if status, _ = server.json(http.MethodGet, fmt.Sprintf("/api/journals/%d", draftID), nil); status != http.StatusNotFound {
		t.Fatalf("draft terhapus harus 404, dapat %d", status)
	}
}

func TestNomorBuktiOtomatisDanValidasiPeriode(t *testing.T) {
	server := newTestServer(t)
	_, payload := server.json(http.MethodGet, "/api/journals/next-voucher", nil)
	monthVoucher := db.AsString(payload["voucherNo"])
	if !strings.HasPrefix(monthVoucher, "JRN-"+time.Now().UTC().Format("200601")+"-") {
		t.Fatalf("format nomor bukti salah: %q", monthVoucher)
	}

	// Nomor bukti otomatis mengikuti bulan tanggal jurnal, bukan tanggal hari ini.
	body := server.journal("", 100000, 100000, map[string]any{"status": "DRAFT"})
	delete(body, "voucherNo")
	status, created := server.json(http.MethodPost, "/api/journals", body)
	if status != http.StatusCreated {
		t.Fatalf("jurnal tanpa nomor bukti harus dibuat otomatis, dapat %d %+v", status, created)
	}
	entryMonth := strings.ReplaceAll(server.entryDate[:7], "-", "")
	wantVoucher := "JRN-" + entryMonth + "-001"
	if db.AsString(created["voucherNo"]) != wantVoucher {
		t.Fatalf("nomor bukti otomatis harus %q, dapat %v", wantVoucher, created["voucherNo"])
	}
	// Setelah satu nomor terpakai, permintaan berikutnya maju satu urut.
	_, next := server.json(http.MethodGet, "/api/journals/next-voucher", nil)
	_ = next
	body2 := server.journal("", 200000, 200000, map[string]any{"status": "DRAFT"})
	delete(body2, "voucherNo")
	if status, second := server.json(http.MethodPost, "/api/journals", body2); status != http.StatusCreated ||
		db.AsString(second["voucherNo"]) != "JRN-"+entryMonth+"-002" {
		t.Fatalf("nomor bukti kedua harus berurutan, status=%d payload=%+v", status, second)
	}

	outsideYear := fmt.Sprintf("%d-01-01", server.year+5)
	status, payload = server.json(http.MethodPost, "/api/journals",
		server.journal("TST-PERIODI", 1000, 1000, map[string]any{"status": "POSTED", "entryDate": outsideYear}))
	if status != http.StatusUnprocessableEntity || !strings.Contains(db.AsString(payload["message"]), "periode") {
		t.Fatalf("tanggal tanpa periode harus ditolak: %d %+v", status, payload)
	}
}

func TestPenutupanPeriodeMengunciDanMembuatJurnalPenutup(t *testing.T) {
	server := newTestServer(t)
	periodID := server.periodForDate(server.entryDate)

	if status, _ := server.json(http.MethodPost, "/api/journals",
		server.journal("TST-PE-NOMINAL", 1500000, 1500000, map[string]any{"status": "POSTED"})); status != http.StatusCreated {
		t.Fatalf("jurnal pendapatan harus 201, dapat %d", status)
	}

	status, closed := server.json(http.MethodPost, fmt.Sprintf("/api/periods/%d/close", periodID), map[string]any{})
	if status != http.StatusOK || closed["ok"] != true {
		t.Fatalf("tutup periode harus 200, dapat %d %+v", status, closed)
	}
	if db.AsFloat(closed["netIncome"]) != 1500000 {
		t.Fatalf("netIncome harus 1500000, dapat %v", closed["netIncome"])
	}
	if db.AsInt(closed["entryId"]) == 0 {
		t.Fatalf("penutupan harus menghasilkan jurnal penutup: %+v", closed)
	}

	_, register := server.json(http.MethodGet, "/api/reports/journal?"+server.rangeQuery, nil)
	entries, _ := entryField(register, "data")["entries"].([]any)
	closingFound := false
	for _, item := range entries {
		row, _ := item.(map[string]any)
		if db.AsString(row["source"]) == "CLOSING" {
			closingFound = true
			if db.AsString(row["status"]) != "POSTED" {
				t.Fatalf("jurnal penutup harus terposting: %+v", row)
			}
		}
	}
	if !closingFound {
		t.Fatal("jurnal penutup tidak muncul pada register")
	}

	if status, _ = server.json(http.MethodPost, "/api/journals",
		server.journal("TST-SESUDAH-TUTUP", 1000, 1000, map[string]any{"status": "POSTED"})); status != http.StatusUnprocessableEntity {
		t.Fatalf("jurnal pada periode tertutup harus ditolak, dapat %d", status)
	}
	if status, _ = server.json(http.MethodPost, fmt.Sprintf("/api/periods/%d/close", periodID), map[string]any{}); status != http.StatusUnprocessableEntity {
		t.Fatalf("penutupan ganda harus ditolak, dapat %d", status)
	}
}

// periodForDate mencari id periode yang memuat tanggal.
func (s *testServer) periodForDate(date string) int64 {
	s.t.Helper()
	rows, err := s.database.Select(
		"SELECT id FROM accounting_periods WHERE company_id = 1 AND ? BETWEEN start_date AND end_date LIMIT 1", date)
	if err != nil || len(rows) == 0 {
		s.t.Fatalf("periode untuk %s tidak ada: %v", date, err)
	}
	return db.AsInt(rows[0]["id"])
}

func TestImporExcelTemplatLaluConfirm(t *testing.T) {
	server := newTestServer(t)

	status, raw := server.call(http.MethodGet, "/api/imports/template", nil)
	if status != http.StatusOK {
		t.Fatalf("unduh templat harus 200, dapat %d: %s", status, raw)
	}
	if !bytes.HasPrefix(raw, []byte("PK")) {
		t.Fatal("templat harus berupa berkas .xlsx (arsip ZIP)")
	}

	entries, err := xlsx.ReadJournalSheet(raw)
	if err != nil {
		t.Fatalf("templat tidak terbaca parser: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("templat harus berisi 2 baris contoh, dapat %d", len(entries))
	}
	if entries[0].Get("Tanggal") != "2026-01-01" || entries[0].Get("KodeAkun") != "1100" {
		t.Fatalf("isi templat salah: %+v", entries[0].Cells)
	}

	batchID, payload := server.uploadWorkbook("template-jurnal-finova.xlsx", raw)
	if payload["valid"] != true {
		t.Fatalf("templat harus lolos validasi: %+v", payload)
	}
	if db.AsFloat(payload["totalRows"]) != 2 {
		t.Fatalf("totalRows harus 2, dapat %v", payload["totalRows"])
	}
	summaries, _ := payload["entries"].([]any)
	if len(summaries) != 1 {
		t.Fatalf("templat harus menghasilkan 1 jurnal, dapat %d", len(summaries))
	}

	status, confirmed := server.json(http.MethodPost, fmt.Sprintf("/api/imports/%d/confirm", batchID), map[string]any{})
	if status != http.StatusOK {
		t.Fatalf("confirm harus 200, dapat %d %+v", status, confirmed)
	}
	if db.AsFloat(confirmed["posted"]) != 1 {
		t.Fatalf("posted harus 1, dapat %v", confirmed["posted"])
	}
}

// uploadWorkbookStatus mengirim berkas dan mengembalikan status mentah.
func (s *testServer) uploadWorkbookStatus(filename string, data []byte) (int, []byte) {
	s.t.Helper()
	buffer := &bytes.Buffer{}
	writer := multipart.NewWriter(buffer)
	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		s.t.Fatalf("buat formulir: %v", err)
	}
	if _, err := part.Write(data); err != nil {
		s.t.Fatalf("tulis berkas: %v", err)
	}
	if err := writer.Close(); err != nil {
		s.t.Fatalf("tutup formulir: %v", err)
	}
	response, err := http.Post(s.base+"/api/imports/preview", writer.FormDataContentType(), buffer)
	if err != nil {
		s.t.Fatalf("unggah gagal: %v", err)
	}
	defer func() { _ = response.Body.Close() }()
	raw, err := io.ReadAll(response.Body)
	if err != nil {
		s.t.Fatalf("baca respons: %v", err)
	}
	return response.StatusCode, raw
}

// uploadWorkbook mengirim berkas Excel ke endpoint preview dan menuntut status 200.
func (s *testServer) uploadWorkbook(filename string, data []byte) (int64, map[string]any) {
	s.t.Helper()
	status, raw := s.uploadWorkbookStatus(filename, data)
	if status != http.StatusOK {
		s.t.Fatalf("preview impor harus 200, dapat %d: %s", status, raw)
	}
	payload := map[string]any{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		s.t.Fatalf("respons preview bukan JSON: %v -> %s", err, raw)
	}
	return db.AsInt(payload["batchId"]), payload
}

func TestImporMenolakBerkasDanNomorBuktiDuplikat(t *testing.T) {
	server := newTestServer(t)
	workbook := server.buildWorkbook([][]string{
		{"2026-01-05", "DUP-001", "Kas masuk", "1100", "500000", ""},
		{"2026-01-05", "DUP-001", "Kas masuk", "4100", "", "500000"},
	})
	batchID, payload := server.uploadWorkbook("duplikat.xlsx", workbook)
	if payload["valid"] != true {
		t.Fatalf("berkas harus lolos validasi: %+v", payload)
	}
	if status, _ := server.json(http.MethodPost, fmt.Sprintf("/api/imports/%d/confirm", batchID), map[string]any{}); status != http.StatusOK {
		t.Fatalf("confirm batch harus 200, dapat %d", status)
	}

	// Berkas yang sama diunggah ulang: content_hash unik per perusahaan -> 409.
	if status, raw := server.uploadWorkbookStatus("duplikat.xlsx", workbook); status != http.StatusConflict {
		t.Fatalf("berkas duplikat harus 409, dapat %d: %s", status, raw)
	}

	// Nomor bukti yang sudah terpakai tidak boleh dibuat ulang secara manual.
	if status, _ := server.json(http.MethodPost, "/api/journals",
		server.journal("DUP-001", 500000, 500000, map[string]any{"status": "DRAFT"})); status != http.StatusConflict {
		t.Fatalf("nomor bukti duplikat harus 409, dapat %d", status)
	}
}

func TestImporMelaporkanBarisTidakSeimbang(t *testing.T) {
	server := newTestServer(t)
	workbook := server.buildWorkbook([][]string{
		{"2026-01-06", "TIDAKSEIMBANG-001", "Kas masuk", "1100", "500000", ""},
		{"2026-01-06", "TIDAKSEIMBANG-001", "Kas masuk", "4100", "", "400000"},
		{"2026-01-06", "KODESALAH-001", "Akun tak dikenal", "9999", "1000", ""},
	})
	_, payload := server.uploadWorkbook("rusak.xlsx", workbook)
	if payload["valid"] == true {
		t.Fatalf("berkas rusak harus valid=false: %+v", payload)
	}
	encoded, _ := json.Marshal(payload["errors"])
	message := string(encoded)
	for _, want := range []string{"TIDAKSEIMBANG-001", "9999"} {
		if !strings.Contains(message, want) {
			t.Fatalf("pesan kesalahan harus menyebut %q: %s", want, message)
		}
	}

	// Batch berstatus REJECTED tidak boleh dikonfirmasi.
	if status, _ := server.json(http.MethodPost,
		fmt.Sprintf("/api/imports/%d/confirm", db.AsInt(payload["batchId"])), map[string]any{}); status != http.StatusUnprocessableEntity {
		t.Fatalf("batch REJECTED harus ditolak 422, dapat %d", status)
	}
}

// buildWorkbook menyusun berkas xlsx dari baris teks untuk keperluan tes.
func (s *testServer) buildWorkbook(rows [][]string) []byte {
	s.t.Helper()
	workbook, err := xlsx.WorkbookFromRows([]string{"Tanggal", "NoBukti", "Keterangan", "KodeAkun", "Debit", "Kredit"}, rows)
	if err != nil {
		s.t.Fatalf("susun workbook uji: %v", err)
	}
	return workbook
}
