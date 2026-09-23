package httpapi

import (
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"finova/internal/db"
	"finova/internal/domain"
	"finova/internal/export"
)

// Berkas laporan kini dibuat di server (excelize + go-pdf/fpdf) sehingga ExcelJS,
// jsPDF, dan html2canvas tidak perlu ikut terkirim ke peramban. Nama berkas dan
// tata letak disamakan dengan versi klien lama.

// exportFilename membersihkan nama berkas dari karakter yang mengganggu header.
func exportFilename(prefix, suffix string) string {
	replacer := strings.NewReplacer("/", "-", "\\", "-", `"`, "", "\r", "", "\n", "")
	return replacer.Replace(prefix) + suffix
}

func writeDownload(w http.ResponseWriter, filename, contentType string, payload []byte) {
	w.Header().Set("Content-Disposition", "attachment; filename="+strconv.Quote(filename))
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", fmt.Sprint(len(payload)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(payload)
}

const xlsxMIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

// journalFilter adalah hasil pembacaan parameter register jurnal.
type journalFilter struct {
	status    string
	accountID int64
	search    string
	sortKey   string
	sortDir   string
}

func readJournalFilter(r *http.Request) journalFilter {
	filter := journalFilter{
		status:    strings.ToUpper(r.URL.Query().Get("status")),
		accountID: db.AsInt(r.URL.Query().Get("accountId")),
		search:    strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q"))),
		sortKey:   strings.ToLower(r.URL.Query().Get("sort")),
		sortDir:   strings.ToLower(r.URL.Query().Get("dir")),
	}
	if filter.status == "" {
		filter.status = "ALL"
	}
	if filter.sortKey == "" {
		filter.sortKey = "date"
	}
	if filter.sortDir == "" {
		filter.sortDir = "desc"
	}
	return filter
}

// applyJournalFilter meniru penyaringan dan pengurutan yang dilakukan daftar jurnal
// di peramban, sehingga isi berkas sama dengan yang dilihat pengguna.
func applyJournalFilter(entries []domain.Entry, filter journalFilter) []domain.Entry {
	filtered := []domain.Entry{}
	for _, entry := range entries {
		if filter.status != "ALL" && filter.status != "" {
			if entry.Status != filter.status {
				continue
			}
		}
		if filter.accountID != 0 {
			matched := false
			for _, line := range entry.Lines {
				if line.AccountID == filter.accountID {
					matched = true
					break
				}
			}
			if !matched {
				continue
			}
		}
		if filter.search != "" {
			haystack := []string{strings.ToLower(entry.VoucherNo), strings.ToLower(entry.Description)}
			for _, line := range entry.Lines {
				if line.Code != nil {
					haystack = append(haystack, strings.ToLower(*line.Code))
				}
				if line.AccountName != nil {
					haystack = append(haystack, strings.ToLower(*line.AccountName))
				}
				if line.Memo != nil {
					haystack = append(haystack, strings.ToLower(*line.Memo))
				}
			}
			matched := false
			for _, value := range haystack {
				if strings.Contains(value, filter.search) {
					matched = true
					break
				}
			}
			if !matched {
				continue
			}
		}
		filtered = append(filtered, entry)
	}

	direction := 1.0
	if filter.sortDir == "desc" {
		direction = -1
	}
	sideTotal := func(entry domain.Entry, debit bool) float64 {
		total := 0.0
		for _, line := range entry.Lines {
			if debit {
				total += line.Debit
			} else {
				total += line.Credit
			}
		}
		return total
	}
	sort.SliceStable(filtered, func(i, j int) bool {
		left, right := filtered[i], filtered[j]
		switch filter.sortKey {
		case "voucher":
			return strings.Compare(left.VoucherNo, right.VoucherNo)*int(direction) < 0
		case "debit":
			return (sideTotal(left, true)-sideTotal(right, true))*direction < 0
		case "credit":
			return (sideTotal(left, false)-sideTotal(right, false))*direction < 0
		default:
			compare := strings.Compare(left.EntryDate, right.EntryDate)
			if compare == 0 {
				compare = int(left.ID - right.ID)
			}
			return compare*int(direction) < 0
		}
	})
	return filtered
}

// signersFromRequest membaca nama penanda tangan yang tersimpan di peramban.
func signersFromRequest(r *http.Request) export.Signers {
	query := r.URL.Query()
	return export.Signers{
		Maker:    query.Get("maker"),
		Checker:  query.Get("checker"),
		Approver: query.Get("approver"),
	}.WithDefaults()
}

