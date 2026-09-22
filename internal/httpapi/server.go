// Package httpapi adalah server API Finova berbasis Go: menggantikan Express +
// better-sqlite3 dengan net/http standar dan driver SQLite murni Go.
// Bentuk respons (nama kolom, pesan error, kode status) dibuat identik dengan
// backend Node sebelumnya sehingga frontend React tidak perlu diubah.
package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"finova/internal/config"
	"finova/internal/db"
	"finova/internal/domain"
	"finova/internal/web"
)

// maxRequestSize membatasi body JSON sama seperti express.json({limit:'2mb'}).
const maxRequestSize = 2 * 1024 * 1024

// maxUploadSize membatasi berkas Excel sama seperti batas multer 10 MB.
const maxUploadSize = 10 * 1024 * 1024

// loginDisabledHash pengganti hash password: aplikasi berjalan tanpa login, tetapi
// kolom users.password_hash tetap NOT NULL dan baris operator tetap dibutuhkan karena
// journal_entries.created_by REFERENCES users(id).
const loginDisabledHash = "!!login-dinonaktifkan!!"

// Server memegang konfigurasi, koneksi database, dan identitas operator.
type Server struct {
	cfg        config.Config
	database   *db.DB
	operatorID int64
}

// New menyiapkan instance server tanpa membuka port.
func New(cfg config.Config, database *db.DB) *Server {
	return &Server{cfg: cfg, database: database, operatorID: 1}
}

// HTTPError adalah kesalahan dengan kode status yang akan dikirim ke frontend.
type HTTPError struct {
	Status  int
	Message string
}

func (e *HTTPError) Error() string { return e.Message }

// fail membuat HTTPError, setara helper fail() pada backend lama.
func fail(status int, message string) error { return &HTTPError{Status: status, Message: message} }

var dateOnly = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// Handler merangkai rute, CORS, pemulihan panic, dan penyimpanan statis SPA.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	s.routes(mux)
	return withCORS(s.cfg.ClientOrigin, s.withRecovery(s.withSPA(mux)))
}

// withSPA melayani aset frontend hasil build; rute /api tetap ditangani mux.
func (s *Server) withSPA(next http.Handler) http.Handler {
	assets := web.Handler(s.cfg.StaticDir)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api") {
			next.ServeHTTP(w, r)
			return
		}
		assets.ServeHTTP(w, r)
	})
}

// routes memetakan setiap endpoint. Go 1.22 memilih pola statis lebih dulu, jadi
// /api/journals/next-voucher tetap menang atas /api/journals/{id}.
func (s *Server) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/health", s.handle(s.health))

	mux.HandleFunc("GET /api/company", s.handle(s.getCompany))
	mux.HandleFunc("PUT /api/company", s.handle(s.putCompany))

	mux.HandleFunc("GET /api/accounts", s.handle(s.getAccounts))
	mux.HandleFunc("POST /api/accounts", s.handle(s.postAccount))
	mux.HandleFunc("PUT /api/accounts/{id}", s.handle(s.putAccount))

	mux.HandleFunc("GET /api/periods", s.handle(s.getPeriods))
	mux.HandleFunc("POST /api/periods", s.handle(s.postPeriod))
	mux.HandleFunc("POST /api/periods/{id}/close", s.handle(s.closePeriod))

	mux.HandleFunc("GET /api/journals/next-voucher", s.handle(s.nextVoucherHandler))
	mux.HandleFunc("POST /api/journals", s.handle(s.postJournal))
	mux.HandleFunc("GET /api/journals/{id}", s.handle(s.getJournal))
	mux.HandleFunc("PUT /api/journals/{id}", s.handle(s.putJournal))
	mux.HandleFunc("DELETE /api/journals/{id}", s.handle(s.deleteJournal))
	mux.HandleFunc("POST /api/journals/{id}/post", s.handle(s.postJournalFlag))
	mux.HandleFunc("POST /api/journals/{id}/reverse", s.handle(s.reverseJournal))
	mux.HandleFunc("GET /api/journals/{id}/audit", s.handle(s.journalAudit))

	mux.HandleFunc("GET /api/imports/template", s.handle(s.importTemplate))
	mux.HandleFunc("POST /api/imports/preview", s.handle(s.importPreview))
	mux.HandleFunc("POST /api/imports/{id}/confirm", s.handle(s.importConfirm))

	mux.HandleFunc("GET /api/reports/{kind}", s.handle(s.report))

	mux.HandleFunc("GET /api/templates", s.handle(s.getTemplates))
	mux.HandleFunc("POST /api/templates", s.handle(s.postTemplate))
	mux.HandleFunc("DELETE /api/templates/{id}", s.handle(s.deleteTemplate))

	mux.HandleFunc("GET /api", s.handle(s.notFound))
	mux.HandleFunc("/", s.handle(s.notFound))
}

