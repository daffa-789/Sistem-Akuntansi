// Package domain memuat aturan pembukuan Finova: pembulatan uang, validasi jurnal
// berpasangan, pengelompokan baris register, dan seluruh laporan keuangan.
// Terjemahan langsung dari server/accounting.ts agar angka yang dihasilkan identik.
package domain

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"

	"finova/internal/db"
)

// MoneyEpsilon toleransi keseimbangan (0,005) — sama seperti backend lama.
const MoneyEpsilon = 0.005

// numberEpsilon adalah Number.EPSILON milik JavaScript, dipakai pada pembulatan.
const numberEpsilon = 2.220446049250313e-16

// jsRound meniru Math.round: selalu membulatkan ke atas untuk angka setengah,
// termasuk pada nilai negatif (Math.floor(x + 0.5)).
func jsRound(value float64) float64 { return math.Floor(value + 0.5) }

// RoundMoney membulatkan ke dua desimal dengan aturan yang sama dengan roundMoney().
func RoundMoney(value float64) float64 { return jsRound((value+numberEpsilon)*100) / 100 }

// Amount menormalkan nilai apa pun dari database/JSON menjadi uang dua desimal.
func Amount(value any) float64 { return RoundMoney(db.AsFloat(value)) }

// Account ringkasan baris tabel accounts yang dibutuhkan mesin laporan.
type Account struct {
	ID               int64
	Code             string
	Name             string
	Group            string
	Subtype          string
	NormalBalance    string
	CashFlowCategory string
	IsCashAccount    bool
	IsActive         bool
}

// AccountFromRow membaca baris tabel accounts.
func AccountFromRow(row db.Row) Account {
	normal := db.AsString(row["normal_balance"])
	group := db.AsString(row["account_group"])
	if normal == "" {
		if group == "ASSET" || group == "EXPENSE" {
			normal = "DEBIT"
		} else {
			normal = "CREDIT"
		}
	}
	return Account{
		ID:               db.AsInt(row["id"]),
		Code:             db.AsString(row["code"]),
		Name:             db.AsString(row["name"]),
		Group:            group,
		Subtype:          db.AsString(row["account_subtype"]),
		NormalBalance:    normal,
		CashFlowCategory: db.AsString(row["cash_flow_category"]),
		IsCashAccount:    db.AsBoolSQLite(row["is_cash_account"]),
		IsActive:         db.AsBoolSQLite(row["is_active"]),
	}
}

// AccountsFromRows memetakan seluruh baris accounts.
func AccountsFromRows(rows []db.Row) []Account {
	accounts := make([]Account, 0, len(rows))
	for _, row := range rows {
		accounts = append(accounts, AccountFromRow(row))
	}
	return accounts
}

// Line baris jurnal pada keluaran register/entri.
type Line struct {
	AccountID   int64   `json:"account_id"`
	LineNo      int     `json:"line_no"`
	Debit       float64 `json:"debit"`
	Credit      float64 `json:"credit"`
	Memo        *string `json:"memo"`
	Code        *string `json:"code,omitempty"`
	AccountName *string `json:"account_name,omitempty"`
}

// Entry satu entri jurnal hasil pengelompokan baris (register jurnal).
type Entry struct {
	ID           int64  `json:"id"`
	VoucherNo    string `json:"voucher_no"`
	EntryDate    string `json:"entry_date"`
	Description  string `json:"description"`
	Source       string `json:"source"`
	Status       string `json:"status"`
	ReversalOfID *int64 `json:"reversal_of_id"`
	Reversed     bool   `json:"reversed"`
	Lines        []Line `json:"lines"`
}

// AmountedLine baris jurnal yang sudah dinormalkan: dipakai mesin laporan dan
// ditulis sebagai JSON pada laporan buku besar.
type AmountedLine struct {
	AccountID   int64   `json:"account_id"`
	LineNo      int     `json:"line_no"`
	Debit       float64 `json:"debit"`
	Credit      float64 `json:"credit"`
	Memo        *string `json:"memo"`
	Code        *string `json:"code,omitempty"`
	AccountName *string `json:"account_name,omitempty"`
	Source      string  `json:"source"`
	EntryDate   string  `json:"entry_date"`
	VoucherNo   string  `json:"voucher_no"`
	Description string  `json:"description"`
}

