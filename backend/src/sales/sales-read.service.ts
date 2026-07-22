import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { ListSalesDto } from './dto/list-sales.dto'

@Injectable()
export class SalesReadService {
  private readonly countCache = new Map<
    string,
    { expiresAt: number; value: Promise<number> }
  >()

  constructor(private prisma: PrismaService) {}

  async listSales(dto: ListSalesDto, branchId?: string) {
    const q = dto.q.trim()
    const where: Prisma.SalesInvoiceWhereInput = {
      ...(branchId ? { branch_id: branchId } : {}),
      ...(dto.payment_method ? { payment_method: dto.payment_method } : {}),
      ...(dto.status ? { status: dto.status } : {}),
      ...(dto.from || dto.to
        ? {
            occurred_at: {
              ...(dto.from ? { gte: new Date(dto.from) } : {}),
              ...(dto.to ? { lte: this.endOfDay(dto.to) } : {}),
            },
          }
        : {}),
      ...(q
        ? {
            OR: [
              { invoice_number: { contains: q, mode: 'insensitive' } },
              { customer: { phone: { contains: q } } },
              { customer: { name: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    }
    const countKey = JSON.stringify({
      branchId,
      q,
      payment: dto.payment_method,
      status: dto.status,
      from: dto.from,
      to: dto.to,
    })

    const [total, invoices] = await Promise.all([
      this.cachedSalesCount(countKey, where),
      this.prisma.salesInvoice.findMany({
        where,
        select: {
          id: true,
          invoice_number: true,
          branch_id: true,
          customer_id: true,
          cashier_id: true,
          terminal_id: true,
          status: true,
          subtotal: true,
          discount_amount: true,
          tax_amount: true,
          total: true,
          payment_method: true,
          language: true,
          sync_id: true,
          shift_id: true,
          offline_session_id: true,
          terminal_sequence: true,
          occurred_at: true,
          received_at: true,
          created_at: true,
        },
        orderBy: [{ occurred_at: 'desc' }, { id: 'desc' }],
        skip: (dto.page - 1) * dto.page_size,
        take: dto.page_size,
      }),
    ])

    const items = await this.hydrateInvoices(invoices)

    return {
      items,
      page: dto.page,
      page_size: dto.page_size,
      total,
      total_pages: Math.max(1, Math.ceil(total / dto.page_size)),
      server_time: new Date().toISOString(),
    }
  }

  invalidateCounts() {
    this.countCache.clear()
  }

  private async hydrateInvoices(invoices: any[]) {
    if (!invoices.length) return []

    const invoiceIds = invoices.map((invoice) => invoice.id)
    const branchIds = [...new Set(invoices.map((invoice) => invoice.branch_id))]
    const customerIds = [
      ...new Set(
        invoices
          .map((invoice) => invoice.customer_id)
          .filter((value): value is string => !!value),
      ),
    ]
    const terminalIds = [
      ...new Set(
        invoices
          .map((invoice) => invoice.terminal_id)
          .filter((value): value is string => !!value),
      ),
    ]

    // All relationship hydration is one parallel database wave instead of
    // Prisma's sequential nested relation loading over a remote connection.
    const [branches, customers, terminals, itemCounts, returnCounts] =
      await Promise.all([
        this.prisma.branch.findMany({
          where: { id: { in: branchIds } },
          select: { id: true, code: true, name_ar: true, name_en: true },
        }),
        customerIds.length
          ? this.prisma.customer.findMany({
              where: { id: { in: customerIds } },
              select: { id: true, name: true, phone: true },
            })
          : Promise.resolve([]),
        terminalIds.length
          ? this.prisma.posTerminal.findMany({
              where: { id: { in: terminalIds } },
              select: { id: true, terminal_code: true, name: true },
            })
          : Promise.resolve([]),
        this.prisma.salesInvoiceItem.groupBy({
          by: ['sales_invoice_id'],
          where: { sales_invoice_id: { in: invoiceIds } },
          _count: { _all: true },
        }),
        this.prisma.return.groupBy({
          by: ['original_invoice_id'],
          where: { original_invoice_id: { in: invoiceIds } },
          _count: { _all: true },
        }),
      ])

    const branchById = new Map(
      branches.map(({ id, ...branch }) => [id, branch]),
    )
    const customerById = new Map(customers.map((row) => [row.id, row]))
    const terminalById = new Map(terminals.map((row) => [row.id, row]))
    const itemCountByInvoice = new Map(
      itemCounts.map((row) => [row.sales_invoice_id, row._count._all]),
    )
    const returnCountByInvoice = new Map(
      returnCounts.map((row) => [row.original_invoice_id, row._count._all]),
    )

    return invoices.map((invoice) => {
      const { customer_id, terminal_id, ...safe } = invoice
      return {
        ...safe,
        branch: branchById.get(invoice.branch_id),
        customer: customer_id ? customerById.get(customer_id) || null : null,
        terminal: terminal_id ? terminalById.get(terminal_id) || null : null,
        _count: {
          items: itemCountByInvoice.get(invoice.id) || 0,
          original_returns: returnCountByInvoice.get(invoice.id) || 0,
        },
      }
    })
  }

  private cachedSalesCount(
    key: string,
    where: Prisma.SalesInvoiceWhereInput,
  ) {
    const now = Date.now()
    const cached = this.countCache.get(key)
    if (cached && cached.expiresAt > now) return cached.value

    const ttl = Math.min(
      30_000,
      Math.max(0, Number(process.env.LIST_COUNT_CACHE_MS || 5_000)),
    )
    let value: Promise<number>
    value = this.prisma.salesInvoice
      .count({ where })
      .then((total) => {
        if (this.countCache.get(key)?.value === value) {
          this.countCache.set(key, {
            expiresAt: Date.now() + ttl,
            value: Promise.resolve(total),
          })
        }
        return total
      })
      .catch((error) => {
        if (this.countCache.get(key)?.value === value) {
          this.countCache.delete(key)
        }
        throw error
      })

    this.countCache.set(key, {
      expiresAt: Number.POSITIVE_INFINITY,
      value,
    })
    if (this.countCache.size > 500) {
      this.countCache.delete(this.countCache.keys().next().value!)
    }
    return value
  }

  private endOfDay(value: string) {
    const date = new Date(value)
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      date.setUTCHours(23, 59, 59, 999)
    }
    return date
  }
}
