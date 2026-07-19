import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReceivePurchaseDto } from './dto/receive-purchase.dto';
import { AuthenticatedUser } from '../auth/authenticated-user';
@Injectable()
export class PurchasingService {
  constructor(private prisma: PrismaService) {}
  list(branch_id?: string, take = 50) {
    return this.prisma.purchaseInvoice.findMany({
      where: branch_id ? { branch_id } : {},
      include: { supplier: true, items: { include: { variant: { include: { product: true }}}}},
      orderBy: { created_at: 'desc' },
      take
    });
  }
  get(id: string) {
    return this.prisma.purchaseInvoice.findUnique({
      where: { id },
      include: { supplier: true, items: { include: { variant: { include: { product: true }}}}}
    });
  }
  async receive(dto: ReceivePurchaseDto, actor: AuthenticatedUser) {
    if (dto.discount_amount !== undefined && dto.discount_percent !== undefined) {
      throw new BadRequestException('Use either discount_amount or discount_percent, not both');
    }

    const aggregated = new Map<string, { qty: number; totalCost: Prisma.Decimal }>();
    for (const item of dto.items) {
      const current = aggregated.get(item.variant_id) || { qty: 0, totalCost: new Prisma.Decimal(0) };
      aggregated.set(item.variant_id, {
        qty: current.qty + item.qty,
        totalCost: current.totalCost.plus(new Prisma.Decimal(item.unit_cost).mul(item.qty)),
      });
    }
    const items = [...aggregated.entries()].map(([variant_id, value]) => ({
      variant_id,
      qty: value.qty,
      unit_cost: value.totalCost.div(value.qty).toDecimalPlaces(2),
    }));
    const subtotal = items.reduce(
      (sum, item) => sum.plus(item.unit_cost.mul(item.qty)),
      new Prisma.Decimal(0),
    ).toDecimalPlaces(2);
    const discount = dto.discount_amount !== undefined
      ? new Prisma.Decimal(dto.discount_amount)
      : subtotal.mul(dto.discount_percent || 0).div(100).toDecimalPlaces(2);
    if (discount.greaterThan(subtotal)) {
      throw new BadRequestException('Discount cannot exceed purchase subtotal');
    }
    const netCostMultiplier = subtotal.isZero()
      ? new Prisma.Decimal(1)
      : subtotal.minus(discount).div(subtotal);

    return this.prisma.$transaction(async (tx) => {
      const [branch, supplier, variants] = await Promise.all([
        tx.branch.findFirst({ where: { id: dto.branch_id, is_active: true }, select: { id: true } }),
        tx.supplier.findUnique({ where: { id: dto.supplier_id }, select: { id: true } }),
        tx.productVariant.findMany({
          where: { id: { in: items.map((item) => item.variant_id) } },
          select: { id: true, cost_price: true },
        }),
      ]);
      if (!branch) throw new NotFoundException('Active branch not found');
      if (!supplier) throw new NotFoundException('Supplier not found');
      if (variants.length !== items.length) throw new NotFoundException('One or more product variants were not found');

      const currentStock = await tx.inventoryStock.groupBy({
        by: ['variant_id'],
        where: { variant_id: { in: items.map((item) => item.variant_id) }, qty_on_hand: { gt: 0 } },
        _sum: { qty_on_hand: true },
      });
      const stockByVariant = new Map(currentStock.map((row) => [row.variant_id, row._sum.qty_on_hand || 0]));
      const variantById = new Map(variants.map((variant) => [variant.id, variant]));

      const invoice = await tx.purchaseInvoice.create({
        data: {
          supplier_id: dto.supplier_id,
          branch_id: dto.branch_id,
          invoice_number: dto.invoice_number,
          invoice_date: dto.invoice_date ? new Date(dto.invoice_date) : undefined,
          subtotal,
          discount_amount: discount,
          discount_percent: dto.discount_percent || 0,
          total: subtotal.minus(discount),
          ocr_source_file: dto.ocr_source_file,
          created_by: actor.sub,
          items: { create: items },
        },
        include: { items: true, supplier: true },
      });

      for (const item of items) {
        const currentQty = stockByVariant.get(item.variant_id) || 0;
        const currentCost = new Prisma.Decimal(variantById.get(item.variant_id)!.cost_price);
        const receivedNetUnitCost = item.unit_cost.mul(netCostMultiplier);
        const weightedCost = currentCost.mul(currentQty)
          .plus(receivedNetUnitCost.mul(item.qty))
          .div(currentQty + item.qty)
          .toDecimalPlaces(2);
        await tx.inventoryStock.upsert({
          where: { branch_id_variant_id: { branch_id: dto.branch_id, variant_id: item.variant_id } },
          update: { qty_on_hand: { increment: item.qty } },
          create: { branch_id: dto.branch_id, variant_id: item.variant_id, qty_on_hand: item.qty },
        });
        await tx.productVariant.update({
          where: { id: item.variant_id },
          data: { cost_price: weightedCost },
        });
      }
      return invoice;
    });
  }
  async ocrImport(fileUrl: string) { return { draft: true, source: fileUrl, items: [], message: 'Upload supplier invoice – edit then confirm – supplier alias mapping supported' }; }
}
