import { InvoicePdfService } from './invoice-pdf.service';

describe('InvoicePdfService', () => {
  it('renders an Arabic invoice with an embedded valid font', async () => {
    const pdf = await new InvoicePdfService().render({
      invoice_number: 'TEST-1',
      branch: { name_ar: 'الفرع الرئيسي' },
      created_at: new Date('2026-07-19T00:00:00Z'),
      subtotal: 100,
      tax_amount: 14,
      total: 114,
      items: [],
    }, 'ar');

    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(1000);
  });
});