// AsLine mengubah baris entri menjadi baris ternormalisasi.
func (l Line) AsLine() AmountedLine {
	return AmountedLine{AccountID: l.AccountID, LineNo: l.LineNo, Debit: l.Debit, Credit: l.Credit, Memo: l.Memo, Code: l.Code, AccountName: l.AccountName}
}

// DateText memotong stempel waktu menjadi tanggal ISO (YYYY-MM-DD).
func DateText(value any) string {
	text := db.AsString(value)
	if len(text) > 10 {
		return text[:10]
	}
	return text
}

// GroupJournalRows mengelompokkan baris hasil JOIN entri+baris+akun menjadi entri,
// mempertahankan urutan kemunculan dan mengurutkan baris menurut line_no.
func GroupJournalRows(rows []db.Row) []Entry {
	entries := []Entry{}
	indexByID := map[int64]int{}
	for _, row := range rows {
		entryID := db.AsInt(row["entry_id"])
		line := Line{
			AccountID:   db.AsInt(row["account_id"]),
			LineNo:      int(db.AsInt(row["line_no"])),
			Debit:       Amount(row["debit"]),
			Credit:      Amount(row["credit"]),
			Memo:        db.StringPtr(row["memo"]),
			Code:        optionalString(row["code"]),
			AccountName: optionalString(row["account_name"]),
		}
		position, exists := indexByID[entryID]
		if !exists {
			entry := Entry{
				ID:           entryID,
				VoucherNo:    db.AsString(row["voucher_no"]),
				EntryDate:    DateText(row["entry_date"]),
				Description:  db.AsString(row["description"]),
				Source:       db.AsString(row["source"]),
				Status:       db.AsString(row["status"]),
				ReversalOfID: optionalInt(row["reversal_of_id"]),
				Reversed:     db.AsFloat(row["reversed"]) != 0,
				Lines:        []Line{line},
			}
			indexByID[entryID] = len(entries)
			entries = append(entries, entry)
			continue
		}
		entries[position].Lines = append(entries[position].Lines, line)
	}
	for i := range entries {
		lines := entries[i].Lines
		sort.SliceStable(lines, func(a, b int) bool { return lines[a].LineNo < lines[b].LineNo })
		entries[i].Lines = lines
	}
	return entries
}

func optionalString(value any) *string {
	if value == nil || db.AsString(value) == "" {
		return nil
	}
	text := db.AsString(value)
	return &text
}

func optionalInt(value any) *int64 {
	if value == nil {
		return nil
	}
	parsed := db.AsInt(value)
	if parsed == 0 {
		return nil
	}
	return &parsed
}

// Flatten menbarkan entri menjadi daftar baris dengan konteks entri asalnya.
func Flatten(entries []Entry) []AmountedLine {
	lines := []AmountedLine{}
	for _, entry := range entries {
		for _, line := range entry.Lines {
			flat := line.AsLine()
			flat.Source = entry.Source
			flat.EntryDate = entry.EntryDate
			flat.VoucherNo = entry.VoucherNo
			flat.Description = entry.Description
			lines = append(lines, flat)
		}
	}
	return lines
}

// LinesFromRows membaca baris tabel journal_lines (termasuk kolom akun yang di-join).
func LinesFromRows(rows []db.Row) []AmountedLine {
	lines := make([]AmountedLine, 0, len(rows))
	for _, row := range rows {
		lines = append(lines, AmountedLine{
			AccountID:   db.AsInt(row["account_id"]),
			LineNo:      int(db.AsInt(row["line_no"])),
			Debit:       Amount(row["debit"]),
			Credit:      Amount(row["credit"]),
			Memo:        db.StringPtr(row["memo"]),
			Code:        optionalString(row["code"]),
			AccountName: optionalString(row["account_name"]),
		})
	}
	return lines
}

