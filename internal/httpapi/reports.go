package httpapi

import (
	"math"
	"net/http"
	"sort"
	"strings"
	"time"

	"finova/internal/db"
	"finova/internal/domain"
)

// reportDataSet hasil pengumpulan data laporan: entri berstatus sesuai opsi.
type reportDataSet struct {
	company       db.Row
	accounts      []db.Row
	typedAccounts []domain.Account
	allEntries    []domain.Entry
	periodEntries []domain.Entry
}

// defaultRange rentang tanggal laporan: awal bulan berjalan s/d hari ini (UTC).
func defaultRange(r *http.Request) (string, string) {
	today := time.Now().UTC().Format("2006-01-02")
	from := r.URL.Query().Get("from")
	if from == "" {
		from = today[:8] + "01"
	}
	to := r.URL.Query().Get("to")
	if to == "" {
		to = today
	}
	return from, to
}

// reportContext memuat perusahaan, bagan akun, dan jurnal sampai tanggal `to`.
//
// Draft hanya boleh muncul di register jurnal. Fungsi ini dipakai bersama oleh
// Neraca Saldo, Neraca, Buku Besar, Dashboard, dan jurnal penutup — membocorkan draft
// ke sana akan membuat laporan yang tampak sah menjadi salah.
func (s *Server) reportContext(exec db.Execer, from, to string, includeDrafts bool) (reportDataSet, error) {
	statusClause := "e.status = 'POSTED'"
	if includeDrafts {
		statusClause = "e.status IN ('POSTED', 'DRAFT')"
	}
	company, err := exec.SelectOne("SELECT * FROM companies WHERE id = ?", s.companyID())
	if err != nil {
		return reportDataSet{}, err
	}
	accounts, err := exec.Select("SELECT * FROM accounts WHERE company_id = ? ORDER BY code", s.companyID())
	if err != nil {
		return reportDataSet{}, err
	}
	rows, err := exec.Select(
		`SELECT e.id entry_id, e.voucher_no, e.entry_date, e.description, e.source, e.status, e.reversal_of_id,
		        EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversal_of_id = e.id) AS reversed,
		        l.account_id, l.line_no, l.debit, l.credit, l.memo, a.code, a.name account_name
		 FROM journal_entries e
		 JOIN journal_lines l ON l.journal_entry_id = e.id
		 JOIN accounts a ON a.id = l.account_id
		 WHERE e.company_id = ? AND `+statusClause+` AND e.entry_date <= ?
		 ORDER BY e.entry_date, e.id, l.line_no`, s.companyID(), to)
	if err != nil {
		return reportDataSet{}, err
	}
	allEntries := domain.GroupJournalRows(rows)
	periodEntries := []domain.Entry{}
	for _, entry := range allEntries {
		if entry.EntryDate >= from {
			periodEntries = append(periodEntries, entry)
		}
	}
	return reportDataSet{
		company:       company,
		accounts:      accounts,
		typedAccounts: domain.AccountsFromRows(accounts),
		allEntries:    allEntries,
		periodEntries: periodEntries,
	}, nil
}

// accountByID memetakan id akun -> baris akun untuk pencarian cepat.
func accountByID(rows []db.Row) map[int64]db.Row {
	byID := map[int64]db.Row{}
	for _, row := range rows {
		byID[db.AsInt(row["id"])] = row
	}
	return byID
}

// RecapRow jumlah satu akun pada rekapitulasi register jurnal.
type RecapRow struct {
	Code   string  `json:"code"`
	Name   string  `json:"name"`
	Amount float64 `json:"amount"`
}

// JournalRecap rekap debit/kredit register jurnal.
type JournalRecap struct {
	Debits      []RecapRow `json:"debits"`
	Credits     []RecapRow `json:"credits"`
	TotalDebit  float64    `json:"totalDebit"`
	TotalCredit float64    `json:"totalCredit"`
	IsBalanced  bool       `json:"isBalanced"`
}

// JournalReportData muatan laporan register jurnal.
type JournalReportData struct {
	Entries []domain.Entry `json:"entries"`
	Recap   JournalRecap   `json:"recap"`
}

// LedgerRow baris buku besar dengan saldo berjalan.
type LedgerRow struct {
	domain.AmountedLine
	Balance float64 `json:"balance"`
}

// LedgerData muatan laporan buku besar.
type LedgerData struct {
	Account db.Row      `json:"account"`
	Opening float64     `json:"opening"`
	Rows    []LedgerRow `json:"rows"`
	Closing float64     `json:"closing"`
}

// DashboardData angka ringkas halaman beranda.
type DashboardData struct {
	CashBank    float64 `json:"cashBank"`
	Receivables float64 `json:"receivables"`
	Payables    float64 `json:"payables"`
	Revenue     float64 `json:"revenue"`
	Expenses    float64 `json:"expenses"`
	NetIncome   float64 `json:"netIncome"`
}

