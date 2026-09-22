package domain

import (
	"math"
	"strings"
	"testing"

	"finova/internal/db"
)

// fixtureAccounts meniru bagan akun uji pada server/accounting.test.ts.
func fixtureAccounts() []Account {
	return []Account{
		{ID: 1, Code: "1100", Name: "Kas", Group: "ASSET", Subtype: "CASH", NormalBalance: "DEBIT", IsCashAccount: true, IsActive: true, CashFlowCategory: "OPERATING"},
		{ID: 2, Code: "3100", Name: "Modal", Group: "EQUITY", Subtype: "OWNER_CAPITAL", NormalBalance: "CREDIT", IsActive: true, CashFlowCategory: "FINANCING"},
		{ID: 3, Code: "3300", Name: "Laba Ditahan", Group: "EQUITY", Subtype: "RETAINED_EARNINGS", NormalBalance: "CREDIT", IsActive: true, CashFlowCategory: "OPERATING"},
		{ID: 4, Code: "4100", Name: "Pendapatan", Group: "REVENUE", Subtype: "SERVICE_REVENUE", NormalBalance: "CREDIT", IsActive: true, CashFlowCategory: "OPERATING"},
		{ID: 5, Code: "5200", Name: "Beban Gaji", Group: "EXPENSE", Subtype: "SALARY", NormalBalance: "DEBIT", IsActive: true, CashFlowCategory: "OPERATING"},
		{ID: 6, Code: "3200", Name: "Prive", Group: "EQUITY", Subtype: "DRAWINGS", NormalBalance: "DEBIT", IsActive: true, CashFlowCategory: "FINANCING"},
	}
}

func lines(pairs ...[3]float64) []AmountedLine {
	result := []AmountedLine{}
	for _, pair := range pairs {
		result = append(result, AmountedLine{AccountID: int64(pair[0]), Debit: pair[1], Credit: pair[2]})
	}
	return result
}

var (
	capitalLines   = lines([3]float64{1, 5000000, 0}, [3]float64{2, 0, 5000000})
	incomeLines    = lines([3]float64{1, 1000000, 0}, [3]float64{4, 0, 1000000})
	expenseLines   = lines([3]float64{5, 400000, 0}, [3]float64{1, 0, 400000})
	drawingsLines  = lines([3]float64{6, 200000, 0}, [3]float64{1, 0, 200000})
	allFixtureLine = append(append(append(append([]AmountedLine{}, capitalLines...), incomeLines...), expenseLines...), drawingsLines...)
)

func fixtureEntries() []Entry {
	asLine := func(items []AmountedLine) []Line {
		converted := make([]Line, 0, len(items))
		for index, item := range items {
			converted = append(converted, Line{AccountID: item.AccountID, LineNo: index + 1, Debit: item.Debit, Credit: item.Credit})
		}
		return converted
	}
	return []Entry{
		{ID: 1, VoucherNo: "JU-001", EntryDate: "2026-01-01", Source: "MANUAL", Status: "POSTED", Lines: asLine(capitalLines)},
		{ID: 2, VoucherNo: "JU-002", EntryDate: "2026-01-02", Source: "MANUAL", Status: "POSTED", Lines: asLine(incomeLines)},
		{ID: 3, VoucherNo: "JU-003", EntryDate: "2026-01-03", Source: "MANUAL", Status: "POSTED", Lines: asLine(expenseLines)},
		{ID: 4, VoucherNo: "JU-004", EntryDate: "2026-01-04", Source: "MANUAL", Status: "POSTED", Lines: asLine(drawingsLines)},
	}
}

func TestAssertBalancedAcceptsPairedAndRejectsUnbalanced(t *testing.T) {
	accepted, err := AssertBalanced(incomeLines)
	if err != nil || len(accepted) != 2 {
		t.Fatalf("jurnal berpasangan harus diterima, error=%v jumlah=%d", err, len(accepted))
	}
	_, err = AssertBalanced(lines([3]float64{1, 100, 0}, [3]float64{4, 0, 99}))
	if err == nil || !strings.Contains(err.Error(), "Jurnal tidak seimbang") {
		t.Fatalf("harus menolak jurnal tidak seimbang, dapat=%v", err)
	}
	if !strings.Contains(err.Error(), "debit 100 dan kredit 99") {
		t.Fatalf("pesan harus memuat jumlah, dapat=%q", err.Error())
	}
}

