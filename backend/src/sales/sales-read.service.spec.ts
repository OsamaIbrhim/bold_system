import { SalesReadService } from './sales-read.service'

function setup() {
  const prisma = {
    salesInvoice: {
      count: jest.fn().mockResolvedValue(21),
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'sale-1',
          invoice_number: 'B-1',
          branch_id: 'branch-1',
          customer_id: 'customer-1',
          cashier_id: 'cashier-1',
          terminal_id: 'terminal-1',
          status: 'completed',
          subtotal: 100,
          discount_amount: 0,
          tax_amount: 14,
          total: 114,
          payment_method: 'cash',
          language: 'ar',
          sync_id: null,
          shift_id: null,
          offline_session_id: null,
          terminal_sequence: null,
          occurred_at: new Date(),
          received_at: new Date(),
          created_at: new Date(),
        },
      ]),
    },
    branch: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'branch-1', code: 'B1', name_ar: 'فرع', name_en: 'Branch' },
      ]),
    },
    customer: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'customer-1', name: 'Customer', phone: '+201' },
      ]),
    },
    posTerminal: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'terminal-1', terminal_code: 'T1', name: 'Till 1' },
      ]),
    },
    salesInvoiceItem: {
      groupBy: jest.fn().mockResolvedValue([
        { sales_invoice_id: 'sale-1', _count: { _all: 2 } },
      ]),
    },
    return: {
      groupBy: jest.fn().mockResolvedValue([
        { original_invoice_id: 'sale-1', _count: { _all: 1 } },
      ]),
    },
  }

  return { prisma, service: new SalesReadService(prisma as any) }
}

describe('SalesReadService', () => {
  it('loads the page first and hydrates all relations in one parallel wave', async () => {
    const { prisma, service } = setup()
    const result = await service.listSales(
      { q: '', page: 1, page_size: 20 } as any,
      'branch-1',
    )

    expect(prisma.salesInvoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { branch_id: 'branch-1' },
        skip: 0,
        take: 20,
      }),
    )
    expect(result).toMatchObject({
      total: 21,
      total_pages: 2,
      items: [
        {
          id: 'sale-1',
          branch: { code: 'B1' },
          customer: { id: 'customer-1' },
          terminal: { id: 'terminal-1' },
          _count: { items: 2, original_returns: 1 },
        },
      ],
    })
    expect(result.items[0]).not.toHaveProperty('customer_id')
    expect(result.items[0]).not.toHaveProperty('terminal_id')
  })

  it('coalesces repeated count queries and supports explicit invalidation', async () => {
    const { prisma, service } = setup()
    await Promise.all([
      service.listSales({ q: '', page: 1, page_size: 20 } as any),
      service.listSales({ q: '', page: 2, page_size: 20 } as any),
    ])
    expect(prisma.salesInvoice.count).toHaveBeenCalledTimes(1)

    service.invalidateCounts()
    await service.listSales({ q: '', page: 1, page_size: 20 } as any)
    expect(prisma.salesInvoice.count).toHaveBeenCalledTimes(2)
  })
})