// buildJournalExport menyusun data ekspor jurnal (xlsx maupun pdf) dari basis data.
func (s *Server) buildJournalExport(r *http.Request, asPDF bool) (export.JournalData, string, error) {
	from, to := defaultRange(r)
	if from > to {
		return export.JournalData{}, "", fail(http.StatusUnprocessableEntity, "Rentang tanggal tidak valid.")
	}
	context, err := s.reportContext(s.database, from, to, true)
	if err != nil {
		return export.JournalData{}, "", err
	}
	entries := applyJournalFilter(context.periodEntries, readJournalFilter(r))
	posted := periodEntriesArePosted(entries)
	recapSource := s.buildJournalReport(context, posted)

	marker := export.CreditMarker(false)
	if asPDF {
		marker = export.CreditMarker(true)
	}

	rows := []export.JournalRow{}
	totalDebit, totalCredit := 0.0, 0.0
	for entryIndex, entry := range entries {
		for lineIndex, line := range entry.Lines {
			name := derefString(line.AccountName)
			account := name
			if line.Credit > 0 {
				account = marker + name
			}
			row := export.JournalRow{
				ShowHead:  lineIndex == 0,
				Account:   account,
				Ref:       derefString(line.Code),
				Debit:     line.Debit,
				Credit:    line.Credit,
				IsCredit:  line.Credit > 0,
				Alternate: entryIndex%2 == 1,
				LineMemo:  derefString(line.Memo),
			}
			if row.ShowHead {
				row.Date = entry.EntryDate
				row.Voucher = entry.VoucherNo
			}
			if lineIndex == len(entry.Lines)-1 {
				row.EndMemo = entry.Description
			}
			rows = append(rows, row)
		}
	}
	for _, entry := range posted {
		for _, line := range entry.Lines {
			totalDebit = domain.RoundMoney(totalDebit + line.Debit)
			totalCredit = domain.RoundMoney(totalCredit + line.Credit)
		}
	}

	recap := export.Recap{
		TotalDebit:  recapSource.Recap.TotalDebit,
		TotalCredit: recapSource.Recap.TotalCredit,
		IsBalanced:  recapSource.Recap.IsBalanced,
	}
	for _, item := range recapSource.Recap.Debits {
		recap.Debits = append(recap.Debits, export.RecapItem{Code: item.Code, Name: item.Name, Amount: item.Amount})
	}
	for _, item := range recapSource.Recap.Credits {
		recap.Credits = append(recap.Credits, export.RecapItem{Code: item.Code, Name: item.Name, Amount: item.Amount})
	}

	data := export.JournalData{
		Company:     companyName(context.company),
		From:        from,
		To:          to,
		Entries:     rows,
		TotalDebit:  totalDebit,
		TotalCredit: totalCredit,
		Recap:       recap,
		Signers:     signersFromRequest(r),
		PrintedOn:   time.Now().Format("2006-01-02"),
	}
	name := fmt.Sprintf("Finova_Jurnal_Umum_%s_sd_%s", from, to)
	return data, name, nil
}

// exportJournalXLSX GET /api/exports/journal.xlsx
func (s *Server) exportJournalXLSX(w http.ResponseWriter, r *http.Request) error {
	data, name, err := s.buildJournalExport(r, false)
	if err != nil {
		return err
	}
	book, err := export.JournalWorkbook(data)
	if err != nil {
		return err
	}
	writeDownload(w, exportFilename(name, ".xlsx"), xlsxMIME, book)
	return nil
}

// exportJournalPDF GET /api/exports/journal.pdf
func (s *Server) exportJournalPDF(w http.ResponseWriter, r *http.Request) error {
	data, name, err := s.buildJournalExport(r, true)
	if err != nil {
		return err
	}
	pdf, err := export.JournalPDF(data)
	if err != nil {
		return err
	}
	writeDownload(w, exportFilename(name, ".pdf"), "application/pdf", pdf)
	return nil
}

