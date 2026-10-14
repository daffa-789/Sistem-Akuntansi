use super::*;
use rust_xlsxwriter::{Color, Format, FormatBorder, Workbook};

pub fn journal_template() -> Result<Vec<u8>, rust_xlsxwriter::XlsxError> {
    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();
    worksheet.set_name("Jurnal")?;

    let header_fmt = Format::new()
        .set_bold()
        .set_background_color(Color::RGB(0x0A5835))
        .set_font_color(Color::RGB(0xFFFFFF));

    let headers = [
        ("NoBukti", 16.0),
        ("Tanggal", 14.0),
        ("KodeAkun", 12.0),
        ("NamaAkun", 28.0),
        ("Debit", 16.0),
        ("Kredit", 16.0),
        ("Keterangan", 32.0),
    ];

    for (col, (title, width)) in headers.iter().enumerate() {
        worksheet.write_with_format(0, col as u16, *title, &header_fmt)?;
        worksheet.set_column_width(col as u16, *width)?;
    }

    // Sample data
    let samples = [
        ("JU-001", "2026-01-01", "1100", "Kas", 5000000.0, 0.0, "Setoran Modal Awal"),
        ("JU-001", "2026-01-01", "3100", "Modal Pemilik", 0.0, 5000000.0, "Setoran Modal Awal"),
        ("JU-002", "2026-01-02", "1300", "Perlengkapan Kantor", 250000.0, 0.0, "Beli Alat Tulis Kantor"),
        ("JU-002", "2026-01-02", "1100", "Kas", 0.0, 250000.0, "Beli Alat Tulis Kantor"),
    ];

    for (row_idx, s) in samples.iter().enumerate() {
        let r = (row_idx + 1) as u32;
        worksheet.write(r, 0, s.0)?;
        worksheet.write(r, 1, s.1)?;
        worksheet.write(r, 2, s.2)?;
        worksheet.write(r, 3, s.3)?;
        worksheet.write(r, 4, s.4)?;
        worksheet.write(r, 5, s.5)?;
        worksheet.write(r, 6, s.6)?;
    }

    let buffer = workbook.save_to_buffer()?;
    Ok(buffer)
}

