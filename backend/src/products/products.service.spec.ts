import { ProductsService } from './products.service';

function productReadPrisma(variants: any[], total = variants.length) {
  return {
    productVariant: {
      count: jest.fn().mockResolvedValue(total),
      findMany: jest.fn().mockResolvedValue(variants),
    },
    product: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'p1', is_active: true, name_en: 'Shirt' },
      ]),
    },
    inventoryStock: {
      findMany: jest.fn().mockResolvedValue([
        { branch_id: 'b1', variant_id: 'v1', qty_on_hand: 7, qty_reserved: 0 },
      ]),
    },
  };
}

describe('ProductsService pagination', () => {
  it('hydrates the first page in one parallel relation wave', async () => {
    const variants = [{ id: 'v1', product_id: 'p1', cost_price: 100 }];
    const prisma = productReadPrisma(variants, 41);
    const result = await new ProductsService(prisma as any).list('', 1, 20, 'b1', true);

    expect(prisma.productVariant.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { product: { is_active: true } },
      skip: 0,
      take: 20,
    }));
    expect(prisma.product.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.inventoryStock.findMany).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      page: 1,
      page_size: 20,
      total: 41,
      total_pages: 3,
      items: [{
        id: 'v1',
        product: { id: 'p1', name_en: 'Shirt' },
        available_here: 7,
      }],
    });
  });

  it('suggests close product names when a typed name has no exact match', async () => {
    const prisma = {
      ...productReadPrisma([], 0),
      $queryRaw: jest.fn().mockResolvedValue([
        { name_en: 'T-Shirt', name_ar: 'تي شيرت', sku: 'TSHIRT-1', score: 0.72 },
      ]),
    };
    const result = await new ProductsService(prisma as any).list('T-Shert', 1, 20);
    expect(result.suggestions).toEqual([{ value: 'T-Shirt', label: 'تي شيرت' }]);
  });

  it('coalesces repeated identical count queries during a request burst', async () => {
    const prisma = productReadPrisma([], 0);
    const service = new ProductsService(prisma as any);
    await Promise.all([service.list('', 1, 20), service.list('', 2, 20)]);
    expect(prisma.productVariant.count).toHaveBeenCalledTimes(1);
    expect(prisma.productVariant.findMany).toHaveBeenCalledTimes(2);
  });


  it('does not expose moving-average cost as an editable variant field', async () => {
    const prisma = {
      productVariant: {
        findUnique: jest.fn().mockResolvedValue({ id: 'v1' }),
        update: jest.fn().mockResolvedValue({ id: 'v1' }),
      },
    };
    const service = new ProductsService(prisma as any);

    await service.updateVariant('v1', {
      sku: 'UPDATED-SKU',
    });

    expect(prisma.productVariant.update).toHaveBeenCalledWith({
      where: { id: 'v1' },
      data: expect.not.objectContaining({
        cost_price: expect.anything(),
      }),
    });
  });

});
