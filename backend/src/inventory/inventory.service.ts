import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type InventoryReconciliationRow = {
  branch_id: string;
  variant_id: string;
  stock_on_hand: number | null;
  stock_reserved: number | null;
  ledger_on_hand: bigint | number | null;
  ledger_reserved: bigint | number | null;
  last_movement_at: Date | null;
};

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) {}

  async lookup(variantId: string, branchId?: string) {
    return this.prisma.inventoryStock.findMany({
      where: {
        variant_id: variantId,
        qty_on_hand: { gt: 0 },
        ...(branchId ? { branch_id: branchId } : {}),
      },
      include: { branch: true },
    });
  }

  movements(variantId: string, branchId?: string, take = 100) {
    return this.prisma.inventoryMovement.findMany({
      where: {
        variant_id: variantId,
        ...(branchId ? { branch_id: branchId } : {}),
      },
      include: {
        branch: { select: { id: true, code: true, name_ar: true, name_en: true } },
        variant: {
          select: {
            id: true,
            sku: true,
            size: true,
            color: true,
            product: { select: { name_ar: true, name_en: true } },
          },
        },
        creator: { select: { id: true, name: true, role: true } },
      },
      orderBy: [{ occurred_at: 'desc' }, { recorded_at: 'desc' }, { id: 'desc' }],
      take: Math.min(500, Math.max(1, take)),
    });
  }

  async reconcile(branchId?: string) {
    const branchScope = branchId
      ? Prisma.sql`AND COALESCE(stock."branch_id", ledger."branch_id") = ${branchId}::uuid`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<InventoryReconciliationRow[]>(
      Prisma.sql`
        WITH ledger AS (
          SELECT
            movement."branch_id",
            movement."variant_id",
            SUM(movement."on_hand_delta") AS "ledger_on_hand",
            SUM(movement."reserved_delta") AS "ledger_reserved",
            MAX(movement."recorded_at") AS "last_movement_at"
          FROM "InventoryMovement" movement
          GROUP BY movement."branch_id", movement."variant_id"
        )
        SELECT
          COALESCE(stock."branch_id", ledger."branch_id") AS "branch_id",
          COALESCE(stock."variant_id", ledger."variant_id") AS "variant_id",
          stock."qty_on_hand" AS "stock_on_hand",
          stock."qty_reserved" AS "stock_reserved",
          ledger."ledger_on_hand",
          ledger."ledger_reserved",
          ledger."last_movement_at"
        FROM "InventoryStock" stock
        FULL OUTER JOIN ledger
          ON ledger."branch_id" = stock."branch_id"
         AND ledger."variant_id" = stock."variant_id"
        WHERE (
          COALESCE(stock."qty_on_hand", 0) <> COALESCE(ledger."ledger_on_hand", 0)
          OR COALESCE(stock."qty_reserved", 0) <> COALESCE(ledger."ledger_reserved", 0)
        )
        ${branchScope}
        ORDER BY
          COALESCE(stock."branch_id", ledger."branch_id"),
          COALESCE(stock."variant_id", ledger."variant_id")
        LIMIT 1000
      `,
    );

    const items = rows.map((row) => ({
      branch_id: row.branch_id,
      variant_id: row.variant_id,
      stock_on_hand: Number(row.stock_on_hand ?? 0),
      stock_reserved: Number(row.stock_reserved ?? 0),
      ledger_on_hand: Number(row.ledger_on_hand ?? 0),
      ledger_reserved: Number(row.ledger_reserved ?? 0),
      on_hand_difference:
        Number(row.stock_on_hand ?? 0) - Number(row.ledger_on_hand ?? 0),
      reserved_difference:
        Number(row.stock_reserved ?? 0) - Number(row.ledger_reserved ?? 0),
      last_movement_at: row.last_movement_at,
    }));

    return {
      is_consistent: items.length === 0,
      mismatch_count: items.length,
      branch_id: branchId || null,
      checked_at: new Date().toISOString(),
      items,
    };
  }
}
