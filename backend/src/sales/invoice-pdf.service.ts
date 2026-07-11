import { Injectable } from '@nestjs/common';
import * as PDFDocument from 'pdfkit';
import * as fs from 'fs';
import * as path from 'path';
// @ts-ignore
import * as ArabicReshaper from 'arabic-persian-reshaper';

@Injectable()
export class InvoicePdfService {
  async render(invoice: any, lang: 'ar' | 'en' = 'ar'): Promise<Buffer> {
    return new Promise((resolve) => {
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      // Arabic font – place Cairo-Regular.ttf in backend/assets/fonts/
      // Download: https://github.com/google/fonts/raw/main/ofl/cairo/Cairo-Regular.ttf
      const fontPath = path.join(process.cwd(), 'assets', 'fonts', 'Cairo-Regular.ttf');
      const hasArabicFont = fs.existsSync(fontPath);
      if (hasArabicFont) { doc.registerFont('Arabic', fontPath); doc.font('Arabic'); }

      const isAr = lang === 'ar';
      const ar = (s: string) => {
        if (!isAr) return s;
        try { return ArabicReshaper.convertArabic(s); } catch { return s.split('').reverse().join(''); }
      };

      // Header
      doc.fontSize(20).text(isAr ? ar('بولد – ملابس رجالي') : 'Bold – Menswear', { align: isAr ? 'right' : 'left' });
      doc.fontSize(12).text(isAr ? ar(`فاتورة رقم: ${invoice.invoice_number}`) : `Invoice: ${invoice.invoice_number}`, { align: isAr ? 'right' : 'left' });
      doc.moveDown(0.5);
      doc.fontSize(10);
      doc.text(isAr ? ar(`الفرع: ${invoice.branch?.name_ar || ''}`) : `Branch: ${invoice.branch?.name_en || ''}`);
      doc.text(isAr ? ar(`التاريخ: ${new Date(invoice.created_at).toLocaleString('ar-EG')}`) : `Date: ${new Date(invoice.created_at).toISOString()}`);
      if (invoice.customer) doc.text((isAr ? ar('العميل: ') : 'Customer: ') + (invoice.customer.phone || invoice.customer.name || ''));
      doc.moveDown();

      // Items
      if (isAr) doc.text(ar('الصنف | الكمية | السعر | الإجمالي'));
      else doc.text('Item | Qty | Price | Total');
      doc.moveDown(0.3);
      for (const it of invoice.items || []) {
        const name = it.variant?.product?.name_en || it.variant_id.slice(0,8);
        const line = isAr
          ? `${(it.unit_price * it.qty).toFixed(2)} ج | ${it.unit_price} ج | ${it.qty} | ${name}`
          : `${name} | ${it.qty} | ${it.unit_price} | ${(it.unit_price * it.qty).toFixed(2)} EGP`;
        doc.text(isAr ? ar(line) : line);
      }
      doc.moveDown();
      doc.fontSize(12).text((isAr ? ar('المجموع الفرعي: ') : 'Subtotal: ') + Number(invoice.subtotal).toFixed(2) + (isAr ? ' ج' : ' EGP'));
      doc.text((isAr ? ar('الضريبة 14%: ') : 'Tax 14%: ') + Number(invoice.tax_amount).toFixed(2));
      doc.fontSize(14).text((isAr ? ar('الإجمالي: ') : 'Total: ') + Number(invoice.total).toFixed(2) + (isAr ? ' ج' : ' EGP'), { underline: true });
      doc.moveDown();
      doc.fontSize(9).text(isAr ? ar('سياسة الإرجاع: 14 يوم بحالة الشراء الأصلية – قانون حماية المستهلك المصري') : 'Returns: 14 days in original condition – Egyptian Consumer Protection Law');
      doc.text(isAr ? ar('شكراً لتسوقكم في Bold') : 'Thank you for shopping at Bold');
      if (!hasArabicFont && isAr) {
        doc.moveDown().fontSize(8).fillColor('red').text('Note: Add backend/assets/fonts/Cairo-Regular.ttf for perfect Arabic shaping – currently using reshaper fallback');
      }
      doc.end();
    });
  }
}
