import { ProductsService } from './products.service';

describe('ProductsService pagination', () => {
  it('returns the first 20 active products when the query is empty', async () => {
    const variants = [{ id:'v1', cost_price:100, inventory:[], product:{ is_active:true, name_en:'Shirt' } }];
    const prisma = {
      productVariant: {
        count: jest.fn().mockReturnValue('count-query'),
        findMany: jest.fn().mockReturnValue('items-query'),
      },
      $transaction: jest.fn().mockResolvedValue([41, variants]),
    };
    const result = await new ProductsService(prisma as any).list('', 1, 20, undefined, true);
    expect(prisma.productVariant.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { product: { is_active: true } }, skip: 0, take: 20,
    }));
    expect(result).toMatchObject({ page:1, page_size:20, total:41, total_pages:3, items:variants });
  });
});