// LineInput adalah satu baris dari body permintaan; menerima account_id maupun accountId
// (frontend lama mengirim keduanya pada jalur berbeda) dan nominal berupa angka atau teks.
type LineInput struct {
	Raw db.Row
}

// LineInputsFromAny mengemas slice hasil dekode JSON menjadi baris input.
func LineInputsFromAny(items []any) []LineInput {
	inputs := make([]LineInput, 0, len(items))
	for _, item := range items {
		if row, ok := item.(db.Row); ok {
			inputs = append(inputs, LineInput{Raw: row})
		} else if row, ok := item.(map[string]any); ok {
			inputs = append(inputs, LineInput{Raw: row})
		}
	}
	return inputs
}

func (l LineInput) accountID() int64 {
	for _, key := range []string{"account_id", "accountId"} {
		if parsed := db.AsInt(l.Raw[key]); parsed != 0 {
			return parsed
		}
	}
	return 0
}

// NormalizeAndAssert memvalidasi baris jurnal dari permintaan HTTP.
// Pesan error identik dengan backend Node agar tampilan frontend tidak berubah.
func NormalizeAndAssert(items []LineInput) ([]AmountedLine, error) {
	if len(items) < 2 {
		return nil, errors.New("Jurnal harus memiliki sedikitnya dua baris.")
	}
	normalized := make([]AmountedLine, 0, len(items))
	for index, item := range items {
		if item.accountID() == 0 {
			return nil, fmt.Errorf("Baris %d: akun wajib dipilih.", index+1)
		}
		debit := Amount(item.Raw["debit"])
		credit := Amount(item.Raw["credit"])
		if debit < 0 || credit < 0 || (debit > 0 && credit > 0) || (debit == 0 && credit == 0) {
			return nil, fmt.Errorf("Baris %d: isi tepat salah satu kolom debit atau kredit.", index+1)
		}
		normalized = append(normalized, AmountedLine{
			AccountID: item.accountID(),
			LineNo:    index + 1,
			Debit:     debit,
			Credit:    credit,
			Memo:      db.StringPtr(item.Raw["memo"]),
			Code:      optionalString(item.Raw["code"]),
		})
	}
	return AssertBalanced(normalized)
}

// AssertBalanced memvalidasi aturan debit/kredit seimbang atas baris yang sudah normal.
func AssertBalanced(lines []AmountedLine) ([]AmountedLine, error) {
	if len(lines) < 2 {
		return nil, errors.New("Jurnal harus memiliki sedikitnya dua baris.")
	}
	for index, line := range lines {
		if line.AccountID == 0 {
			return nil, fmt.Errorf("Baris %d: akun wajib dipilih.", index+1)
		}
		if line.Debit < 0 || line.Credit < 0 || (line.Debit > 0 && line.Credit > 0) || (line.Debit == 0 && line.Credit == 0) {
			return nil, fmt.Errorf("Baris %d: isi tepat salah satu kolom debit atau kredit.", index+1)
		}
	}
	debit := float64(0)
	credit := float64(0)
	for _, line := range lines {
		debit = Amount(debit + line.Debit)
		credit = Amount(credit + line.Credit)
	}
	if math.Abs(debit-credit) >= MoneyEpsilon {
		return nil, fmt.Errorf("Jurnal tidak seimbang: debit %s dan kredit %s.", formatMoney(debit), formatMoney(credit))
	}
	return lines, nil
}

// formatMoney meniru String(number) JavaScript pada pesan tidak seimbang.
func formatMoney(value float64) string {
	return strconv.FormatFloat(value, 'f', -1, 64)
}

// Total akumulasi debit dan kredit satu akun.
type Total struct {
	Debit  float64
	Credit float64
}

// CalculateAccountBalances menjumlahkan debit/kredit per akun (termasuk akun tanpa mutasi).
func CalculateAccountBalances(accounts []Account, lines []AmountedLine) map[int64]Total {
	balances := map[int64]Total{}
	for _, account := range accounts {
		balances[account.ID] = Total{}
	}
	for _, line := range lines {
		current := balances[line.AccountID]
		current.Debit = Amount(current.Debit + line.Debit)
		current.Credit = Amount(current.Credit + line.Credit)
		balances[line.AccountID] = current
	}
	return balances
}

