package httpapi

import (
	"net/http"
	"strings"

	"finova/internal/db"
)

// getCompany GET /api/company
func (s *Server) getCompany(w http.ResponseWriter, _ *http.Request) error {
	company, err := s.database.SelectOne("SELECT * FROM companies WHERE id = ?", s.companyID())
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]any{"company": company})
}

// putCompany PUT /api/company
func (s *Server) putCompany(w http.ResponseWriter, r *http.Request) error {
	body, err := readBody(r)
	if err != nil {
		return err
	}
	name := bodyText(body, "name")
	if name == "" {
		return fail(http.StatusUnprocessableEntity, "Nama perusahaan wajib diisi.")
	}
	fiscalYearStart := bodyInt(body, "fiscalYearStart")
	if fiscalYearStart == 0 {
		fiscalYearStart = 1
	}
	if _, err := s.database.Exec(
		"UPDATE companies SET name = ?, address = ?, phone = ?, email = ?, fiscal_year_start = ? WHERE id = ?",
		name, nullableText(body, "address"), nullableText(body, "phone"), nullableText(body, "email"),
		fiscalYearStart, s.companyID()); err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// nullableText mengirim NULL bila kunci tidak ada atau kosong, selain itu nilai apa adanya.
func nullableText(body db.Row, key string) any {
	value, ok := body[key]
	if !ok || value == nil {
		return nil
	}
	if text, isString := value.(string); isString && strings.TrimSpace(text) == "" {
		return nil
	}
	return value
}

// getAccounts GET /api/accounts
func (s *Server) getAccounts(w http.ResponseWriter, _ *http.Request) error {
	accounts, err := s.database.Select("SELECT * FROM accounts WHERE company_id = ? ORDER BY code", s.companyID())
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]any{"accounts": accounts})
}

// accountGroups daftar kelompok akun yang sah.
var accountGroups = map[string]bool{"ASSET": true, "LIABILITY": true, "EQUITY": true, "REVENUE": true, "EXPENSE": true}

// postAccount POST /api/accounts
func (s *Server) postAccount(w http.ResponseWriter, r *http.Request) error {
	body, err := readBody(r)
	if err != nil {
		return err
	}
	code := bodyText(body, "code")
	name := bodyText(body, "name")
	group := bodyText(body, "accountGroup")
	normalBalance := bodyText(body, "normalBalance")
	if code == "" || name == "" || !accountGroups[group] ||
		(normalBalance != "DEBIT" && normalBalance != "CREDIT") {
		return fail(http.StatusUnprocessableEntity, "Data akun tidak lengkap atau tidak valid.")
	}
	cashFlowCategory := bodyText(body, "cashFlowCategory")
	if cashFlowCategory == "" {
		cashFlowCategory = "OPERATING"
	}
	created, err := s.database.Exec(
		`INSERT INTO accounts (company_id, code, name, account_group, account_subtype, normal_balance, cash_flow_category, is_cash_account)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		s.companyID(), code, name, group, nullableText(body, "accountSubtype"), normalBalance, cashFlowCategory,
		bodyBool(body, "isCashAccount", false))
	if err != nil {
		return err
	}
	if err := s.audit(s.database, created.InsertID, "ACCOUNT", "CREATED", nil); err != nil {
		return err
	}
	return writeJSON(w, http.StatusCreated, map[string]any{"id": created.InsertID})
}

// putAccount PUT /api/accounts/{id}
func (s *Server) putAccount(w http.ResponseWriter, r *http.Request) error {
	body, err := readBody(r)
	if err != nil {
		return err
	}
	targetID := paramInt(r, "id")
	cashFlowCategory := bodyText(body, "cashFlowCategory")
	if cashFlowCategory == "" {
		cashFlowCategory = "OPERATING"
	}
	updated, err := s.database.Exec(
		"UPDATE accounts SET name = ?, account_subtype = ?, cash_flow_category = ?, is_cash_account = ?, is_active = ? WHERE id = ? AND company_id = ?",
		bodyRawText(body, "name"), nullableText(body, "accountSubtype"), cashFlowCategory,
		bodyBool(body, "isCashAccount", false), bodyBool(body, "isActive", true), targetID, s.companyID())
	if err != nil {
		return err
	}
	if updated.AffectedRows == 0 {
		return fail(http.StatusNotFound, "Akun tidak ditemukan.")
	}
	if err := s.audit(s.database, targetID, "ACCOUNT", "UPDATED", nil); err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// getPeriods GET /api/periods
func (s *Server) getPeriods(w http.ResponseWriter, _ *http.Request) error {
	periods, err := s.database.Select(
		"SELECT * FROM accounting_periods WHERE company_id = ? ORDER BY start_date DESC", s.companyID())
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]any{"periods": periods})
}

// postPeriod POST /api/periods
func (s *Server) postPeriod(w http.ResponseWriter, r *http.Request) error {
	body, err := readBody(r)
	if err != nil {
		return err
	}
	name := bodyText(body, "name")
	startDate := bodyText(body, "startDate")
	endDate := bodyText(body, "endDate")
	if name == "" || startDate == "" || endDate == "" || startDate > endDate {
		return fail(http.StatusUnprocessableEntity, "Nama dan rentang tanggal periode tidak valid.")
	}
	created, err := s.database.Exec(
		"INSERT INTO accounting_periods (company_id, name, start_date, end_date) VALUES (?, ?, ?, ?)",
		s.companyID(), name, startDate, endDate)
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusCreated, map[string]any{"id": created.InsertID})
}

// getTemplates GET /api/templates
func (s *Server) getTemplates(w http.ResponseWriter, _ *http.Request) error {
	rows, err := s.database.Select("SELECT * FROM journal_templates WHERE company_id = ? ORDER BY name", s.companyID())
	if err != nil {
		return err
	}
	templates := make([]db.Row, 0, len(rows))
	for _, row := range rows {
		lines := []any{}
		if err := decodeJSONField(row["lines_json"], &lines); err != nil {
			return err
		}
		copied := db.Row{}
		for key, value := range row {
			copied[key] = value
		}
		copied["lines"] = lines
		templates = append(templates, copied)
	}
	return writeJSON(w, http.StatusOK, map[string]any{"templates": templates})
}

// postTemplate POST /api/templates
func (s *Server) postTemplate(w http.ResponseWriter, r *http.Request) error {
	body, err := readBody(r)
	if err != nil {
		return err
	}
	name := bodyText(body, "name")
	lines, ok := body["lines"].([]any)
	if name == "" || !ok || len(lines) == 0 {
		return fail(http.StatusUnprocessableEntity, "Nama template dan baris jurnal wajib diisi.")
	}
	payload, err := encodeJSON(lines)
	if err != nil {
		return err
	}
	description := bodyText(body, "description")
	created, err := s.database.Exec(
		"INSERT INTO journal_templates (company_id, name, description, lines_json, created_by) VALUES (?, ?, ?, ?, ?)",
		s.companyID(), name, description, payload, s.operatorID)
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusCreated, map[string]any{"id": created.InsertID})
}

// deleteTemplate DELETE /api/templates/{id}
func (s *Server) deleteTemplate(w http.ResponseWriter, r *http.Request) error {
	if _, err := s.database.Exec("DELETE FROM journal_templates WHERE id = ? AND company_id = ?",
		paramInt(r, "id"), s.companyID()); err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
