use super::*;
use printpdf::*;

fn draw_rect(ops: &mut Vec<Op>, x_mm: f32, y_mm: f32, w_mm: f32, h_mm: f32, r: f32, g: f32, b: f32) {
    ops.push(Op::SetFillColor {
        col: Color::Rgb(Rgb {
            r,
            g,
            b,
            icc_profile: None,
        }),
    });
    let rect = Rect::from_xywh(
        Mm(x_mm).into_pt(),
        Mm(y_mm).into_pt(),
        Mm(w_mm).into_pt(),
        Mm(h_mm).into_pt(),
    );
    ops.push(Op::DrawPolygon {
        polygon: rect.to_polygon(),
    });
}

fn draw_text(
    ops: &mut Vec<Op>,
    text: &str,
    size_pt: f32,
    x_mm: f32,
    y_mm: f32,
    font: BuiltinFont,
    r: f32,
    g: f32,
    b: f32,
) {
    ops.push(Op::StartTextSection);
    ops.push(Op::SetTextCursor {
        pos: Point::new(Mm(x_mm), Mm(y_mm)),
    });
    ops.push(Op::SetFont {
        font: PdfFontHandle::Builtin(font),
        size: Pt(size_pt),
    });
    ops.push(Op::SetLineHeight { lh: Pt(size_pt) });
    ops.push(Op::SetFillColor {
        col: Color::Rgb(Rgb {
            r,
            g,
            b,
            icc_profile: None,
        }),
    });
    ops.push(Op::ShowText {
        items: vec![TextItem::Text(text.to_string())],
    });
    ops.push(Op::EndTextSection);
}

