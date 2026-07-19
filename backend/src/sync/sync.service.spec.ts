import { SyncService } from './sync.service';

describe('SyncService incremental synchronization', () => {
  const variant = {
    id: 'variant-1', product_id: 'product-1', sku: 'SKU-1', cost_price: 100,
    barcode_ean13: '123', barcode_internal: 'B-1', size: 'M', color: 'Blue',
    product: { is_active: true, name_en: 'Shirt', name_ar: 'قميص', category_id: null, brand: null },
  };
  const quote = { net_price: 150, tax_amount: 21 };

  it('returns one initial snapshot with a resumable cursor and bulk prices', async () => {
    const prisma = {
      syncChange: { aggregate: jest.fn().mockResolvedValue({ _max: { sequence: 42n } }) },
      productVariant: { findMany: jest.fn().mockResolvedValue([variant]) },
      inventoryStock: { findMany: jest.fn().mockResolvedValue([{ branch_id: 'branch-1', variant_id: variant.id, qty_on_hand: 5 }]) },
    };
    const pricing = {
      loadActiveRules: jest.fn().mockResolvedValue([]),
      quoteMany: jest.fn().mockReturnValue(new Map([[variant.id, quote]])),
    };
    const result = await new SyncService(prisma as any, pricing as any).pull('branch-1');
    expect(result).toMatchObject({ mode: 'snapshot', cursor: '42', reset_products: true, reset_stock: true });
    expect(result.products).toHaveLength(1);
    expect(pricing.loadActiveRules).toHaveBeenCalledTimes(1);
    expect(pricing.quoteMany).toHaveBeenCalledTimes(1);
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it('captures the snapshot cursor before starting catalog reads', async () => {
    let releaseCursor!: (value: any) => void;
    const cursor = new Promise((resolve) => { releaseCursor = resolve; });
    const prisma = {
      syncChange: { aggregate: jest.fn().mockReturnValue(cursor) },
      productVariant: { findMany: jest.fn().mockResolvedValue([]) },
      inventoryStock: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const pricing = {
      loadActiveRules: jest.fn().mockResolvedValue([]),
      quoteMany: jest.fn().mockReturnValue(new Map()),
    };
    const pulling = new SyncService(prisma as any, pricing as any).pull('branch-1');
    await Promise.resolve();
    expect(prisma.productVariant.findMany).not.toHaveBeenCalled();
    expect(prisma.inventoryStock.findMany).not.toHaveBeenCalled();
    releaseCursor({ _max: { sequence: 7n } });
    const result = await pulling;
    expect(result.cursor).toBe('7');
    expect(prisma.productVariant.findMany).toHaveBeenCalledTimes(1);
  });

  it('returns only changed variants and branch stock after a cursor', async () => {
    const prisma = {
      syncChange: { findMany: jest.fn().mockResolvedValue([
        { sequence: 43n, kind: 'inventory', branch_id: 'branch-1', entity_key: variant.id },
      ]) },
      productVariant: { findMany: jest.fn().mockResolvedValue([variant]) },
      inventoryStock: { findMany: jest.fn().mockResolvedValue([{ branch_id: 'branch-1', variant_id: variant.id, qty_on_hand: 4 }]) },
    };
    const pricing = {
      loadActiveRules: jest.fn().mockResolvedValue([]),
      quoteMany: jest.fn().mockReturnValue(new Map([[variant.id, quote]])),
    };
    const result = await new SyncService(prisma as any, pricing as any).pull('branch-1', '42');
    expect(result).toMatchObject({ mode: 'delta', cursor: '43', reset_products: false, reset_stock: false });
    expect(() => JSON.stringify(result)).not.toThrow();
    expect(prisma.productVariant.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: [variant.id] } }),
    }));
  });

  it('returns an empty lightweight delta when nothing changed', async () => {
    const prisma = { syncChange: { findMany: jest.fn().mockResolvedValue([]) } };
    const result = await new SyncService(prisma as any, {} as any).pull('branch-1', '43');
    expect(result).toMatchObject({ mode: 'delta', cursor: '43', products: [], stock: [] });
    expect(() => JSON.stringify(result)).not.toThrow();
  });
});