// AccountBalance saldo akun menurut arah saldo normalnya.
func AccountBalance(account Account, balances map[int64]Total) float64 {
	values := balances[account.ID]
	debit := Amount(values.Debit)
	credit := Amount(values.Credit)
	if account.NormalBalance == "DEBIT" {
		return Amount(debit - credit)
	}
	return Amount(credit - debit)
}

// TrialBalanceRow satu baris neraca saldo.
type TrialBalanceRow struct {
	AccountID     int64   `json:"accountId"`
	Code          string  `json:"code"`
	Name          string  `json:"name"`
	Group         string  `json:"group"`
	Debit         float64 `json:"debit"`
	Credit        float64 `json:"credit"`
	SignedBalance float64 `json:"signedBalance"`
}

// Totals jumlah debit dan kredit.
type Totals struct {
	Debit  float64 `json:"debit"`
	Credit float64 `json:"credit"`
}

// TrialBalanceResult keluaran laporan neraca saldo.
type TrialBalanceResult struct {
	Rows       []TrialBalanceRow `json:"rows"`
	Totals     Totals            `json:"totals"`
	IsBalanced bool              `json:"isBalanced"`
}

// BuildTrialBalance menyusun neraca saldo dari akun aktif yang memiliki mutasi.
func BuildTrialBalance(accounts []Account, lines []AmountedLine) TrialBalanceResult {
	balances := CalculateAccountBalances(accounts, lines)
	rows := []TrialBalanceRow{}
	for _, account := range accounts {
		if !account.IsActive {
			continue
		}
		balance := AccountBalance(account, balances)
		normalDebit := account.NormalBalance == "DEBIT"
		row := TrialBalanceRow{
			AccountID:     account.ID,
			Code:          account.Code,
			Name:          account.Name,
			Group:         account.Group,
			SignedBalance: balance,
		}
		if normalDebit {
			row.Debit = math.Max(balance, 0)
			row.Credit = math.Max(-balance, 0)
		} else {
			row.Debit = math.Max(-balance, 0)
			row.Credit = math.Max(balance, 0)
		}
		if row.Debit != 0 || row.Credit != 0 {
			rows = append(rows, row)
		}
	}
	debit := float64(0)
	credit := float64(0)
	for _, row := range rows {
		debit = Amount(debit + row.Debit)
		credit = Amount(credit + row.Credit)
	}
	return TrialBalanceResult{
		Rows:       rows,
		Totals:     Totals{Debit: debit, Credit: credit},
		IsBalanced: math.Abs(debit-credit) < MoneyEpsilon,
	}
}

// StatementRow baris laporan (kode, nama, jumlah).
type StatementRow struct {
	AccountID int64   `json:"accountId"`
	Code      string  `json:"code"`
	Name      string  `json:"name"`
	Amount    float64 `json:"amount"`
}

// IncomeStatement laporan laba rugi.
type IncomeStatement struct {
	Revenue      []StatementRow `json:"revenue"`
	Expenses     []StatementRow `json:"expenses"`
	RevenueTotal float64        `json:"revenueTotal"`
	ExpenseTotal float64        `json:"expenseTotal"`
	NetIncome    float64        `json:"netIncome"`
}

// BuildIncomeStatement menghitung laba rugi; jurnal penutup tidak dihitung ulang.
func BuildIncomeStatement(accounts []Account, lines []AmountedLine) IncomeStatement {
	operational := make([]AmountedLine, 0, len(lines))
	for _, line := range lines {
		if line.Source != "CLOSING" {
			operational = append(operational, line)
		}
	}
	balances := CalculateAccountBalances(accounts, operational)
	rowsFor := func(group string) []StatementRow {
		rows := []StatementRow{}
		for _, account := range accounts {
			if !account.IsActive || account.Group != group {
				continue
			}
			value := math.Max(0, AccountBalance(account, balances))
			if value != 0 {
				rows = append(rows, StatementRow{AccountID: account.ID, Code: account.Code, Name: account.Name, Amount: value})
			}
		}
		return rows
	}
	revenue := rowsFor("REVENUE")
	expenses := rowsFor("EXPENSE")
	revenueTotal := sumRows(revenue)
	expenseTotal := sumRows(expenses)
	return IncomeStatement{
		Revenue:      revenue,
		Expenses:     expenses,
		RevenueTotal: revenueTotal,
		ExpenseTotal: expenseTotal,
		NetIncome:    Amount(revenueTotal - expenseTotal),
	}
}