pub fn journal_workbook(data: &JournalData) -> Result<Vec<u8>, rust_xlsxwriter::XlsxError> {
    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();
    worksheet.set_name("Jurnal Umum")?;

    let title_fmt = Format::new()
        .set_bold()
        .set_font_size(14.0)
        .set_font_color(Color::RGB(0x0A5835));
    let subtitle_fmt = Format::new().set_bold().set_font_size(11.0);
    let meta_fmt = Format::new()
        .set_italic()
        .set_font_size(9.0)
        .set_font_color(Color::RGB(0x64748B));

    let header_fmt = Format::new()
        .set_bold()
        .set_background_color(Color::RGB(0x0E7042))
        .set_font_color(Color::RGB(0xFFFFFF))
        .set_border(FormatBorder::Thin);

    let bold_border = Format::new().set_bold().set_border(FormatBorder::Thin);
    let normal_border = Format::new().set_border(FormatBorder::Thin);
    let money_border = Format::new()
        .set_border(FormatBorder::Thin)
        .set_num_format("#,##0.00");

    let company = if data.company.is_empty() {
        "PT Finova Akuntansi Indonesia"
    } else {
        &data.company
    };

    worksheet.write_with_format(0, 0, company, &title_fmt)?;
    worksheet.write_with_format(1, 0, "JURNAL UMUM (GENERAL JOURNAL)", &subtitle_fmt)?;
    worksheet.write_with_format(
        2,
        0,
        format!("Periode: {} s.d. {} | Dicetak: {}", data.from, data.to, data.printed_on),
        &meta_fmt,
    )?;

    let columns = [
        ("Tanggal", 14.0),
        ("No. Bukti", 16.0),
        ("Keterangan Akun & Transaksi", 36.0),
        ("Ref", 10.0),
        ("Debit (Rp)", 18.0),
        ("Kredit (Rp)", 18.0),
    ];

    for (col, (name, width)) in columns.iter().enumerate() {
        worksheet.write_with_format(4, col as u16, *name, &header_fmt)?;
        worksheet.set_column_width(col as u16, *width)?;
    }

    let mut current_row = 5;
    for entry in &data.entries {
        let r = current_row as u32;
        let mut account_name = entry.account.clone();
        if entry.is_credit {
            account_name = format!("     ↳ {}", account_name.trim_start_matches("     » ").trim_start_matches("     ↳ "));
        }

        let desc = if !entry.line_memo.is_empty() {
            format!("{}\n({})", account_name, entry.line_memo)
        } else if !entry.end_memo.is_empty() && entry.show_head {
            format!("{}\n({})", account_name, entry.end_memo)
        } else {
            account_name
        };

        if entry.show_head {
            worksheet.write_with_format(r, 0, &entry.date, &normal_border)?;
            worksheet.write_with_format(r, 1, &entry.voucher, &normal_border)?;
        } else {
            worksheet.write_with_format(r, 0, "", &normal_border)?;
            worksheet.write_with_format(r, 1, "", &normal_border)?;
        }

        worksheet.write_with_format(r, 2, &desc, &normal_border)?;
        worksheet.write_with_format(r, 3, &entry.ref_code, &normal_border)?;

        if entry.debit > 0.0 {
            worksheet.write_with_format(r, 4, entry.debit, &money_border)?;
        } else {
            worksheet.write_with_format(r, 4, "-", &normal_border)?;
        }

        if entry.credit > 0.0 {
            worksheet.write_with_format(r, 5, entry.credit, &money_border)?;
        } else {
            worksheet.write_with_format(r, 5, "-", &normal_border)?;
        }

        current_row += 1;
    }

    // Row TOTAL
    let total_fmt = Format::new()
        .set_bold()
        .set_border(FormatBorder::Thin)
        .set_border_bottom(FormatBorder::Double)
        .set_background_color(Color::RGB(0xF0FDF4));
    let total_money_fmt = Format::new()
        .set_bold()
        .set_border(FormatBorder::Thin)
        .set_border_bottom(FormatBorder::Double)
        .set_background_color(Color::RGB(0xF0FDF4))
        .set_num_format("#,##0.00");

    let tot_r = current_row as u32;
    worksheet.write_with_format(tot_r, 0, "", &total_fmt)?;
    worksheet.write_with_format(tot_r, 1, "", &total_fmt)?;
    worksheet.write_with_format(tot_r, 2, "TOTAL", &total_fmt)?;
    worksheet.write_with_format(tot_r, 3, "", &total_fmt)?;
    worksheet.write_with_format(tot_r, 4, data.total_debit, &total_money_fmt)?;
    worksheet.write_with_format(tot_r, 5, data.total_credit, &total_money_fmt)?;

    current_row += 3;

    // Rekapitulasi Jurnal Umum jika ada
    if !data.recap.is_empty() {
        let recap_title_fmt = Format::new().set_bold().set_font_size(10.0);
        let recap_header_fmt = Format::new()
            .set_bold()
            .set_background_color(Color::RGB(0x0284C7))
            .set_font_color(Color::RGB(0xFFFFFF))
            .set_border(FormatBorder::Thin);

        worksheet.write_with_format(current_row as u32, 0, "REKAPITULASI JURNAL UMUM", &recap_title_fmt)?;
        current_row += 1;

        worksheet.write_with_format(current_row as u32, 0, "Akun Debit", &recap_header_fmt)?;
        worksheet.write_with_format(current_row as u32, 1, "Jumlah", &recap_header_fmt)?;
        worksheet.write_with_format(current_row as u32, 2, "Akun Kredit", &recap_header_fmt)?;
        worksheet.write_with_format(current_row as u32, 3, "Jumlah", &recap_header_fmt)?;
        current_row += 1;

        let max_len = data.recap.debits.len().max(data.recap.credits.len());
        for i in 0..max_len {
            let r = current_row as u32;
            if let Some(d) = data.recap.debits.get(i) {
                worksheet.write_with_format(r, 0, format!("{} - {}", d.code, d.name), &normal_border)?;
                worksheet.write_with_format(r, 1, d.amount, &money_border)?;
            } else {
                worksheet.write_with_format(r, 0, "", &normal_border)?;
                worksheet.write_with_format(r, 1, "", &normal_border)?;
            }
            if let Some(c) = data.recap.credits.get(i) {
                worksheet.write_with_format(r, 2, format!("{} - {}", c.code, c.name), &normal_border)?;
                worksheet.write_with_format(r, 3, c.amount, &money_border)?;
            } else {
                worksheet.write_with_format(r, 2, "", &normal_border)?;
                worksheet.write_with_format(r, 3, "", &normal_border)?;
            }
            current_row += 1;
        }

        let rec_tot = current_row as u32;
        worksheet.write_with_format(rec_tot, 0, "TOTAL DEBIT", &bold_border)?;
        worksheet.write_with_format(rec_tot, 1, data.recap.total_debit, &total_money_fmt)?;
        worksheet.write_with_format(rec_tot, 2, "TOTAL KREDIT", &bold_border)?;
        worksheet.write_with_format(rec_tot, 3, data.recap.total_credit, &total_money_fmt)?;
        current_row += 3;
    }

    // Signatures
    let sig_r = current_row as u32;
    worksheet.write(sig_r, 0, "Dibuat Oleh,")?;
    worksheet.write(sig_r, 2, "Diperiksa Oleh,")?;
    worksheet.write(sig_r, 4, "Disetujui Oleh,")?;

    worksheet.write(sig_r + 4, 0, format!("( {} )", data.signers.maker))?;
    worksheet.write(sig_r + 4, 2, format!("( {} )", data.signers.checker))?;
    worksheet.write(sig_r + 4, 4, format!("( {} )", data.signers.approver))?;

    let buffer = workbook.save_to_buffer()?;
    Ok(buffer)
}