// report GET /api/reports/{kind}
func (s *Server) report(w http.ResponseWriter, r *http.Request) error {
	kind := r.PathValue("kind")
	from, to := defaultRange(r)
	if from > to {
		return fail(http.StatusUnprocessableEntity, "Rentang tanggal tidak valid.")
	}
	context, err := s.reportContext(s.database, from, to, kind == "journal")
	if err != nil {
		return err
	}
	allLines := domain.Flatten(context.allEntries)
	periodLines := domain.Flatten(context.periodEntries)

	var data any
	switch kind {
	case "journal":
		data = s.buildJournalReport(context, periodEntriesArePosted(context.periodEntries))
	case "trial-balance":
		data = domain.BuildTrialBalance(context.typedAccounts, allLines)
	case "income-statement":
		data = domain.BuildIncomeStatement(context.typedAccounts, periodLines)
	case "balance-sheet":
		data = domain.BuildBalanceSheet(context.typedAccounts, allLines)
	case "equity-changes":
		beforeLines := domain.Flatten(entriesBefore(context.allEntries, from))
		data = domain.BuildEquityChanges(context.typedAccounts, beforeLines, periodLines)
	case "cash-flow":
		data = domain.BuildCashFlowDirect(context.typedAccounts, context.periodEntries)
	case "ledger":
		result, err := s.buildLedger(context, r, from, allLines, periodLines)
		if err != nil {
			return err
		}
		data = result
	case "dashboard":
		data = buildDashboard(context, periodLines, allLines)
	default:
		return fail(http.StatusNotFound, "Jenis laporan tidak ditemukan.")
	}
	return writeJSON(w, http.StatusOK, map[string]any{
		"company": context.company,
		"period":  map[string]string{"from": from, "to": to},
		"data":    data,
	})
}

func entriesBefore(entries []domain.Entry, from string) []domain.Entry {
	filtered := []domain.Entry{}
	for _, entry := range entries {
		if entry.EntryDate < from {
			filtered = append(filtered, entry)
		}
	}
	return filtered
}

func periodEntriesArePosted(entries []domain.Entry) []domain.Entry {
	posted := []domain.Entry{}
	for _, entry := range entries {
		if entry.Status == "POSTED" {
			posted = append(posted, entry)
		}
	}
	return posted
}

// buildJournalReport register jurnal + rekapitulasi hanya untuk entri terposting.
func (s *Server) buildJournalReport(context reportDataSet, postedEntries []domain.Entry) JournalReportData {
	type accumulator struct {
		order  []string
		byCode map[string]*RecapRow
	}
	debits := &accumulator{byCode: map[string]*RecapRow{}}
	credits := &accumulator{byCode: map[string]*RecapRow{}}
	totalDebit := float64(0)
	totalCredit := float64(0)

	add := func(store *accumulator, code, name string, value float64) {
		row, exists := store.byCode[code]
		if !exists {
			row = &RecapRow{Code: code, Name: name}
			store.byCode[code] = row
			store.order = append(store.order, code)
		}
		row.Amount = domain.RoundMoney(row.Amount + value)
	}

	for _, entry := range postedEntries {
		for _, line := range entry.Lines {
			code := ""
			if line.Code != nil {
				code = *line.Code
			}
			name := ""
			if line.AccountName != nil {
				name = *line.AccountName
			}
			if line.Debit > 0 {
				add(debits, code, name, line.Debit)
				totalDebit = domain.RoundMoney(totalDebit + line.Debit)
			}
			if line.Credit > 0 {
				add(credits, code, name, line.Credit)
				totalCredit = domain.RoundMoney(totalCredit + line.Credit)
			}
		}
	}
	list := func(store *accumulator) []RecapRow {
		rows := make([]RecapRow, 0, len(store.order))
		for _, code := range store.order {
			rows = append(rows, *store.byCode[code])
		}
		sort.SliceStable(rows, func(i, j int) bool { return rows[i].Code < rows[j].Code })
		return rows
	}
	return JournalReportData{
		Entries: context.periodEntries,
		Recap: JournalRecap{
			Debits:      list(debits),
			Credits:     list(credits),
			TotalDebit:  totalDebit,
			TotalCredit: totalCredit,
			IsBalanced:  math.Abs(totalDebit-totalCredit) < domain.MoneyEpsilon,
		},
	}
}

