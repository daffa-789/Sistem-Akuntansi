package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"finova/internal/db"
	"finova/internal/domain"
)

// decodeJSONField mengurai kolom TEXT berisi JSON menjadi nilai Go.
func decodeJSONField(value any, target any) error {
	if value == nil {
		return nil
	}
	raw := db.AsString(value)
	if raw == "" {
		return nil
	}
	return json.Unmarshal([]byte(raw), target)
}

// encodeJSON mengemas nilai menjadi teks JSON untuk kolom *_json.
func encodeJSON(value any) (string, error) {
	buffer, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	return string(buffer), nil
}

// postJournal POST /api/journals
func (s *Server) postJournal(w http.ResponseWriter, r *http.Request) error {
	body, err := readBody(r)
	if err != nil {
		return err
	}
	voucherNo := bodyText(body, "voucherNo")
	entryDate := bodyText(body, "entryDate")
	description := bodyText(body, "description")
	status := bodyText(body, "status")
	if status == "" {
		status = "DRAFT"
	}
	if description == "" || entryDate == "" || (status != "DRAFT" && status != "POSTED") {
		return fail(http.StatusUnprocessableEntity, "Tanggal, keterangan, dan status jurnal tidak valid.")
	}
	lines, err := bodyLines(body)
	if err != nil {
		return err
	}
	normalized, err := domain.NormalizeAndAssert(lines)
	if err != nil {
		return fail(http.StatusUnprocessableEntity, err.Error())
	}
	if voucherNo == "" {
		if len(entryDate) >= 7 {
			yearMonth := strings.ReplaceAll(entryDate[:7], "-", "")
			if voucherNo, err = s.nextVoucher(s.database, yearMonth); err != nil {
				return err
			}
		}
		if voucherNo == "" {
			return fail(http.StatusUnprocessableEntity, "Tanggal jurnal tidak valid.")
		}
	}
	var createdID int64
	err = s.database.WithTransaction(func(tx *db.Tx) error {
		id, err := s.writeEntry(tx, writeEntryParams{
			userID:      s.operatorID,
			voucherNo:   voucherNo,
			entryDate:   entryDate,
			description: description,
			source:      "MANUAL",
			status:      status,
			lines:       normalized,
		})
		createdID = id
		return err
	})
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusCreated, map[string]any{"id": createdID, "voucherNo": voucherNo})
}

// getJournal GET /api/journals/{id}
func (s *Server) getJournal(w http.ResponseWriter, r *http.Request) error {
	entry, err := s.fetchEntry(s.database, paramInt(r, "id"))
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]any{"entry": entry})
}

// actionLabels label aksi untuk jejak audit, sama seperti backend lama.
var actionLabels = map[string]string{
	"CREATED":  "Jurnal dibuat",
	"POSTED":   "Jurnal diposting",
	"UPDATED":  "Jurnal diubah",
	"REVERSED": "Jurnal dibalikkan",
}

// journalAudit GET /api/journals/{id}/audit
func (s *Server) journalAudit(w http.ResponseWriter, r *http.Request) error {
	id := paramInt(r, "id")
	logs, err := s.database.Select(
		`SELECT a.*, u.name AS user_name FROM audit_logs a
		 LEFT JOIN users u ON u.id = a.user_id
		 WHERE a.company_id = ? AND a.entity_type = ? AND a.entity_id = ? ORDER BY a.created_at DESC`,
		s.companyID(), "JOURNAL_ENTRY", id)
	if err != nil {
		return err
	}
	for _, log := range logs {
		action := db.AsString(log["action"])
		label, ok := actionLabels[action]
		if !ok {
			label = action
		}
		log["action_label"] = label
	}
	return writeJSON(w, http.StatusOK, map[string]any{"logs": logs})
}