func sumRows(rows []StatementRow) float64 {
	total := float64(0)
	for _, row := range rows {
		total = Amount(total + row.Amount)
	}
	return total
}

// Section bagian neraca (aset, kewajiban, atau modal).
type Section struct {
	Rows  []StatementRow `json:"rows"`
	Total float64        `json:"total"`
}

// EquitySection bagian modal dengan laba belum ditutup.
type EquitySection struct {
	Rows           []StatementRow `json:"rows"`
	Total          float64        `json:"total"`
	UnclosedProfit float64        `json:"unclosedProfit"`
}

// BalanceSheet laporan neraca.
type BalanceSheet struct {
	Assets      Section       `json:"assets"`
	Liabilities Section       `json:"liabilities"`
	Equity      EquitySection `json:"equity"`
	Balanced    bool          `json:"balanced"`
}

// BuildBalanceSheet menyusun neraca dengan Prive sebagai pengurang modal.
func BuildBalanceSheet(accounts []Account, lines []AmountedLine) BalanceSheet {
	balances := CalculateAccountBalances(accounts, lines)
	sectionFor := func(group string) Section {
		rows := []StatementRow{}
		for _, account := range accounts {
			if !account.IsActive || account.Group != group {
				continue
			}
			value := AccountBalance(account, balances)
			if group == "EQUITY" && account.Subtype == "DRAWINGS" {
				value = -value
			}
			if value != 0 {
				rows = append(rows, StatementRow{AccountID: account.ID, Code: account.Code, Name: account.Name, Amount: value})
			}
		}
		return Section{Rows: rows, Total: sumRows(rows)}
	}
	assets := sectionFor("ASSET")
	liabilities := sectionFor("LIABILITY")
	equity := sectionFor("EQUITY")
	unclosed := BuildIncomeStatement(accounts, lines).NetIncome
	totalEquity := Amount(equity.Total + unclosed)
	return BalanceSheet{
		Assets:      assets,
		Liabilities: liabilities,
		Equity:      EquitySection{Rows: equity.Rows, Total: totalEquity, UnclosedProfit: unclosed},
		Balanced:    math.Abs(assets.Total-liabilities.Total-totalEquity) < MoneyEpsilon,
	}
}

// EquityChanges laporan perubahan modal.
type EquityChanges struct {
	Opening   float64 `json:"opening"`
	Capital   float64 `json:"capital"`
	Drawings  float64 `json:"drawings"`
	NetIncome float64 `json:"netIncome"`
	Closing   float64 `json:"closing"`
}

// BuildEquityChanges menghitung modal awal, tambah/kurang, dan modal akhir.
func BuildEquityChanges(accounts []Account, beforeLines, periodLines []AmountedLine) EquityChanges {
	before := CalculateAccountBalances(accounts, beforeLines)
	period := CalculateAccountBalances(accounts, periodLines)
	equityAccounts := []Account{}
	for _, account := range accounts {
		if account.Group == "EQUITY" && account.IsActive {
			equityAccounts = append(equityAccounts, account)
		}
	}
	equityTotal := func(balances map[int64]Total) float64 {
		total := float64(0)
		for _, account := range equityAccounts {
			value := AccountBalance(account, balances)
			if account.Subtype == "DRAWINGS" {
				value = -value
			}
			total = Amount(total + value)
		}
		return total
	}
	subtotal := func(balances map[int64]Total, subtype string, negate bool) float64 {
		total := float64(0)
		for _, account := range equityAccounts {
			if account.Subtype != subtype {
				continue
			}
			total = Amount(total + AccountBalance(account, balances))
		}
		if negate {
			return Amount(-total)
		}
		return Amount(total)
	}
	opening := equityTotal(before)
	capital := subtotal(period, "OWNER_CAPITAL", false)
	drawings := subtotal(period, "DRAWINGS", true)
	netIncome := BuildIncomeStatement(accounts, periodLines).NetIncome
	return EquityChanges{
		Opening:   opening,
		Capital:   capital,
		Drawings:  drawings,
		NetIncome: netIncome,
		Closing:   Amount(opening + capital + drawings + netIncome),
	}
}

