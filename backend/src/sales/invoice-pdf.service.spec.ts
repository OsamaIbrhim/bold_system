import { InvoicePdfService, visualRtl } from './invoice-pdf.service';

const fixture = {
  id: '0fdba71a-d512-4578-b433-58bc7fe17250',
  invoice_number: 'B-MAIN-2026-0001',
  branch: { name_ar: 'الفرع الرئيسي', name_en: 'Main branch' },
  customer: { name: 'أحمد علي', phone: '01012345678' },
  created_at: new Date('2026-07-19T12:30:00Z'),
  subtotal: 200,
  discount_amount: 10,
  tax_amount: 26.6,
  total: 216.6,
  items: [{
    variant_id: '9efb55c1-7f45-49ad-84ad-d1e5d785f2fc',
    qty: 2,
    unit_price: 100,
    variant: {
      sku: 'TSHIRT-001',
      product: { name_ar: 'قميص رجالي أزرق', name_en: 'Blue mens shirt' },
    },
  }],
};

describe('InvoicePdfService', () => {
  it.each(['ar', 'en'] as const)('renders a complete %s invoice with embedded Unicode fonts', async (language) => {
    const pdf = await new InvoicePdfService().render(fixture, language);

    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(10_000);
    expect(pdf.toString('latin1')).toContain('DejaVuSans');
  });

  it('keeps Arabic in logical Unicode order for PDFKit shaping', () => {
    const rendered = visualRtl('فاتورة رقم: B-MAIN-2026-0001');

    expect(rendered).toContain('B-MAIN-2026-0001');
    expect(rendered).not.toContain('\uFFFD');
    expect(rendered).toBe('فاتورة رقم: B-MAIN-2026-0001');
  });

  it('paginates a large invoice instead of overlapping lines', async () => {
    const invoice = {
      ...fixture,
      id: 'b6f39324-2f31-401e-b256-4011279c20f0',
      items: Array.from({ length: 80 }, (_, index) => ({
        ...fixture.items[0],
        variant_id: `variant-${index}`,
        variant: {
          sku: `SKU-${index}`,
          product: {
            name_ar: `قميص رجالي أزرق طويل رقم ${index}`,
            name_en: `Long blue mens shirt number ${index}`,
          },
        },
      })),
    };

    const pdf = await new InvoicePdfService().render(invoice, 'ar');
    const pageCount = (pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
    expect(pageCount).toBeGreaterThan(1);
  });

  it('caches completed invoices by id and language', async () => {
    const service = new InvoicePdfService();
    const first = await service.render(fixture, 'en');
    const second = await service.render(fixture, 'en');

    expect(second).toBe(first);
  });
});
