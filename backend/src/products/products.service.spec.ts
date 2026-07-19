import { ProductsService } from './products.service';

describe('ProductsService pagination', () => {
  it('returns the first 20 active products when the query is empty', async () => {
    const variants = [{ id:'v1', cost_price:100, inventory:[], product:{ is_active:true, name_en:'Shirt' } }];
    const prisma = {
      productVariant: {
        count: jest.fn().mockResolvedValue(41),
        findMany: jest.fn().mockResolvedValue(variants),
      },
    };
    const result = await new ProductsService(prisma as any).list('', 1, 20, undefined, true);
    expect(prisma.productVariant.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { product: { is_active: true } }, skip: 0, take: 20,
    }));
    expect(result).toMatchObject({ page:1, page_size:20, total:41, total_pages:3, items:variants });
    expect(prisma.productVariant.count).toHaveBeenCalledTimes(1);
  });

  it('suggests close product names when a typed name has no exact match', async () => {
    const prisma = {
      productVariant: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([
        { name_en:'T-Shirt', name_ar:'تي شيرت', sku:'TSHIRT-1', score:0.72 },
      ]),
    };
    const result = await new ProductsService(prisma as any).list('T-Shert', 1, 20);
    expect(result.suggestions).toEqual([{ value:'T-Shirt', label:'تي شيرت' }]);
  });

  it('coalesces repeated identical count queries during a request burst', async () => {
    const prisma = { productVariant: {
      count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]),
    } };
    const service = new ProductsService(prisma as any);
    await Promise.all([service.list('', 1, 20), service.list('', 2, 20)]);
    expect(prisma.productVariant.count).toHaveBeenCalledTimes(1);
    expect(prisma.productVariant.findMany).toHaveBeenCalledTimes(2);
  });
});