pub fn journal_pdf(data: &JournalData) -> Result<Vec<u8>, String> {
    let signers = data.signers.clone().with_defaults();
    let mut pages = Vec::new();
    let mut ops = Vec::new();

    // Margins: left 14mm, top 14mm. In PDF, A4 height is 297mm.
    let mut y = 297.0 - 14.0;

    // Header
    let company_name = if data.company.is_empty() {
        "PT Finova Akuntansi Indonesia"
    } else {
        &data.company
    };

    draw_text(&mut ops, company_name, 14.0, 14.0, y - 5.0, BuiltinFont::HelveticaBold, 0.04, 0.35, 0.21);
    y -= 8.0;

    draw_text(&mut ops, "JURNAL UMUM (GENERAL JOURNAL)", 11.0, 14.0, y - 4.0, BuiltinFont::HelveticaBold, 0.12, 0.16, 0.23);
    y -= 7.0;

    let meta_text = format!(
        "Periode: {} s.d. {} | Dicetak: {}",
        data.from, data.to, data.printed_on
    );
    draw_text(&mut ops, &meta_text, 9.0, 14.0, y - 3.5, BuiltinFont::HelveticaOblique, 0.39, 0.45, 0.55);
    y -= 9.0;

    // Table Columns:
    let col_x = [
        14.0,
        14.0 + 20.0,
        14.0 + 20.0 + 24.0,
        14.0 + 20.0 + 24.0 + 68.0,
        14.0 + 20.0 + 24.0 + 68.0 + 14.0,
        14.0 + 20.0 + 24.0 + 68.0 + 14.0 + 28.0,
    ];

    // Table Header
    draw_rect(&mut ops, 14.0, y - 8.0, 182.0, 8.0, 0.05, 0.44, 0.27);
    let titles = ["Tanggal", "No. Bukti", "Keterangan Akun & Transaksi", "Ref", "Debit (Rp)", "Kredit (Rp)"];
    for (i, t) in titles.iter().enumerate() {
        draw_text(&mut ops, *t, 9.0, col_x[i] + 2.0, y - 5.5, BuiltinFont::HelveticaBold, 1.0, 1.0, 1.0);
    }
    y -= 8.0;

    // Rows
    for entry in &data.entries {
        if y < 35.0 {
            pages.push(PdfPage::new(Mm(210.0), Mm(297.0), std::mem::take(&mut ops)));
            y = 297.0 - 16.0;
        }

        let row_h = 7.0;
        if entry.alternate {
            draw_rect(&mut ops, 14.0, y - row_h, 182.0, row_h, 0.97, 0.98, 0.99);
        }

        if entry.show_head {
            draw_text(&mut ops, &entry.date, 8.0, col_x[0] + 1.0, y - 5.0, BuiltinFont::Helvetica, 0.12, 0.16, 0.23);
            draw_text(&mut ops, &entry.voucher, 8.0, col_x[1] + 1.0, y - 5.0, BuiltinFont::Helvetica, 0.12, 0.16, 0.23);
        }

        let mut acc = entry.account.clone();
        if entry.is_credit {
            acc = format!("  » {}", acc.trim_start_matches("     » ").trim_start_matches("     ↳ "));
        }
        let max_len = 38;
        let display_acc = if acc.chars().count() > max_len {
            format!("{}...", acc.chars().take(max_len).collect::<String>())
        } else {
            acc
        };

        let font = if entry.is_credit { BuiltinFont::Helvetica } else { BuiltinFont::HelveticaBold };
        draw_text(&mut ops, &display_acc, 8.0, col_x[2] + 1.0, y - 5.0, font, 0.12, 0.16, 0.23);
        draw_text(&mut ops, &entry.ref_code, 8.0, col_x[3] + 2.0, y - 5.0, BuiltinFont::Helvetica, 0.12, 0.16, 0.23);

        if entry.debit > 0.0 {
            let debit_str = format_idr(entry.debit);
            draw_text(&mut ops, &debit_str, 8.0, col_x[4] + 2.0, y - 5.0, BuiltinFont::Helvetica, 0.12, 0.16, 0.23);
        } else {
            draw_text(&mut ops, "-", 8.0, col_x[4] + 10.0, y - 5.0, BuiltinFont::Helvetica, 0.12, 0.16, 0.23);
        }

        if entry.credit > 0.0 {
            let credit_str = format_idr(entry.credit);
            draw_text(&mut ops, &credit_str, 8.0, col_x[5] + 2.0, y - 5.0, BuiltinFont::Helvetica, 0.12, 0.16, 0.23);
        } else {
            draw_text(&mut ops, "-", 8.0, col_x[5] + 10.0, y - 5.0, BuiltinFont::Helvetica, 0.12, 0.16, 0.23);
        }

        y -= row_h;
    }

    // Total Row
    let tot_h = 8.0;
    draw_rect(&mut ops, 14.0, y - tot_h, 182.0, tot_h, 0.94, 0.99, 0.96);
    draw_text(&mut ops, "TOTAL", 9.0, col_x[2] + 1.0, y - 5.5, BuiltinFont::HelveticaBold, 0.05, 0.44, 0.27);
    draw_text(&mut ops, &format_idr(data.total_debit), 8.5, col_x[4] + 1.0, y - 5.5, BuiltinFont::HelveticaBold, 0.05, 0.44, 0.27);
    draw_text(&mut ops, &format_idr(data.total_credit), 8.5, col_x[5] + 1.0, y - 5.5, BuiltinFont::HelveticaBold, 0.05, 0.44, 0.27);
    y -= tot_h + 10.0;

    // Check if recap fits, otherwise new page
    if !data.recap.is_empty() {
        if y < 70.0 {
            pages.push(PdfPage::new(Mm(210.0), Mm(297.0), std::mem::take(&mut ops)));
            y = 297.0 - 16.0;
        }

        draw_text(&mut ops, "REKAPITULASI JURNAL UMUM", 10.0, 14.0, y - 5.0, BuiltinFont::HelveticaBold, 0.12, 0.16, 0.23);
        y -= 8.0;

        let rec_x = [14.0, 14.0 + 55.0, 14.0 + 55.0 + 36.0, 14.0 + 55.0 + 36.0 + 55.0];

        draw_rect(&mut ops, 14.0, y - 7.0, 182.0, 7.0, 0.01, 0.52, 0.78);
        let rec_titles = ["Akun Debit", "Jumlah (Rp)", "Akun Kredit", "Jumlah (Rp)"];
        for (i, t) in rec_titles.iter().enumerate() {
            draw_text(&mut ops, *t, 8.5, rec_x[i] + 2.0, y - 5.0, BuiltinFont::HelveticaBold, 1.0, 1.0, 1.0);
        }
        y -= 7.0;

        let max_len = data.recap.debits.len().max(data.recap.credits.len());
        for i in 0..max_len {
            if y < 35.0 {
                pages.push(PdfPage::new(Mm(210.0), Mm(297.0), std::mem::take(&mut ops)));
                y = 297.0 - 16.0;
            }

            if let Some(d) = data.recap.debits.get(i) {
                let label = format!("{} - {}", d.code, d.name);
                draw_text(&mut ops, &label, 8.0, rec_x[0] + 1.0, y - 4.5, BuiltinFont::Helvetica, 0.12, 0.16, 0.23);
                draw_text(&mut ops, &format_idr(d.amount), 8.0, rec_x[1] + 1.0, y - 4.5, BuiltinFont::Helvetica, 0.12, 0.16, 0.23);
            }
            if let Some(c) = data.recap.credits.get(i) {
                let label = format!("{} - {}", c.code, c.name);
                draw_text(&mut ops, &label, 8.0, rec_x[2] + 1.0, y - 4.5, BuiltinFont::Helvetica, 0.12, 0.16, 0.23);
                draw_text(&mut ops, &format_idr(c.amount), 8.0, rec_x[3] + 1.0, y - 4.5, BuiltinFont::Helvetica, 0.12, 0.16, 0.23);
            }
            y -= 6.0;
        }

        // Recap total
        draw_rect(&mut ops, 14.0, y - 7.0, 182.0, 7.0, 0.95, 0.97, 0.99);
        draw_text(&mut ops, "TOTAL DEBIT", 8.5, rec_x[0] + 1.0, y - 5.0, BuiltinFont::HelveticaBold, 0.01, 0.52, 0.78);
        draw_text(&mut ops, &format_idr(data.recap.total_debit), 8.5, rec_x[1] + 1.0, y - 5.0, BuiltinFont::HelveticaBold, 0.01, 0.52, 0.78);
        draw_text(&mut ops, "TOTAL KREDIT", 8.5, rec_x[2] + 1.0, y - 5.0, BuiltinFont::HelveticaBold, 0.01, 0.52, 0.78);
        draw_text(&mut ops, &format_idr(data.recap.total_credit), 8.5, rec_x[3] + 1.0, y - 5.0, BuiltinFont::HelveticaBold, 0.01, 0.52, 0.78);
        y -= 15.0;
    }

    // Signatures
    if y < 45.0 {
        pages.push(PdfPage::new(Mm(210.0), Mm(297.0), std::mem::take(&mut ops)));
        y = 297.0 - 25.0;
    }

    draw_text(&mut ops, "Dibuat Oleh,", 9.0, 25.0, y, BuiltinFont::Helvetica, 0.12, 0.16, 0.23);
    draw_text(&mut ops, "Diperiksa Oleh,", 9.0, 90.0, y, BuiltinFont::Helvetica, 0.12, 0.16, 0.23);
    draw_text(&mut ops, "Disetujui Oleh,", 9.0, 155.0, y, BuiltinFont::Helvetica, 0.12, 0.16, 0.23);

    let maker_text = format!("( {} )", signers.maker);
    let checker_text = format!("( {} )", signers.checker);
    let approver_text = format!("( {} )", signers.approver);
    draw_text(&mut ops, &maker_text, 9.0, 25.0, y - 18.0, BuiltinFont::HelveticaBold, 0.12, 0.16, 0.23);
    draw_text(&mut ops, &checker_text, 9.0, 90.0, y - 18.0, BuiltinFont::HelveticaBold, 0.12, 0.16, 0.23);
    draw_text(&mut ops, &approver_text, 9.0, 155.0, y - 18.0, BuiltinFont::HelveticaBold, 0.12, 0.16, 0.23);

    pages.push(PdfPage::new(Mm(210.0), Mm(297.0), ops));

    let mut doc = PdfDocument::new(&format!("Jurnal Umum - {}", data.company));
    let bytes = doc.with_pages(pages).save(&PdfSaveOptions::default(), &mut Vec::new());
    Ok(bytes)
}