// handle membungkus handler yang mengembalikan error menjadi http.HandlerFunc.
func (s *Server) handle(fn func(http.ResponseWriter, *http.Request) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := fn(w, r); err != nil {
			s.writeError(w, r, err)
		}
	}
}

func (s *Server) notFound(w http.ResponseWriter, _ *http.Request) error {
	return fail(http.StatusNotFound, "Endpoint tidak ditemukan.")
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) error {
	return writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "finova-api", "runtime": "go"})
}

// withCORS mengizinkan asal permintaan dari Vite dev server (mode pengembangan).
func withCORS(origin string, next http.Handler) http.Handler {
	if origin == "" {
		origin = "*"
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header := w.Header()
		header.Set("Access-Control-Allow-Origin", origin)
		header.Set("Access-Control-Allow-Credentials", "true")
		header.Set("Vary", "Origin")
		if r.Method == http.MethodOptions {
			header.Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			header.Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
			header.Set("Access-Control-Max-Age", "600")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// withRecovery mengubah panic menjadi 500 agar server tidak mati mendadak.
func (s *Server) withRecovery(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				log.Printf("[Finova] panic pada %s %s: %v", r.Method, r.URL.Path, recovered)
				if written := w.Header().Get("Content-Type"); written == "" {
					_ = writeJSON(w, http.StatusInternalServerError, map[string]string{"message": "Terjadi kesalahan pada server. Silakan coba lagi."})
				}
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// writeError memetakan error ke status JSON, meniru middleware error Express.
func (s *Server) writeError(w http.ResponseWriter, r *http.Request, err error) {
	if db.IsUniqueViolation(err) {
		_ = writeJSON(w, http.StatusConflict, map[string]string{
			"message": "Data duplikat: kode akun, nomor bukti, atau berkas impor sudah digunakan.",
		})
		return
	}
	var httpErr *HTTPError
	if errors.As(err, &httpErr) {
		if httpErr.Status >= 500 {
			log.Printf("[Finova] %s %s -> %d: %s", r.Method, r.URL.Path, httpErr.Status, httpErr.Message)
		}
		_ = writeJSON(w, httpErr.Status, map[string]string{"message": httpErr.Message})
		return
	}
	log.Printf("[Finova] %s %s galat tak terduga: %v", r.Method, r.URL.Path, err)
	message := "Terjadi kesalahan pada server. Silakan coba lagi."
	if err != nil && err.Error() != "" {
		message = err.Error()
	}
	_ = writeJSON(w, http.StatusInternalServerError, map[string]string{"message": message})
}

func writeJSON(w http.ResponseWriter, status int, payload any) error {
	header := w.Header()
	header.Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if payload == nil {
		return nil
	}
	encoder := json.NewEncoder(w)
	encoder.SetEscapeHTML(false)
	return encoder.Encode(payload)
}

// readBody menafsirkan JSON permintaan sebagai peta kunci-nilai longgar,
// seperti req.body pada Express (key yang hilang menjadi nil, bukan error).
func readBody(r *http.Request) (db.Row, error) {
	body := db.Row{}
	if r.Body == nil {
		return body, nil
	}
	defer func() { _ = r.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(r.Body, maxRequestSize))
	if err != nil {
		return nil, fail(http.StatusRequestEntityTooLarge, "Berkas permintaan terlalu besar.")
	}
	if len(bytes.TrimSpace(raw)) == 0 {
		return body, nil
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(&body); err != nil {
		return nil, fail(http.StatusUnprocessableEntity, "Format permintaan tidak valid.")
	}
	return body, nil
}

func bodyText(body db.Row, keys ...string) string {
	for _, key := range keys {
		if value, ok := body[key]; ok && value != nil {
			return strings.TrimSpace(db.AsString(value))
		}
	}
	return ""
}

// bodyRawText sama seperti bodyText tetapi tidak memangkas spasi (nama akun, keterangan).
func bodyRawText(body db.Row, keys ...string) any {
	for _, key := range keys {
		if value, ok := body[key]; ok {
			return value
		}
	}
	return nil
}

func bodyNumber(body db.Row, keys ...string) float64 {
	value := bodyRawText(body, keys...)
	if text, ok := value.(json.Number); ok {
		parsed, err := text.Float64()
		if err != nil {
			return 0
		}
		return parsed
	}
	return db.AsFloat(value)
}

func bodyInt(body db.Row, keys ...string) int64 {
	return db.AsInt(bodyNumber(body, keys...))
}

func bodyBool(body db.Row, key string, fallback bool) bool {
	value, ok := body[key]
	if !ok || value == nil {
		return fallback
	}
	switch typed := value.(type) {
	case bool:
		return typed
	case json.Number:
		return typed.String() != "0"
	case float64:
		return typed != 0
	case int64:
		return typed != 0
	case string:
		return typed != "" && typed != "false" && typed != "0"
	default:
		return fallback
	}
}

// bodyLines membaca array baris jurnal dari body permintaan.
func bodyLines(body db.Row) ([]domain.LineInput, error) {
	raw, ok := body["lines"].([]any)
	if !ok {
		if rawRows, isRows := body["lines"].([]db.Row); isRows {
			converted := make([]any, 0, len(rawRows))
			for _, row := range rawRows {
				converted = append(converted, row)
			}
			return domain.LineInputsFromAny(converted), nil
		}
		return nil, nil
	}
	return domain.LineInputsFromAny(raw), nil
}

// paramInt mengambil segmen PATH yang bertipe angka.
func paramInt(r *http.Request, name string) int64 {
	return db.AsInt(r.PathValue(name))
}

// ---------- Lapisan layanan bersama ----------

// companyID id perusahaan tetap: aplikasi lokal satu perusahaan.
func (s *Server) companyID() int64 { return s.cfg.CompanyID }

// Bootstrap memastikan baris perusahaan, operator, dan dua belas periode berjalan ada.
func (s *Server) Bootstrap() error {
	ctx := s.database
	if _, err := ctx.Exec("INSERT OR IGNORE INTO companies (id, name, currency) VALUES (?, ?, ?)",
		s.companyID(), s.cfg.CompanyName, "IDR"); err != nil {
		return err
	}
	row, err := ctx.SelectOne("SELECT id FROM users ORDER BY id LIMIT 1")
	if err != nil {
		return err
	}
	if row == nil {
		created, err := ctx.Exec(
			"INSERT INTO users (company_id, name, email, password_hash, role, is_active) VALUES (?, ?, ?, ?, ?, 1)",
			s.companyID(), s.cfg.OperatorName, "operator@finova.local", loginDisabledHash, "ADMIN")
		if err != nil {
			return err
		}
		s.operatorID = created.InsertID
	} else {
		s.operatorID = db.AsInt(row["id"])
		if _, err := ctx.Exec("UPDATE users SET name = ?, role = ?, is_active = 1 WHERE id = ?",
			s.cfg.OperatorName, "ADMIN", s.operatorID); err != nil {
			return err
		}
	}
	year := time.Now().Year()
	for month := 1; month <= 12; month++ {
		start := fmt.Sprintf("%04d-%02d-01", year, month)
		end := lastDayOfMonth(year, time.Month(month))
		if _, err := ctx.Exec(
			"INSERT OR IGNORE INTO accounting_periods (company_id, name, start_date, end_date) VALUES (?, ?, ?, ?)",
			s.companyID(), fmt.Sprintf("%02d/%04d", month, year), start, end); err != nil {
			return err
		}
	}
	return nil
}

func lastDayOfMonth(year int, month time.Month) string {
	return time.Date(year, month+1, 0, 0, 0, 0, 0, time.Local).Format("2006-01-02")
}

// audit mencatat jejak audit; details menjadi JSON pada kolom details_json.
func (s *Server) audit(ctx db.Execer, entityID int64, entityType, action string, details any) error {
	var encoded any
	if details != nil {
		buffer, err := json.Marshal(details)
		if err != nil {
			return err
		}
		encoded = string(buffer)
	}
	_, err := ctx.Exec(
		"INSERT INTO audit_logs (company_id, user_id, entity_type, entity_id, action, details_json) VALUES (?, ?, ?, ?, ?, ?)",
		s.companyID(), s.operatorID, entityType, entityID, action, encoded)
	return err
}

// getOpenPeriod memastikan tanggal jatuh pada periode yang masih OPEN.
func (s *Server) getOpenPeriod(ctx db.Execer, date string) (db.Row, error) {
	period, err := ctx.SelectOne(
		"SELECT * FROM accounting_periods WHERE company_id = ? AND ? BETWEEN start_date AND end_date LIMIT 1",
		s.companyID(), date)
	if err != nil {
		return nil, err
	}
	if period == nil {
		return nil, fail(http.StatusUnprocessableEntity, "Tanggal transaksi belum memiliki periode akuntansi.")
	}
	if db.AsString(period["status"]) != "OPEN" {
		return nil, fail(http.StatusUnprocessableEntity, "Periode transaksi telah ditutup dan dikunci.")
	}
	return period, nil
}

// getAccountsForLines memvalidasi seluruh akun yang dipakai baris jurnal aktif dan ada.
func (s *Server) getAccountsForLines(ctx db.Execer, lines []domain.AmountedLine) ([]db.Row, error) {
	seen := map[int64]bool{}
	ids := []int64{}
	for _, line := range lines {
		if line.AccountID == 0 || seen[line.AccountID] {
			continue
		}
		seen[line.AccountID] = true
		ids = append(ids, line.AccountID)
	}
	if len(ids) == 0 {
		return nil, fail(http.StatusUnprocessableEntity, "Akun jurnal tidak valid.")
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")
	args := make([]any, 0, len(ids)+1)
	args = append(args, s.companyID())
	for _, id := range ids {
		args = append(args, id)
	}
	accounts, err := ctx.Select(
		fmt.Sprintf("SELECT * FROM accounts WHERE company_id = ? AND id IN (%s)", placeholders), args...)
	if err != nil {
		return nil, err
	}
	if len(accounts) != len(ids) {
		return nil, fail(http.StatusUnprocessableEntity, "Satu atau beberapa akun tidak aktif atau tidak ditemukan.")
	}
	for _, account := range accounts {
		if !db.AsBoolSQLite(account["is_active"]) {
			return nil, fail(http.StatusUnprocessableEntity, "Satu atau beberapa akun tidak aktif atau tidak ditemukan.")
		}
	}
	return accounts, nil
}

// writeEntryParams parameter pembuatan jurnal (sama seperti WriteEntryParams).
type writeEntryParams struct {
	userID        int64
	voucherNo     string
	entryDate     string
	description   string
	source        string
	status        string
	lines         []domain.AmountedLine
	importBatchID any
	reversalOfID  any
}

// writeEntry memvalidasi lalu menyimpan entri beserta barisnya dan jejak auditnya.
func (s *Server) writeEntry(ctx db.Execer, params writeEntryParams) (int64, error) {
	if !dateOnly.MatchString(params.entryDate) {
		return 0, fail(http.StatusUnprocessableEntity, "Tanggal jurnal tidak valid.")
	}
	lines, err := domain.AssertBalanced(params.lines)
	if err != nil {
		return 0, fail(http.StatusUnprocessableEntity, err.Error())
	}
	period, err := s.getOpenPeriod(ctx, params.entryDate)
	if err != nil {
		return 0, err
	}
	if _, err := s.getAccountsForLines(ctx, lines); err != nil {
		return 0, err
	}
	source := params.source
	if source == "" {
		source = "MANUAL"
	}
	status := params.status
	if status == "" {
		status = "DRAFT"
	}
	var postedBy any
	var postedAt any
	if status == "POSTED" {
		postedBy = params.userID
		postedAt = time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
	}
	created, err := ctx.Exec(
		`INSERT INTO journal_entries (company_id, period_id, voucher_no, entry_date, description, source, status, import_batch_id, reversal_of_id, created_by, posted_by, posted_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		s.companyID(), db.AsInt(period["id"]), params.voucherNo, params.entryDate, params.description, source, status,
		params.importBatchID, params.reversalOfID, params.userID, postedBy, postedAt)
	if err != nil {
		return 0, err
	}
	for index, line := range lines {
		var memo any
		if line.Memo != nil && *line.Memo != "" {
			memo = *line.Memo
		}
		if _, err := ctx.Exec(
			"INSERT INTO journal_lines (journal_entry_id, account_id, line_no, memo, debit, credit) VALUES (?, ?, ?, ?, ?, ?)",
			created.InsertID, line.AccountID, index+1, memo, line.Debit, line.Credit); err != nil {
			return 0, err
		}
	}
	action := "CREATED"
	if status == "POSTED" {
		action = "POSTED"
	}
	if err := s.audit(ctx, created.InsertID, "JOURNAL_ENTRY", action, map[string]any{"source": source, "voucherNo": params.voucherNo}); err != nil {
		return 0, err
	}
	return created.InsertID, nil
}

// fetchEntry memuat satu entri beserta barisnya (kolom akun ikut di-join).
func (s *Server) fetchEntry(ctx db.Execer, id int64) (db.Row, error) {
	entry, err := ctx.SelectOne(
		`SELECT e.*, u.name AS created_by_name FROM journal_entries e
		 LEFT JOIN users u ON u.id = e.created_by WHERE e.id = ? AND e.company_id = ?`, id, s.companyID())
	if err != nil {
		return nil, err
	}
	if entry == nil {
		return nil, fail(http.StatusNotFound, "Jurnal tidak ditemukan.")
	}
	lines, err := ctx.Select(
		`SELECT l.*, a.code, a.name AS account_name FROM journal_lines l
		 JOIN accounts a ON a.id = l.account_id WHERE l.journal_entry_id = ? ORDER BY l.line_no`, id)
	if err != nil {
		return nil, err
	}
	entry["lines"] = lines
	return entry, nil
}

// entryLines mengubah baris mentah entri menjadi baris ternormalisasi.
func entryLines(entry db.Row) []domain.AmountedLine {
	rows, _ := entry["lines"].([]db.Row)
	return domain.LinesFromRows(rows)
}

// nextVoucher menghasilkan nomor bukti berurutan JRN-YYYYMM-NNN.
func (s *Server) nextVoucher(ctx db.Execer, yearMonth string) (string, error) {
	prefix := "JRN-" + yearMonth + "-"
	row, err := ctx.SelectOne(
		"SELECT voucher_no FROM journal_entries WHERE company_id = ? AND voucher_no LIKE ? ORDER BY id DESC LIMIT 1",
		s.companyID(), prefix+"%")
	if err != nil {
		return "", err
	}
	sequence := 1
	if row != nil {
		if match := trailingNumber.FindStringSubmatch(db.AsString(row["voucher_no"])); match != nil {
			if parsed, convErr := strconv.Atoi(match[1]); convErr == nil {
				sequence = parsed + 1
			}
		}
	}
	return fmt.Sprintf("%s%03d", prefix, sequence), nil
}

var trailingNumber = regexp.MustCompile(`-(\d+)$`)

// Run membuka port dan melayani sampai ctx dibatalkan.
func (s *Server) Run(ctx context.Context) error {
	address := fmt.Sprintf(":%d", s.cfg.Port)
	listener, err := net.Listen("tcp", address)
	if err != nil {
		if strings.Contains(err.Error(), "bind") || strings.Contains(err.Error(), "address already in use") {
			return fmt.Errorf("port %d sudah digunakan oleh instans Finova lain: %w", s.cfg.Port, err)
		}
		return err
	}
	server := &http.Server{Handler: s.Handler(), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()
	log.Printf("Finova API (Go) berjalan di http://localhost:%d", s.cfg.Port)
	if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
