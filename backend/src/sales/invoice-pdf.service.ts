import { Injectable } from '@nestjs/common';
import { lineMoney, moneyString } from '../common/money';

// pdfkit is a CommonJS package.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit');

const TEMPLATE_VERSION = '2';
const PAGE_WIDTH = 595.28;
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - (MARGIN * 2);

type InvoiceLanguage = 'ar' | 'en';

type PdfColumn = {
  key: 'name' | 'qty' | 'unitPrice' | 'total';
  x: number;
  width: number;
  align: 'left' | 'center' | 'right';
};

/**
 * Keep Arabic in logical Unicode order. PDFKit/fontkit applies the font's
 * Arabic shaping and bidi positioning. Pre-shaping or reversing the string
 * here would shape it twice and produce the disconnected glyphs seen in the
 * old invoice renderer.
 */
export function visualRtl(value: unknown) {
  return String(value ?? '').normalize('NFC');
}

function money(value: unknown) {
  try {
    return moneyString(String(value ?? 0));
  } catch {
    return '0.00';
  }
}

@Injectable()
export class InvoicePdfService {
  private readonly cache = new Map<string, Buffer>();

  async render(invoice: any, lang: InvoiceLanguage = 'ar'): Promise<Buffer> {
    const cacheKey = invoice?.id
      ? `${TEMPLATE_VERSION}:${invoice.id}:${lang}`
      : undefined;
    if (cacheKey && this.cache.has(cacheKey)) return this.cache.get(cacheKey)!;

    const pdf = await this.createDocument(invoice, lang);
    if (cacheKey) {
      this.cache.set(cacheKey, pdf);
      if (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value);
    }
    return pdf;
  }