pub fn ledger_workbook(data: &LedgerData) -> Result<Vec<u8>, rust_xlsxwriter::XlsxError> {
    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();
    worksheet.set_name("Buku Besar")?;

    let title_fmt = Format::new()
        .set_bold()
        .set_font_size(14.0)
        .set_font_color(Color::RGB(0x0A5835));
    let subtitle_fmt = Format::new().set_bold().set_font_size(11.0);
    let header_fmt = Format::new()
        .set_bold()
        .set_background_color(Color::RGB(0x0E7042))
        .set_font_color(Color::RGB(0xFFFFFF))
        .set_border(FormatBorder::Thin);
    let normal_border = Format::new().set_border(FormatBorder::Thin);
    let money_border = Format::new()
        .set_border(FormatBorder::Thin)
        .set_num_format("#,##0.00");

    worksheet.write_with_format(0, 0, &data.company, &title_fmt)?;
    worksheet.write_with_format(1, 0, format!("BUKU BESAR: {}", data.account_label), &subtitle_fmt)?;
    worksheet.write(2, 0, format!("Periode: {} s.d. {} | Saldo Normal: {}", data.from, data.to, data.normal_balance))?;

    let cols = [
        ("Tanggal", 14.0),
        ("No. Bukti", 16.0),
        ("Keterangan", 36.0),
        ("Debit (Rp)", 18.0),
        ("Kredit (Rp)", 18.0),
        ("Saldo (Rp)", 18.0),
    ];

    for (c, (t, w)) in cols.iter().enumerate() {
        worksheet.write_with_format(4, c as u16, *t, &header_fmt)?;
        worksheet.set_column_width(c as u16, *w)?;
    }

    let mut r = 5;
    // Saldo Awal
    worksheet.write_with_format(r, 0, &data.from, &normal_border)?;
    worksheet.write_with_format(r, 1, "-", &normal_border)?;
    worksheet.write_with_format(r, 2, "Saldo Awal", &normal_border)?;
    worksheet.write_with_format(r, 3, "-", &normal_border)?;
    worksheet.write_with_format(r, 4, "-", &normal_border)?;
    worksheet.write_with_format(r, 5, data.opening, &money_border)?;
    r += 1;

    for row in &data.rows {
        worksheet.write_with_format(r, 0, &row.date, &normal_border)?;
        worksheet.write_with_format(r, 1, &row.voucher, &normal_border)?;
        worksheet.write_with_format(r, 2, &row.description, &normal_border)?;
        if row.debit > 0.0 {
            worksheet.write_with_format(r, 3, row.debit, &money_border)?;
        } else {
            worksheet.write_with_format(r, 3, "-", &normal_border)?;
        }
        if row.credit > 0.0 {
            worksheet.write_with_format(r, 4, row.credit, &money_border)?;
        } else {
            worksheet.write_with_format(r, 4, "-", &normal_border)?;
        }
        worksheet.write_with_format(r, 5, row.balance, &money_border)?;
        r += 1;
    }

    let buffer = workbook.save_to_buffer()?;
    Ok(buffer)
}