// buildLedger buku besar satu akun dengan saldo berjalan.
func (s *Server) buildLedger(context reportDataSet, r *http.Request, from string, allLines, periodLines []domain.AmountedLine) (LedgerData, error) {
	accountID := db.AsInt(r.URL.Query().Get("accountId"))
	var targetRow db.Row
	var target domain.Account
	accounts := accountByID(context.accounts)
	row, ok := accounts[accountID]
	if !ok {
		return LedgerData{}, fail(http.StatusUnprocessableEntity, "Pilih akun untuk buku besar.")
	}
	targetRow = row
	target = domain.AccountFromRow(row)

	before := []domain.AmountedLine{}
	for _, line := range allLines {
		if line.AccountID == accountID && line.EntryDate < from {
			before = append(before, line)
		}
	}
	running := domain.AccountBalance(target, domain.CalculateAccountBalances(context.typedAccounts, before))
	rows := []LedgerRow{}
	for _, line := range periodLines {
		if line.AccountID != accountID {
			continue
		}
		if target.NormalBalance == "DEBIT" {
			running = domain.RoundMoney(running + line.Debit - line.Credit)
		} else {
			running = domain.RoundMoney(running + line.Credit - line.Debit)
		}
		rows = append(rows, LedgerRow{AmountedLine: line, Balance: running})
	}
	return LedgerData{Account: targetRow, Opening: running, Rows: rows, Closing: running}, nil
}

// buildDashboard kartu angka pada halaman beranda.
func buildDashboard(context reportDataSet, periodLines, allLines []domain.AmountedLine) DashboardData {
	income := domain.BuildIncomeStatement(context.typedAccounts, periodLines)
	balance := domain.BuildBalanceSheet(context.typedAccounts, allLines)
	accounts := accountByID(context.accounts)
	subtypeOf := func(accountID int64) string {
		row, ok := accounts[accountID]
		if !ok {
			return ""
		}
		return db.AsString(row["account_subtype"])
	}
	totalOf := func(rows []domain.StatementRow, subtypes ...string) float64 {
		total := float64(0)
		for _, row := range rows {
			subtype := subtypeOf(row.AccountID)
			for _, wanted := range subtypes {
				if subtype == wanted {
					total = domain.RoundMoney(total + row.Amount)
				}
			}
		}
		return total
	}
	return DashboardData{
		CashBank:    totalOf(balance.Assets.Rows, "CASH", "BANK"),
		Receivables: totalOf(balance.Assets.Rows, "RECEIVABLE"),
		Payables:    totalOf(balance.Liabilities.Rows, "PAYABLE"),
		Revenue:     income.RevenueTotal,
		Expenses:    income.ExpenseTotal,
		NetIncome:   income.NetIncome,
	}
}

// closePeriod POST /api/periods/{id}/close — membuat jurnal penutup lalu mengunci periode.
func (s *Server) closePeriod(w http.ResponseWriter, r *http.Request) error {
	periodID := paramInt(r, "id")
	var entryID any
	var netIncome float64
	err := s.database.WithTransaction(func(tx *db.Tx) error {
		period, err := tx.SelectOne("SELECT * FROM accounting_periods WHERE id = ? AND company_id = ?", periodID, s.companyID())
		if err != nil {
			return err
		}
		if period == nil {
			return fail(http.StatusNotFound, "Periode tidak ditemukan.")
		}
		if db.AsString(period["status"]) != "OPEN" {
			return fail(http.StatusUnprocessableEntity, "Periode sudah ditutup.")
		}
		startDate := domain.DateText(period["start_date"])
		endDate := domain.DateText(period["end_date"])
		context, err := s.reportContext(tx, startDate, endDate, false)
		if err != nil {
			return err
		}
		periodLines := domain.Flatten(context.periodEntries)
		lines, err := domain.MakeClosingLines(context.typedAccounts, periodLines)
		if err != nil {
			return fail(http.StatusUnprocessableEntity, err.Error())
		}
		entryID = nil
		if len(lines) > 0 {
			created, err := s.writeEntry(tx, writeEntryParams{
				userID:      s.operatorID,
				voucherNo:   "TUTUP-" + strings.ReplaceAll(endDate, "-", ""),
				entryDate:   endDate,
				description: "Jurnal penutup periode " + db.AsString(period["name"]),
				source:      "CLOSING",
				status:      "POSTED",
				lines:       lines,
			})
			if err != nil {
				return err
			}
			entryID = created
		}
		if _, err := tx.Exec(
			"UPDATE accounting_periods SET status = 'CLOSED', closed_at = datetime('now', 'localtime'), closed_by = ? WHERE id = ?",
			s.operatorID, db.AsInt(period["id"])); err != nil {
			return err
		}
		if err := s.audit(tx, db.AsInt(period["id"]), "ACCOUNTING_PERIOD", "CLOSED", map[string]any{"closingEntryId": entryID}); err != nil {
			return err
		}
		netIncome = domain.BuildIncomeStatement(context.typedAccounts, periodLines).NetIncome
		return nil
	})
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]any{"ok": true, "entryId": entryID, "netIncome": netIncome})
}