func TestAssertBalancedRejectsSingleSidedRows(t *testing.T) {
	_, err := AssertBalanced(lines([3]float64{1, 100, 50}, [3]float64{4, 0, 50}))
	if err == nil || !strings.Contains(err.Error(), "isi tepat salah satu kolom debit atau kredit") {
		t.Fatalf("baris dengan debit dan kredit sekaligus harus ditolak, dapat=%v", err)
	}
	_, err = AssertBalanced(lines([3]float64{1, 100, 0}))
	if err == nil || !strings.Contains(err.Error(), "sedikitnya dua baris") {
		t.Fatalf("satu baris harus ditolak, dapat=%v", err)
	}
}

func TestBuildTrialBalanceBalances(t *testing.T) {
	report := BuildTrialBalance(fixtureAccounts(), allFixtureLine)
	if report.Totals.Debit != 6000000 || report.Totals.Credit != 6000000 {
		t.Fatalf("total neraca saldo salah: %+v", report.Totals)
	}
	if !report.IsBalanced {
		t.Fatal("neraca saldo harus seimbang")
	}
}

func TestBuildTrialBalanceMovesOppositeBalanceToOtherSide(t *testing.T) {
	report := BuildTrialBalance(fixtureAccounts(), lines([3]float64{1, 0, 150000}, [3]float64{4, 150000, 0}))
	for _, want := range []struct {
		accountID int64
		debit     float64
		credit    float64
	}{
		{1, 0, 150000},
		{4, 150000, 0},
	} {
		row, found := rowByAccount(report.Rows, want.accountID)
		if !found {
			t.Fatalf("akun %d tidak ada pada neraca saldo", want.accountID)
		}
		if row.Debit != want.debit || row.Credit != want.credit {
			t.Fatalf("akun %d: debit=%v kredit=%v, ingin %v/%v", want.accountID, row.Debit, row.Credit, want.debit, want.credit)
		}
	}
}

func rowByAccount(rows []TrialBalanceRow, accountID int64) (TrialBalanceRow, bool) {
	for _, row := range rows {
		if row.AccountID == accountID {
			return row, true
		}
	}
	return TrialBalanceRow{}, false
}

func TestIncomeStatementAndBalanceSheet(t *testing.T) {
	income := BuildIncomeStatement(fixtureAccounts(), append(append([]AmountedLine{}, incomeLines...), expenseLines...))
	if income.NetIncome != 600000 {
		t.Fatalf("laba bersih harus 600000, dapat %v", income.NetIncome)
	}
	balance := BuildBalanceSheet(fixtureAccounts(), allFixtureLine)
	if balance.Assets.Total != 5400000 {
		t.Fatalf("total aset harus 5400000, dapat %v", balance.Assets.Total)
	}
	if balance.Equity.Total != 5400000 {
		t.Fatalf("total modal harus 5400000, dapat %v", balance.Equity.Total)
	}
	if !balance.Balanced {
		t.Fatal("neraca harus seimbang")
	}
}

func TestEquityChangesTreatsDrawingsAsReduction(t *testing.T) {
	report := BuildEquityChanges(
		fixtureAccounts(),
		capitalLines,
		append(append(append([]AmountedLine{}, incomeLines...), expenseLines...), drawingsLines...),
	)
	if report.Opening != 5000000 || report.Drawings != -200000 || report.NetIncome != 600000 || report.Closing != 5400000 {
		t.Fatalf("perubahan modal salah: %+v", report)
	}
}

func TestCashFlowGroupsByCounterAccount(t *testing.T) {
	report := BuildCashFlowDirect(fixtureAccounts(), fixtureEntries())
	if report.Operating != 600000 || report.Financing != 4800000 || report.NetChange != 5400000 {
		t.Fatalf("arus kas salah: %+v", report)
	}
}

func TestMakeClosingLinesBalancesToRetainedEarnings(t *testing.T) {
	closing, err := MakeClosingLines(fixtureAccounts(), append(append([]AmountedLine{}, incomeLines...), expenseLines...))
	if err != nil {
		t.Fatalf("jurnal penutup gagal: %v", err)
	}
	debit := 0.0
	credit := 0.0
	retainedCredit := 0.0
	for _, line := range closing {
		debit = Amount(debit + line.Debit)
		credit = Amount(credit + line.Credit)
		if line.AccountID == 3 {
			retainedCredit = line.Credit
		}
	}
	if debit != 1000000 || credit != 1000000 {
		t.Fatalf("jurnal penutup tidak seimbang: debit=%v kredit=%v", debit, credit)
	}
	if retainedCredit != 600000 {
		t.Fatalf("laba ditahan harus dikredit 600000, dapat %v", retainedCredit)
	}
}