// CashFlow arus kas metode langsung.
type CashFlow struct {
	Operating float64 `json:"operating"`
	Investing float64 `json:"investing"`
	Financing float64 `json:"financing"`
	NetChange float64 `json:"netChange"`
}

// BuildCashFlowDirect mengelompokkan mutasi kas menurut akun lawannya.
func BuildCashFlowDirect(accounts []Account, entries []Entry) CashFlow {
	byID := map[int64]Account{}
	for _, account := range accounts {
		byID[account.ID] = account
	}
	groups := map[string]float64{"OPERATING": 0, "INVESTING": 0, "FINANCING": 0}
	for _, entry := range entries {
		if entry.Source == "CLOSING" {
			continue
		}
		cashLines := []Line{}
		var nonCash *Line
		for i := range entry.Lines {
			line := entry.Lines[i]
			if byID[line.AccountID].IsCashAccount {
				cashLines = append(cashLines, line)
			} else if nonCash == nil {
				copied := line
				nonCash = &copied
			}
		}
		category := byID[nonCashAccountID(nonCash)].CashFlowCategory
		if category == "" {
			category = "OPERATING"
		}
		if _, ok := groups[category]; !ok {
			category = "OPERATING"
		}
		for _, line := range cashLines {
			groups[category] = Amount(groups[category] + Amount(line.Debit) - Amount(line.Credit))
		}
	}
	return CashFlow{
		Operating: groups["OPERATING"],
		Investing: groups["INVESTING"],
		Financing: groups["FINANCING"],
		NetChange: Amount(groups["OPERATING"] + groups["INVESTING"] + groups["FINANCING"]),
	}
}

func nonCashAccountID(line *Line) int64 {
	if line == nil {
		return 0
	}
	return line.AccountID
}

// MakeClosingLines menyusun jurnal penutup pendapatan dan beban ke laba ditahan.
func MakeClosingLines(accounts []Account, periodLines []AmountedLine) ([]AmountedLine, error) {
	balances := CalculateAccountBalances(accounts, periodLines)
	var retained *Account
	for i := range accounts {
		if accounts[i].Subtype == "RETAINED_EARNINGS" {
			retained = &accounts[i]
			break
		}
	}
	if retained == nil {
		return nil, errors.New("Akun laba ditahan belum tersedia.")
	}
	lines := []AmountedLine{}
	for _, account := range accounts {
		if account.Group != "REVENUE" && account.Group != "EXPENSE" {
			continue
		}
		balance := AccountBalance(account, balances)
		if math.Abs(balance) < MoneyEpsilon {
			continue
		}
		if account.Group == "REVENUE" {
			lines = append(lines, AmountedLine{AccountID: account.ID, Debit: balance, Credit: 0})
		} else {
			lines = append(lines, AmountedLine{AccountID: account.ID, Debit: 0, Credit: balance})
		}
	}
	if len(lines) == 0 {
		return []AmountedLine{}, nil
	}
	debit := float64(0)
	credit := float64(0)
	for _, line := range lines {
		debit = Amount(debit + line.Debit)
		credit = Amount(credit + line.Credit)
	}
	difference := Amount(debit - credit)
	if difference > 0 {
		lines = append(lines, AmountedLine{AccountID: retained.ID, Debit: 0, Credit: difference})
	}
	if difference < 0 {
		lines = append(lines, AmountedLine{AccountID: retained.ID, Debit: -difference, Credit: 0})
	}
	return AssertBalanced(lines)
}