  private createDocument(invoice: any, lang: InvoiceLanguage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margin: MARGIN,
        info: {
          Title: `Bold Invoice ${invoice.invoice_number || ''}`,
          Author: 'Bold',
          Subject: lang === 'ar' ? 'فاتورة مبيعات' : 'Sales invoice',
        },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('error', reject);
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      const regularFont = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf');
      const boldFont = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf');
      doc.registerFont('BoldRegular', regularFont);
      doc.registerFont('BoldStrong', boldFont);

      const isArabic = lang === 'ar';
      const text = (ar: string, en: string) => isArabic ? visualRtl(ar) : en;
      const branchName = isArabic
        ? invoice.branch?.name_ar || invoice.branch?.name_en || '—'
        : invoice.branch?.name_en || invoice.branch?.name_ar || '—';
      const customerName = invoice.customer?.name || invoice.customer?.phone || '—';
      const createdAt = new Date(invoice.created_at);
      const date = Number.isNaN(createdAt.getTime())
        ? '—'
        : new Intl.DateTimeFormat(isArabic ? 'ar-EG' : 'en-GB', {
          dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo',
        }).format(createdAt);

      doc.font('BoldStrong').fontSize(21).fillColor('#111827')
        .text(text('بولد – ملابس رجالي', 'Bold – Menswear'), MARGIN, 42, {
          width: CONTENT_WIDTH,
          align: isArabic ? 'right' : 'left',
        });
      doc.font('BoldRegular').fontSize(10).fillColor('#6b7280')
        .text(text('فاتورة مبيعات', 'Sales invoice'), MARGIN, 72, {
          width: CONTENT_WIDTH,
          align: isArabic ? 'right' : 'left',
        });

      doc.moveTo(MARGIN, 96).lineTo(MARGIN + CONTENT_WIDTH, 96).strokeColor('#d1d5db').stroke();
      const detailsY = 111;
      this.drawDetail(doc, text('رقم الفاتورة', 'Invoice number'), String(invoice.invoice_number || '—'), detailsY, isArabic);
      this.drawDetail(doc, text('الفرع', 'Branch'), isArabic ? visualRtl(branchName) : branchName, detailsY + 21, isArabic);
      this.drawDetail(doc, text('التاريخ', 'Date'), date, detailsY + 42, isArabic);
      this.drawDetail(doc, text('العميل', 'Customer'), isArabic ? visualRtl(customerName) : customerName, detailsY + 63, isArabic);

      const columns = this.columns(isArabic);
      let y = 203;
      y = this.drawTableHeader(doc, y, columns, isArabic);
      const items = Array.isArray(invoice.items) ? invoice.items : [];
      for (const item of items) {
        const rawName = isArabic
          ? item.variant?.product?.name_ar || item.variant?.product?.name_en || item.variant?.sku || item.variant_id || '—'
          : item.variant?.product?.name_en || item.variant?.product?.name_ar || item.variant?.sku || item.variant_id || '—';
        const values = {
          name: isArabic ? visualRtl(rawName) : String(rawName),
          qty: String(item.qty ?? 0),
          unitPrice: money(item.unit_price),
          total: lineMoney(
            String(item.unit_price ?? 0),
            Number(item.qty ?? 0),
          ).toFixed(2),
        };
        const nameColumn = columns.find((column) => column.key === 'name')!;
        const rowHeight = Math.max(28, doc.heightOfString(values.name, {
          width: nameColumn.width - 12,
          align: nameColumn.align,
        }) + 12);
        if (y + rowHeight > 716) {
          doc.addPage();
          y = this.drawTableHeader(doc, 48, columns, isArabic);
        }
        doc.rect(MARGIN, y, CONTENT_WIDTH, rowHeight).fillAndStroke('#ffffff', '#e5e7eb');
        doc.font('BoldRegular').fontSize(9).fillColor('#111827');
        for (const column of columns) {
          doc.text(values[column.key], column.x + 6, y + 7, {
            width: column.width - 12,
            align: column.align,
          });
        }
        y += rowHeight;
      }
      if (!items.length) {
        doc.rect(MARGIN, y, CONTENT_WIDTH, 36).fillAndStroke('#ffffff', '#e5e7eb');
        doc.font('BoldRegular').fontSize(9).fillColor('#6b7280')
          .text(text('لا توجد أصناف', 'No items'), MARGIN, y + 12, {
            width: CONTENT_WIDTH,
            align: 'center',
          });
        y += 36;
      }

      if (y > 610) {
        doc.addPage();
        y = 52;
      } else {
        y += 24;
      }
      const totalsX = isArabic ? MARGIN : MARGIN + CONTENT_WIDTH - 245;
      this.drawTotal(doc, text('المجموع الفرعي', 'Subtotal'), money(invoice.subtotal), totalsX, y, isArabic);
      this.drawTotal(doc, text('الخصم', 'Discount'), money(invoice.discount_amount), totalsX, y + 22, isArabic);
      this.drawTotal(doc, text('الضريبة', 'Tax'), money(invoice.tax_amount), totalsX, y + 44, isArabic);
      doc.rect(totalsX, y + 67, 245, 30).fill('#111827');
      doc.font('BoldStrong').fontSize(12).fillColor('#ffffff');
      doc.text(text('الإجمالي', 'Total'), totalsX + 10, y + 76, { width: 105, align: isArabic ? 'right' : 'left' });
      doc.text(`${money(invoice.total)} ${isArabic ? visualRtl('ج.م') : 'EGP'}`, totalsX + 120, y + 76, { width: 115, align: 'right' });

      const footerY = Math.min(760, y + 125);
      doc.font('BoldRegular').fontSize(8).fillColor('#6b7280')
        .text(text(
          'الإرجاع متاح خلال أربعة عشر يوماً وبحالة الشراء الأصلية.',
          'Returns are accepted within 14 days in original condition.',
        ), MARGIN, footerY, { width: CONTENT_WIDTH, align: isArabic ? 'right' : 'left' });
      doc.text(text('شكراً لتسوقكم في بولد', 'Thank you for shopping at Bold'), MARGIN, footerY + 15, {
        width: CONTENT_WIDTH,
        align: isArabic ? 'right' : 'left',
      });
      doc.end();
    });
  }

  private drawDetail(doc: any, label: string, value: string, y: number, isArabic: boolean) {
    const labelX = isArabic ? MARGIN + CONTENT_WIDTH - 135 : MARGIN;
    const valueX = isArabic ? MARGIN : MARGIN + 135;
    doc.font('BoldStrong').fontSize(9).fillColor('#374151')
      .text(label, labelX, y, { width: 125, align: isArabic ? 'right' : 'left' });
    doc.font('BoldRegular').fontSize(9).fillColor('#111827')
      .text(value, valueX, y, { width: CONTENT_WIDTH - 145, align: isArabic ? 'right' : 'left' });
  }

  private columns(isArabic: boolean): PdfColumn[] {
    if (isArabic) {
      return [
        { key: 'total', x: MARGIN, width: 105, align: 'right' },
        { key: 'unitPrice', x: MARGIN + 105, width: 100, align: 'right' },
        { key: 'qty', x: MARGIN + 205, width: 60, align: 'center' },
        { key: 'name', x: MARGIN + 265, width: 250, align: 'right' },
      ];
    }
    return [
      { key: 'name', x: MARGIN, width: 250, align: 'left' },
      { key: 'qty', x: MARGIN + 250, width: 60, align: 'center' },
      { key: 'unitPrice', x: MARGIN + 310, width: 100, align: 'right' },
      { key: 'total', x: MARGIN + 410, width: 105, align: 'right' },
    ];
  }

  private drawTableHeader(doc: any, y: number, columns: PdfColumn[], isArabic: boolean) {
    const labels = isArabic
      ? { name: visualRtl('الصنف'), qty: visualRtl('الكمية'), unitPrice: visualRtl('السعر'), total: visualRtl('الإجمالي') }
      : { name: 'Item', qty: 'Qty', unitPrice: 'Unit price', total: 'Total' };
    doc.rect(MARGIN, y, CONTENT_WIDTH, 28).fill('#111827');
    doc.font('BoldStrong').fontSize(9).fillColor('#ffffff');
    for (const column of columns) {
      doc.text(labels[column.key], column.x + 6, y + 9, {
        width: column.width - 12,
        align: column.align,
      });
    }
    return y + 28;
  }

  private drawTotal(doc: any, label: string, value: string, x: number, y: number, isArabic: boolean) {
    doc.font('BoldRegular').fontSize(9).fillColor('#374151');
    doc.text(label, x + 10, y + 5, { width: 105, align: isArabic ? 'right' : 'left' });
    doc.text(value, x + 120, y + 5, { width: 115, align: 'right' });
    doc.moveTo(x, y + 21).lineTo(x + 245, y + 21).strokeColor('#e5e7eb').stroke();
  }
}