pub fn trial_balance_workbook(data: &TrialBalanceData) -> Result<Vec<u8>, rust_xlsxwriter::XlsxError> {
    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();
    worksheet.set_name("Neraca Saldo")?;

    let title_fmt = Format::new()
        .set_bold()
        .set_font_size(14.0)
        .set_font_color(Color::RGB(0x0A5835));
    let subtitle_fmt = Format::new().set_bold().set_font_size(11.0);
    let header_fmt = Format::new()
        .set_bold()
        .set_background_color(Color::RGB(0x0E7042))
        .set_font_color(Color::RGB(0xFFFFFF))
        .set_border(FormatBorder::Thin);
    let normal_border = Format::new().set_border(FormatBorder::Thin);
    let money_border = Format::new()
        .set_border(FormatBorder::Thin)
        .set_num_format("#,##0.00");

    worksheet.write_with_format(0, 0, &data.company, &title_fmt)?;
    worksheet.write_with_format(1, 0, "NERACA SALDO (TRIAL BALANCE)", &subtitle_fmt)?;
    worksheet.write(2, 0, format!("Per Tanggal: {}", data.as_of))?;

    let cols = [
        ("Kode Akun", 14.0),
        ("Nama Akun", 32.0),
        ("Kelompok", 16.0),
        ("Debit (Rp)", 18.0),
        ("Kredit (Rp)", 18.0),
    ];

    for (c, (t, w)) in cols.iter().enumerate() {
        worksheet.write_with_format(4, c as u16, *t, &header_fmt)?;
        worksheet.set_column_width(c as u16, *w)?;
    }

    let mut r = 5;
    for row in &data.rows {
        worksheet.write_with_format(r, 0, &row.code, &normal_border)?;
        worksheet.write_with_format(r, 1, &row.name, &normal_border)?;
        worksheet.write_with_format(r, 2, &row.group, &normal_border)?;
        if row.debit > 0.0 {
            worksheet.write_with_format(r, 3, row.debit, &money_border)?;
        } else {
            worksheet.write_with_format(r, 3, "-", &normal_border)?;
        }
        if row.credit > 0.0 {
            worksheet.write_with_format(r, 4, row.credit, &money_border)?;
        } else {
            worksheet.write_with_format(r, 4, "-", &normal_border)?;
        }
        r += 1;
    }

    let total_fmt = Format::new()
        .set_bold()
        .set_border(FormatBorder::Thin)
        .set_border_bottom(FormatBorder::Double)
        .set_background_color(Color::RGB(0xF0FDF4));
    let total_money_fmt = Format::new()
        .set_bold()
        .set_border(FormatBorder::Thin)
        .set_border_bottom(FormatBorder::Double)
        .set_background_color(Color::RGB(0xF0FDF4))
        .set_num_format("#,##0.00");

    worksheet.write_with_format(r, 0, "", &total_fmt)?;
    worksheet.write_with_format(r, 1, "TOTAL", &total_fmt)?;
    worksheet.write_with_format(r, 2, "", &total_fmt)?;
    worksheet.write_with_format(r, 3, data.total_debit, &total_money_fmt)?;
    worksheet.write_with_format(r, 4, data.total_credit, &total_money_fmt)?;

    let buffer = workbook.save_to_buffer()?;
    Ok(buffer)
}

pub fn accounts_workbook(data: &AccountsData) -> Result<Vec<u8>, rust_xlsxwriter::XlsxError> {
    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();
    worksheet.set_name("Bagan Akun")?;

    let title_fmt = Format::new()
        .set_bold()
        .set_font_size(14.0)
        .set_font_color(Color::RGB(0x0A5835));
    let header_fmt = Format::new()
        .set_bold()
        .set_background_color(Color::RGB(0x0E7042))
        .set_font_color(Color::RGB(0xFFFFFF))
        .set_border(FormatBorder::Thin);
    let normal_border = Format::new().set_border(FormatBorder::Thin);

    worksheet.write_with_format(0, 0, &data.company, &title_fmt)?;
    worksheet.write_with_format(1, 0, "BAGAN AKUN STANDAR (CHART OF ACCOUNTS)", &title_fmt)?;

    let cols = [
        ("Kode", 12.0),
        ("Nama Akun", 32.0),
        ("Kelompok", 16.0),
        ("Subtipe", 20.0),
        ("Saldo Normal", 14.0),
        ("Kategori Arus Kas", 18.0),
        ("Kas/Bank", 14.0),
    ];

    for (c, (t, w)) in cols.iter().enumerate() {
        worksheet.write_with_format(3, c as u16, *t, &header_fmt)?;
        worksheet.set_column_width(c as u16, *w)?;
    }

    let mut r = 4;
    for row in &data.rows {
        worksheet.write_with_format(r, 0, &row.code, &normal_border)?;
        worksheet.write_with_format(r, 1, &row.name, &normal_border)?;
        worksheet.write_with_format(r, 2, &row.group, &normal_border)?;
        worksheet.write_with_format(r, 3, &row.subtype, &normal_border)?;
        worksheet.write_with_format(r, 4, &row.normal_balance, &normal_border)?;
        worksheet.write_with_format(r, 5, &row.cash_flow, &normal_border)?;
        worksheet.write_with_format(r, 6, &row.cash_label, &normal_border)?;
        r += 1;
    }

    let buffer = workbook.save_to_buffer()?;
    Ok(buffer)
}