// exportLedgerXLSX GET /api/exports/ledger.xlsx?accountId=
func (s *Server) exportLedgerXLSX(w http.ResponseWriter, r *http.Request) error {
	from, to := defaultRange(r)
	if from > to {
		return fail(http.StatusUnprocessableEntity, "Rentang tanggal tidak valid.")
	}
	context, err := s.reportContext(s.database, from, to, false)
	if err != nil {
		return err
	}
	allLines := domain.Flatten(context.allEntries)
	periodLines := domain.Flatten(context.periodEntries)
	ledger, err := s.buildLedger(context, r, from, allLines, periodLines)
	if err != nil {
		return err
	}
	rows := make([]export.LedgerRow, 0, len(ledger.Rows))
	for _, row := range ledger.Rows {
		description := row.Description
		if description == "" && row.Memo != nil {
			description = *row.Memo
		}
		rows = append(rows, export.LedgerRow{
			Date: row.EntryDate, Voucher: row.VoucherNo, Description: description,
			Debit: row.Debit, Credit: row.Credit, Balance: row.Balance,
		})
	}
	accountCode := db.AsString(ledger.Account["code"])
	accountName := db.AsString(ledger.Account["name"])
	data := export.LedgerData{
		Company:       companyName(context.company),
		AccountLabel:  accountCode + " - " + accountName,
		NormalBalance: db.AsString(ledger.Account["normal_balance"]),
		From:          from,
		To:            to,
		Opening:       ledger.Opening,
		Rows:          rows,
		Closing:       ledger.Closing,
	}
	book, err := export.LedgerWorkbook(data)
	if err != nil {
		return err
	}
	name := fmt.Sprintf("Finova_Buku_Besar_%s_%s", accountCode, from)
	writeDownload(w, exportFilename(name, ".xlsx"), xlsxMIME, book)
	return nil
}

// exportTrialBalanceXLSX GET /api/exports/trial-balance.xlsx
func (s *Server) exportTrialBalanceXLSX(w http.ResponseWriter, r *http.Request) error {
	from, to := defaultRange(r)
	if from > to {
		return fail(http.StatusUnprocessableEntity, "Rentang tanggal tidak valid.")
	}
	context, err := s.reportContext(s.database, from, to, false)
	if err != nil {
		return err
	}
	report := domain.BuildTrialBalance(context.typedAccounts, domain.Flatten(context.allEntries))
	rows := make([]export.TrialBalanceRow, 0, len(report.Rows))
	for _, row := range report.Rows {
		rows = append(rows, export.TrialBalanceRow{Code: row.Code, Name: row.Name, Group: row.Group, Debit: row.Debit, Credit: row.Credit})
	}
	data := export.TrialBalanceData{
		Company:     companyName(context.company),
		AsOf:        to,
		Rows:        rows,
		TotalDebit:  report.Totals.Debit,
		TotalCredit: report.Totals.Credit,
	}
	book, err := export.TrialBalanceWorkbook(data)
	if err != nil {
		return err
	}
	writeDownload(w, exportFilename(fmt.Sprintf("Finova_Neraca_Saldo_%s", to), ".xlsx"), xlsxMIME, book)
	return nil
}

// exportAccountsXLSX GET /api/exports/accounts.xlsx
func (s *Server) exportAccountsXLSX(w http.ResponseWriter, _ *http.Request) error {
	accounts, err := s.database.Select("SELECT * FROM accounts WHERE company_id = ? ORDER BY code", s.companyID())
	if err != nil {
		return err
	}
	company, err := s.database.SelectOne("SELECT * FROM companies WHERE id = ?", s.companyID())
	if err != nil {
		return err
	}
	rows := make([]export.AccountRow, 0, len(accounts))
	for _, account := range accounts {
		cashLabel := "Tidak"
		if db.AsBoolSQLite(account["is_cash_account"]) {
			cashLabel = "Ya (Kas/Bank)"
		}
		rows = append(rows, export.AccountRow{
			Code:          db.AsString(account["code"]),
			Name:          db.AsString(account["name"]),
			Group:         db.AsString(account["account_group"]),
			Subtype:       db.AsString(account["account_subtype"]),
			NormalBalance: db.AsString(account["normal_balance"]),
			CashFlow:      db.AsString(account["cash_flow_category"]),
			CashLabel:     cashLabel,
		})
	}
	book, err := export.AccountsWorkbook(export.AccountsData{Company: companyName(company), Rows: rows})
	if err != nil {
		return err
	}
	name := fmt.Sprintf("Finova_Bagan_Akun_%s", time.Now().Format("2006-01-02"))
	writeDownload(w, exportFilename(name, ".xlsx"), xlsxMIME, book)
	return nil
}

func derefString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func companyName(row db.Row) string {
	if row == nil {
		return ""
	}
	return db.AsString(row["name"])
}
