package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"finova/internal/db"
	"finova/internal/domain"
	"finova/internal/xlsx"
)

// importEntry satu jurnal hasil baca berkas Excel (bentuk payload tersimpan).
type importEntry struct {
	VoucherNo   string       `json:"voucherNo"`
	EntryDate   string       `json:"entryDate"`
	Description string       `json:"description"`
	LinePayload []importLine `json:"lines"`
}

// importLine baris jurnal pada payload impor (sama seperti bentuk Node lama).
type importLine struct {
	AccountID int64   `json:"account_id"`
	Debit     float64 `json:"debit"`
	Credit    float64 `json:"credit"`
}

// importError pesan validasi per baris berkas.
type importError struct {
	Line    any    `json:"line"`
	Message string `json:"message"`
}

// importTemplate GET /api/imports/template — unduh templat .xlsx.
func (s *Server) importTemplate(w http.ResponseWriter, _ *http.Request) error {
	book, err := xlsx.JournalTemplate()
	if err != nil {
		return err
	}
	w.Header().Set("Content-Disposition", "attachment; filename=template-jurnal-finova.xlsx")
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Length", strconv.Itoa(len(book)))
	w.WriteHeader(http.StatusOK)
	_, err = w.Write(book)
	return err
}

// importPreview POST /api/imports/preview — validasi berkas tanpa menulis jurnal.
func (s *Server) importPreview(w http.ResponseWriter, r *http.Request) error {
	file, err := readUpload(r)
	if err != nil {
		return err
	}
	hash := sha256.Sum256(file.Data)
	parsed, err := s.parseImport(file.Data, s.database)
	if err != nil {
		return err
	}
	status := "PREVIEW"
	if len(parsed.Errors) > 0 {
		status = "REJECTED"
	}
	payload, err := encodeJSON(parsed.Entries)
	if err != nil {
		return err
	}
	errorPayload, err := encodeJSON(parsed.Errors)
	if err != nil {
		return err
	}
	created, err := s.database.Exec(
		`INSERT INTO import_batches (company_id, uploaded_by, original_filename, content_hash, status, total_rows, valid_entries, payload_json, errors_json)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		s.companyID(), s.operatorID, file.Filename, hex.EncodeToString(hash[:]), status,
		parsed.TotalRows, len(parsed.Entries), payload, errorPayload)
	if err != nil {
		return err
	}
	action := "PREVIEWED"
	if status != "PREVIEW" {
		action = "REJECTED"
	}
	if err := s.audit(s.database, created.InsertID, "IMPORT_BATCH", action,
		map[string]any{"totalRows": parsed.TotalRows, "errors": len(parsed.Errors)}); err != nil {
		return err
	}
	summaries := make([]map[string]any, 0, len(parsed.Entries))
	for _, entry := range parsed.Entries {
		summaries = append(summaries, map[string]any{
			"voucherNo":   entry.VoucherNo,
			"entryDate":   entry.EntryDate,
			"description": entry.Description,
			"lineCount":   len(entry.LinePayload),
		})
	}
	return writeJSON(w, http.StatusOK, map[string]any{
		"batchId":   created.InsertID,
		"valid":     len(parsed.Errors) == 0,
		"totalRows": parsed.TotalRows,
		"entries":   summaries,
		"errors":    parsed.Errors,
	})
}

// importConfirm POST /api/imports/{id}/confirm —Posting seluruh jurnal pada batch PREVIEW.
func (s *Server) importConfirm(w http.ResponseWriter, r *http.Request) error {
	batchID := paramInt(r, "id")
	var posted int
	err := s.database.WithTransaction(func(tx *db.Tx) error {
		batch, err := tx.SelectOne("SELECT * FROM import_batches WHERE id = ? AND company_id = ?", batchID, s.companyID())
		if err != nil {
			return err
		}
		if batch == nil {
			return fail(http.StatusNotFound, "Batch impor tidak ditemukan.")
		}
		if db.AsString(batch["status"]) != "PREVIEW" {
			return fail(http.StatusUnprocessableEntity, "Batch ini tidak siap dikonfirmasi.")
		}
		entries := []importEntry{}
		if err := decodeJSONField(batch["payload_json"], &entries); err != nil {
			return fail(http.StatusUnprocessableEntity, "Isi batch impor tidak dapat dibaca.")
		}
		for _, entry := range entries {
			lines := make([]domain.AmountedLine, 0, len(entry.LinePayload))
			for _, line := range entry.LinePayload {
				lines = append(lines, domain.AmountedLine{AccountID: line.AccountID, Debit: line.Debit, Credit: line.Credit})
			}
			if _, err := s.writeEntry(tx, writeEntryParams{
				userID:        s.operatorID,
				voucherNo:     entry.VoucherNo,
				entryDate:     entry.EntryDate,
				description:   entry.Description,
				source:        "IMPORT",
				status:        "POSTED",
				lines:         lines,
				importBatchID: db.AsInt(batch["id"]),
			}); err != nil {
				return err
			}
		}
		if _, err := tx.Exec("UPDATE import_batches SET status = 'POSTED', posted_at = datetime('now', 'localtime') WHERE id = ?",
			db.AsInt(batch["id"])); err != nil {
			return err
		}
		if err := s.audit(tx, db.AsInt(batch["id"]), "IMPORT_BATCH", "POSTED", map[string]any{"entries": len(entries)}); err != nil {
			return err
		}
		posted = len(entries)
		return nil
	})
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]any{"ok": true, "posted": posted})
}

// parsedImport hasil pembacaan berkas Excel.
type parsedImport struct {
	TotalRows int
	Entries   []importEntry
	Errors    []importError
}

// parseImport memetakan baris spreadsheet menjadi calon jurnal lalu memvalidasinya.
func (s *Server) parseImport(data []byte, exec db.Execer) (parsedImport, error) {
	rows, err := xlsx.ReadJournalSheet(data)
	if err != nil {
		return parsedImport{}, fail(http.StatusUnprocessableEntity, err.Error())
	}
	accountRows, err := exec.Select("SELECT id, code, name, is_active FROM accounts WHERE company_id = ?", s.companyID())
	if err != nil {
		return parsedImport{}, err
	}
	accountByCode := map[string]db.Row{}
	for _, row := range accountRows {
		accountByCode[db.AsString(row["code"])] = row
	}

	type groupedEntry struct {
		entry   *importEntry
		rowLine []int
	}
	order := []string{}
	grouped := map[string]*groupedEntry{}
	errorsList := []importError{}

	for index, row := range rows {
		lineNumber := index + 2
		voucher := row.Get("NoBukti", "No Bukti")
		entryDate := periodDateFromExcel(row.Get("Tanggal"))
		code := row.Get("KodeAkun", "Kode Akun")
		debit, debitOK := xlsx.CleanAmount(row.Get("Debit"))
		credit, creditOK := xlsx.CleanAmount(row.Get("Kredit"))
		debitValue := domain.Amount(debit)
		creditValue := domain.Amount(credit)

		if voucher == "" {
			errorsList = append(errorsList, importError{Line: lineNumber, Message: "NoBukti wajib diisi."})
		}
		if entryDate == "" {
			errorsList = append(errorsList, importError{Line: lineNumber, Message: "Tanggal harus memakai format YYYY-MM-DD atau DD/MM/YYYY."})
		}
		account, accountFound := accountByCode[code]
		if code == "" || !accountFound || !db.AsBoolSQLite(account["is_active"]) {
			errorsList = append(errorsList, importError{Line: lineNumber, Message: fmt.Sprintf(
				"Kode akun %s tidak aktif atau tidak ditemukan.", orEmpty(code, "(kosong)"))})
		}
		if !debitOK || !creditOK || (debitValue > 0 && creditValue > 0) || (debitValue == 0 && creditValue == 0) || debitValue < 0 || creditValue < 0 {
			errorsList = append(errorsList, importError{Line: lineNumber, Message: "Isi tepat salah satu nominal Debit atau Kredit."})
		}
		if voucher == "" || entryDate == "" || !accountFound ||
			(debitValue > 0 && creditValue > 0) || (debitValue == 0 && creditValue == 0) {
			continue
		}
		existing, exists := grouped[voucher]
		if !exists {
			grouped[voucher] = &groupedEntry{
				entry: &importEntry{
					VoucherNo:   voucher,
					EntryDate:   entryDate,
					Description: orEmpty(strings.TrimSpace(row.Get("Keterangan")), fmt.Sprintf("Impor %s", voucher)),
					LinePayload: []importLine{{AccountID: db.AsInt(account["id"]), Debit: debitValue, Credit: creditValue}},
				},
				rowLine: []int{lineNumber},
			}
			order = append(order, voucher)
			continue
		}
		if existing.entry.EntryDate != entryDate {
			errorsList = append(errorsList, importError{Line: lineNumber, Message: fmt.Sprintf("NoBukti %s memiliki tanggal yang berbeda.", voucher)})
		}
		existing.entry.LinePayload = append(existing.entry.LinePayload, importLine{
			AccountID: db.AsInt(account["id"]), Debit: debitValue, Credit: creditValue,
		})
		existing.rowLine = append(existing.rowLine, lineNumber)
	}

	entries := []importEntry{}
	for _, voucher := range order {
		group := grouped[voucher]
		lines := make([]domain.AmountedLine, 0, len(group.entry.LinePayload))
		for _, line := range group.entry.LinePayload {
			lines = append(lines, domain.AmountedLine{AccountID: line.AccountID, Debit: line.Debit, Credit: line.Credit})
		}
		if _, err := domain.AssertBalanced(lines); err != nil {
			errorsList = append(errorsList, importError{Line: joinInts(group.rowLine), Message: fmt.Sprintf("%s: %s", voucher, err.Error())})
		}
		if _, err := s.getOpenPeriod(exec, group.entry.EntryDate); err != nil {
			errorsList = append(errorsList, importError{Line: joinInts(group.rowLine), Message: fmt.Sprintf("%s: %s", voucher, err.Error())})
		}
		entries = append(entries, *group.entry)
	}

	if len(order) > 0 {
		placeholders := strings.TrimSuffix(strings.Repeat("?,", len(order)), ",")
		args := make([]any, 0, len(order)+1)
		args = append(args, s.companyID())
		for _, voucher := range order {
			args = append(args, voucher)
		}
		duplicates, err := exec.Select(
			fmt.Sprintf("SELECT voucher_no FROM journal_entries WHERE company_id = ? AND voucher_no IN (%s)", placeholders), args...)
		if err != nil {
			return parsedImport{}, err
		}
		for _, duplicate := range duplicates {
			errorsList = append(errorsList, importError{Line: "", Message: fmt.Sprintf("NoBukti %s sudah pernah digunakan.", db.AsString(duplicate["voucher_no"]))})
		}
	}

	if errorsList == nil {
		errorsList = []importError{}
	}
	return parsedImport{TotalRows: len(rows), Entries: entries, Errors: errorsList}, nil
}

var (
	isoDatePattern = regexp.MustCompile(`^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$`)
	idDatePattern  = regexp.MustCompile(`^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$`)
)

// periodDateFromExcel menafsirkan sel tanggal menjadi YYYY-MM-DD: angka serial Excel,
// format ISO, atau format Indonesia DD/MM/YYYY.
func periodDateFromExcel(value string) string {
	text := strings.TrimSpace(value)
	if text == "" {
		return ""
	}
	if serial, err := strconv.ParseFloat(text, 64); err == nil {
		base := time.Date(1899, 12, 30, 0, 0, 0, 0, time.UTC)
		return base.Add(time.Duration(serial * float64(time.Hour) * 24)).Format("2006-01-02")
	}
	if match := isoDatePattern.FindStringSubmatch(text); match != nil {
		return fmt.Sprintf("%s-%02s-%02s", match[1], match[2], match[3])
	}
	if match := idDatePattern.FindStringSubmatch(text); match != nil {
		return fmt.Sprintf("%s-%02s-%02s", match[3], match[2], match[1])
	}
	return ""
}

func orEmpty(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func joinInts(values []int) string {
	parts := make([]string, 0, len(values))
	for _, value := range values {
		parts = append(parts, strconv.Itoa(value))
	}
	return strings.Join(parts, ", ")
}

// uploadedFile isi berkas yang diunggah pengguna.
type uploadedFile struct {
	Filename string
	Data     []byte
}

// readUpload membaca berkas dari formulir multipart dengan batas 10 MB.
func readUpload(r *http.Request) (uploadedFile, error) {
	if err := r.ParseMultipartForm(maxUploadSize); err != nil {
		return uploadedFile{}, fail(http.StatusUnprocessableEntity, "Pilih berkas Excel terlebih dahulu.")
	}
	defer func() {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
	}()
	part, header, err := r.FormFile("file")
	if err != nil {
		return uploadedFile{}, fail(http.StatusUnprocessableEntity, "Pilih berkas Excel terlebih dahulu.")
	}
	defer func() { _ = part.Close() }()
	if header.Size > maxUploadSize {
		return uploadedFile{}, fail(http.StatusRequestEntityTooLarge, "Ukuran berkas melebihi 10 MB.")
	}
	data, err := io.ReadAll(io.LimitReader(part, maxUploadSize+1))
	if err != nil {
		return uploadedFile{}, err
	}
	if int64(len(data)) > maxUploadSize {
		return uploadedFile{}, fail(http.StatusRequestEntityTooLarge, "Ukuran berkas melebihi 10 MB.")
	}
	return uploadedFile{Filename: header.Filename, Data: data}, nil
}