// putJournal PUT /api/journals/{id} — hanya draft yang boleh diubah.
func (s *Server) putJournal(w http.ResponseWriter, r *http.Request) error {
	body, err := readBody(r)
	if err != nil {
		return err
	}
	id := paramInt(r, "id")
	voucherNo := bodyText(body, "voucherNo")
	entryDate := bodyText(body, "entryDate")
	description := bodyText(body, "description")
	lines, err := bodyLines(body)
	if err != nil {
		return err
	}
	normalized, err := domain.NormalizeAndAssert(lines)
	if err != nil {
		return fail(http.StatusUnprocessableEntity, err.Error())
	}
	err = s.database.WithTransaction(func(tx *db.Tx) error {
		entry, err := s.fetchEntry(tx, id)
		if err != nil {
			return err
		}
		if db.AsString(entry["status"]) != "DRAFT" {
			return fail(http.StatusUnprocessableEntity, "Hanya jurnal draft yang dapat diubah.")
		}
		period, err := s.getOpenPeriod(tx, entryDate)
		if err != nil {
			return err
		}
		if _, err := s.getAccountsForLines(tx, normalized); err != nil {
			return err
		}
		entryID := db.AsInt(entry["id"])
		if _, err := tx.Exec(
			"UPDATE journal_entries SET voucher_no = ?, entry_date = ?, period_id = ?, description = ? WHERE id = ?",
			voucherNo, entryDate, db.AsInt(period["id"]), description, entryID); err != nil {
			return err
		}
		if _, err := tx.Exec("DELETE FROM journal_lines WHERE journal_entry_id = ?", entryID); err != nil {
			return err
		}
		for index, line := range normalized {
			var memo any
			if line.Memo != nil && *line.Memo != "" {
				memo = *line.Memo
			}
			if _, err := tx.Exec(
				"INSERT INTO journal_lines (journal_entry_id, account_id, line_no, memo, debit, credit) VALUES (?, ?, ?, ?, ?, ?)",
				entryID, line.AccountID, index+1, memo, line.Debit, line.Credit); err != nil {
				return err
			}
		}
		return s.audit(tx, entryID, "JOURNAL_ENTRY", "UPDATED", nil)
	})
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// postJournalFlag POST /api/journals/{id}/post
func (s *Server) postJournalFlag(w http.ResponseWriter, r *http.Request) error {
	id := paramInt(r, "id")
	err := s.database.WithTransaction(func(tx *db.Tx) error {
		entry, err := s.fetchEntry(tx, id)
		if err != nil {
			return err
		}
		if db.AsString(entry["status"]) != "DRAFT" {
			return fail(http.StatusUnprocessableEntity, "Jurnal ini sudah diposting.")
		}
		if _, err := s.getOpenPeriod(tx, domain.DateText(entry["entry_date"])); err != nil {
			return err
		}
		if _, err := domain.AssertBalanced(entryLines(entry)); err != nil {
			return fail(http.StatusUnprocessableEntity, err.Error())
		}
		entryID := db.AsInt(entry["id"])
		if _, err := tx.Exec(
			"UPDATE journal_entries SET status = 'POSTED', posted_by = ?, posted_at = datetime('now', 'localtime') WHERE id = ?",
			s.operatorID, entryID); err != nil {
			return err
		}
		return s.audit(tx, entryID, "JOURNAL_ENTRY", "POSTED", nil)
	})
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// deleteJournal DELETE /api/journals/{id}
func (s *Server) deleteJournal(w http.ResponseWriter, r *http.Request) error {
	id := paramInt(r, "id")
	err := s.database.WithTransaction(func(tx *db.Tx) error {
		entry, err := s.fetchEntry(tx, id)
		if err != nil {
			return err
		}
		entryID := db.AsInt(entry["id"])
		// Menghapus jurnal terposting akan memusnahkan jejak audit; koreksi lewat pembalik.
		if db.AsString(entry["status"]) != "DRAFT" {
			return fail(http.StatusUnprocessableEntity, fmt.Sprintf(
				"Jurnal %s sudah diposting sehingga tidak dapat dihapus tanpa menghapus jejak audit. Gunakan Jurnal Pembalik.",
				db.AsString(entry["voucher_no"])))
		}
		if db.AsString(entry["source"]) != "MANUAL" {
			return fail(http.StatusUnprocessableEntity, "Jurnal hasil impor, penutup, atau pembalik tidak dapat dihapus. Buat jurnal koreksi manual.")
		}
		if _, err := tx.Exec("DELETE FROM journal_lines WHERE journal_entry_id = ?", entryID); err != nil {
			return err
		}
		if _, err := tx.Exec("DELETE FROM journal_entries WHERE id = ?", entryID); err != nil {
			return err
		}
		return s.audit(tx, entryID, "JOURNAL_ENTRY", "DELETED", nil)
	})
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// reverseJournal POST /api/journals/{id}/reverse — membuat jurnal pembalik terposting.
func (s *Server) reverseJournal(w http.ResponseWriter, r *http.Request) error {
	body, err := readBody(r)
	if err != nil {
		return err
	}
	id := paramInt(r, "id")
	var reversalID int64
	err = s.database.WithTransaction(func(tx *db.Tx) error {
		original, err := s.fetchEntry(tx, id)
		if err != nil {
			return err
		}
		if db.AsString(original["status"]) != "POSTED" {
			return fail(http.StatusUnprocessableEntity, "Hanya jurnal terposting yang dapat dibalik.")
		}
		existing, err := tx.SelectOne(
			"SELECT id FROM journal_entries WHERE company_id = ? AND reversal_of_id = ? LIMIT 1",
			s.companyID(), db.AsInt(original["id"]))
		if err != nil {
			return err
		}
		if existing != nil {
			return fail(http.StatusUnprocessableEntity, fmt.Sprintf(
				"Jurnal %s sudah memiliki pembalik dan tidak dapat dibalik dua kali.",
				db.AsString(original["voucher_no"])))
		}
		originalLines := entryLines(original)
		mirrored := make([]domain.AmountedLine, 0, len(originalLines))
		for _, line := range originalLines {
			mirrored = append(mirrored, domain.AmountedLine{
				AccountID: line.AccountID,
				LineNo:    line.LineNo,
				Debit:     line.Credit,
				Credit:    line.Debit,
				Memo:      line.Memo,
			})
		}
		voucherNo := bodyText(body, "voucherNo")
		if voucherNo == "" {
			voucherNo = "REV-" + db.AsString(original["voucher_no"])
		}
		entryDate := bodyText(body, "entryDate")
		if entryDate == "" {
			entryDate = domain.DateText(original["entry_date"])
		}
		created, err := s.writeEntry(tx, writeEntryParams{
			userID:       s.operatorID,
			voucherNo:    voucherNo,
			entryDate:    entryDate,
			description:  "Pembalik: " + db.AsString(original["description"]),
			source:       "REVERSAL",
			status:       "POSTED",
			lines:        mirrored,
			reversalOfID: db.AsInt(original["id"]),
		})
		reversalID = created
		return err
	})
	if err != nil {
		return err
	}
	if err := s.audit(s.database, id, "JOURNAL_ENTRY", "REVERSED", map[string]any{"reversalEntryId": reversalID}); err != nil {
		return err
	}
	return writeJSON(w, http.StatusCreated, map[string]any{"id": reversalID})
}

// nextVoucherHandler GET /api/journals/next-voucher
func (s *Server) nextVoucherHandler(w http.ResponseWriter, _ *http.Request) error {
	yearMonth := time.Now().Format("200601")
	voucherNo, err := s.nextVoucher(s.database, yearMonth)
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]any{"voucherNo": voucherNo})
}