func TestMakeClosingLinesRequiresRetainedEarnings(t *testing.T) {
	accounts := fixtureAccounts()
	trimmed := []Account{}
	for _, account := range accounts {
		if account.Subtype != "RETAINED_EARNINGS" {
			trimmed = append(trimmed, account)
		}
	}
	_, err := MakeClosingLines(trimmed, incomeLines)
	if err == nil || !strings.Contains(err.Error(), "laba ditahan") {
		t.Fatalf("harus menolak tanpa akun laba ditahan, dapat=%v", err)
	}
}

func TestRoundMoneyMatchesJavaScriptMathRound(t *testing.T) {
	// Nilai harapan dihitung ulang dengan rumus backend Node:
	//   Math.round((value + Number.EPSILON) * 100) / 100
	cases := []struct{ in, want float64 }{
		{100000.004, 100000},
		{33333.339, 33333.34},
		{0.125, 0.13},
		{2.5, 2.5},
		{-0.5, -0.5},
		{1500000, 1500000},
	}
	for _, item := range cases {
		if got := RoundMoney(item.in); math.Abs(got-item.want) > 1e-9 {
			t.Fatalf("RoundMoney(%v)=%v, ingin %v", item.in, got, item.want)
		}
	}
}

func TestGroupJournalRowsKeepsFlagsAndOrder(t *testing.T) {
	row := func(overrides db.Row) db.Row {
		base := db.Row{
			"entry_id": int64(1), "voucher_no": "JRN-202602-001", "entry_date": "2026-02-15",
			"description": "Pembelian perlengkapan", "source": "MANUAL", "status": "POSTED",
			"reversal_of_id": nil, "reversed": int64(0), "account_id": int64(1), "line_no": int64(1),
			"debit": float64(100000), "credit": float64(0), "memo": nil, "code": "1100", "account_name": "Kas",
		}
		for key, value := range overrides {
			base[key] = value
		}
		return base
	}
	entries := GroupJournalRows([]db.Row{
		row(nil),
		row(db.Row{"account_id": int64(5), "line_no": int64(2), "debit": float64(0), "credit": float64(100000), "code": "2100", "account_name": "Utang Usaha"}),
		row(db.Row{"entry_id": int64(2), "voucher_no": "JRN-202602-002", "status": "DRAFT", "line_no": int64(1)}),
		row(db.Row{"entry_id": int64(3), "voucher_no": "REV-JRN-202602-001", "source": "REVERSAL", "reversal_of_id": int64(1), "reversed": int64(1), "line_no": int64(1)}),
	})
	if len(entries) != 3 {
		t.Fatalf("harus 3 entri, dapat %d", len(entries))
	}
	if entries[0].Reversed || entries[0].ReversalOfID != nil || len(entries[0].Lines) != 2 {
		t.Fatalf("entri pertama salah: %+v", entries[0])
	}
	if entries[1].Status != "DRAFT" {
		t.Fatalf("entri kedua harus DRAFT, dapat %v", entries[1].Status)
	}
	if !entries[2].Reversed || entries[2].ReversalOfID == nil || *entries[2].ReversalOfID != 1 {
		t.Fatalf("entri ketiga harus menandai pembalik: %+v", entries[2])
	}
	if len(GroupJournalRows([]db.Row{})) != 0 {
		t.Fatal("tanpa baris harus menghasilkan daftar kosong")
	}
}

func TestGroupJournalRowsSortsRoundsAndTruncatesDate(t *testing.T) {
	base := func(lineNo int, debit, credit float64) db.Row {
		return db.Row{
			"entry_id": int64(1), "voucher_no": "JRN-1", "entry_date": "2026-02-15 08:30:00",
			"description": "Uji", "source": "MANUAL", "status": "POSTED", "reversed": int64(0),
			"account_id": int64(1), "line_no": int64(lineNo), "debit": debit, "credit": credit,
			"memo": nil, "code": "1100", "account_name": "Kas",
		}
	}
	entries := GroupJournalRows([]db.Row{
		base(3, 0, 33333.339),
		base(1, 100000.004, 0),
		base(2, 0, 66666.666),
	})
	if entries[0].EntryDate != "2026-02-15" {
		t.Fatalf("tanggal harus dipotong menjadi ISO, dapat %q", entries[0].EntryDate)
	}
	wantLineNo := []int{1, 2, 3}
	wantDebit := []float64{100000, 0, 0}
	for i, line := range entries[0].Lines {
		if line.LineNo != wantLineNo[i] {
			t.Fatalf("urutan baris %d salah: %+v", i, entries[0].Lines)
		}
		if line.Debit != wantDebit[i] {
			t.Fatalf("debit baris %d = %v, ingin %v", i, line.Debit, wantDebit[i])
		}
	}
	if entries[0].Lines[2].Credit != 33333.34 {
		t.Fatalf("pembulatan kredit salah: %v", entries[0].Lines[2].Credit)
	}
}
