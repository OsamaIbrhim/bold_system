import { SalesController } from './sales.controller';

describe('SalesController POS terminal enforcement', () => {
  const cashier = {
    sub: 'cashier-1',
    role: 'cashier',
    branch_id: 'branch-1',
  } as any;
  const owner = {
    sub: 'owner-1',
    role: 'owner',
    branch_id: null,
  } as any;
  const request = (user: any) => ({ user }) as any;
  const sale = {
    branch_id: 'branch-1',
    items: [{ variant_id: 'variant-1', qty: 1 }],
  } as any;
  const returnDto = {
    original_invoice_id: 'invoice-1',
    items: [{ sales_invoice_item_id: 'line-1', qty: 1 }],
  } as any;

  function subject() {
    const sales = {
      createSale: jest.fn().mockResolvedValue({ id: 'invoice-1' }),
      createReturn: jest.fn().mockResolvedValue({ id: 'return-1' }),
      findReturnableInvoice: jest.fn().mockResolvedValue({ id: 'invoice-1' }),
    } as any;
    const terminal = {
      id: 'terminal-1',
      branch_id: 'branch-1',
      last_sale_sequence: 0n,
    };
    const terminals = {
      authenticate: jest.fn().mockResolvedValue(terminal),
    } as any;
    return {
      controller: new SalesController(sales, {} as any, terminals),
      sales,
      terminals,
      terminal,
    };
  }

  it('authenticates the enrolled terminal and passes its trusted server record to sale creation', async () => {
    const { controller, sales, terminals, terminal } = subject();
    await controller.sale(sale, 'device-1', 'secret-1', request(cashier));
    expect(terminals.authenticate).toHaveBeenCalledWith(
      'device-1',
      'secret-1',
      cashier,
    );
    expect(sales.createSale).toHaveBeenCalledWith(sale, cashier, terminal);
  });

  it('authenticates the enrolled terminal before a return or invoice lookup', async () => {
    const { controller, sales, terminals } = subject();
    await controller.lookupInvoice(
      ' B-100 ',
      'device-1',
      'secret-1',
      request(cashier),
    );
    await controller.ret(
      returnDto,
      'device-1',
      'secret-1',
      request(cashier),
    );
    expect(terminals.authenticate).toHaveBeenCalledTimes(2);
    expect(sales.findReturnableInvoice).toHaveBeenCalledWith(
      'B-100',
      cashier,
    );
    expect(sales.createReturn).toHaveBeenCalledWith(returnDto, cashier);
  });

  it('allows an owner support lookup without impersonating a physical terminal', async () => {
    const { controller, terminals } = subject();
    await controller.lookupInvoice(
      'B-100',
      undefined,
      undefined,
      request(owner),
    );
    expect(terminals.authenticate).not.toHaveBeenCalled();
  });
});
