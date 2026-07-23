import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'

const prisma = new PrismaClient()

class RollbackPurchasingAccountingSmoke extends Error {}

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

const summary = {
  suite: 'purchasing-cost-accounting',
  receipt: false,
  idempotency: false,
  weighted_cost: false,
  supplier_return: false,
  reversal: false,
  customer_return: false,
  rolled_back: false,
}

try {
  await prisma.$transaction(
    async (tx) => {
      const branch =
        (await tx.branch.findFirst({ where: { is_active: true } })) ||
        (await tx.branch.create({
          data: {
            code: `COST-${randomUUID().slice(0, 8)}`,
            name_ar: 'فرع اختبار تكلفة المشتريات',
            name_en: 'Purchasing cost smoke',
          },
        }))
      const actor =
        (await tx.user.findFirst()) ||
        (await tx.user.create({
          data: {
            branch_id: branch.id,
            name: 'Purchasing cost smoke actor',
            password_hash: 'smoke-test-only',
            role: 'owner',
          },
        }))
      const supplier =
        (await tx.supplier.findFirst()) ||
        (await tx.supplier.create({
          data: {
            name: 'Purchasing cost smoke supplier',
            alias_names: [],
          },
        }))
      const product = await tx.product.create({
        data: {
          name_en: `Cost smoke ${randomUUID().slice(0, 8)}`,
          has_variants: false,
        },
      })
      const variant = await tx.productVariant.create({
        data: {
          product_id: product.id,
          sku: `COST-${randomUUID()}`,
          barcode_internal: `COST-${randomUUID()}`,
          cost_price: 100,
        },
      })
      await tx.inventoryStock.create({
        data: {
          branch_id: branch.id,
          variant_id: variant.id,
          qty_on_hand: 0,
        },
      })

      const invoice = await tx.purchaseInvoice.create({
        data: {
          supplier_id: supplier.id,
          branch_id: branch.id,
          invoice_number: `COST-${randomUUID()}`,
          normalized_invoice_number: `COST-${randomUUID()}`,
          status: 'posted',
          accounting_version: 2,
          idempotency_key: `cost-smoke:${randomUUID()}`,
          command_fingerprint: randomUUID().replaceAll('-', '').padEnd(64, '0'),
          subtotal: 1000,
          discount_amount: 100,
          discount_percent: 10,
          total: 900,
          received_at: new Date(),
          created_by: actor.id,
          items: {
            create: [{
              variant_id: variant.id,
              qty: 10,
              unit_cost: 100,
              line_subtotal: 1000,
              allocated_discount: 100,
              net_line_total: 900,
              net_unit_cost: 90,
            }],
          },
        },
        include: { items: true },
      })
      const item = invoice.items[0]

      await tx.inventoryStock.update({
        where: {
          branch_id_variant_id: {
            branch_id: branch.id,
            variant_id: variant.id,
          },
        },
        data: { qty_on_hand: { increment: 10 } },
      })
      await tx.$queryRaw`
        SELECT "record_inventory_movement"(
          ${branch.id}::uuid,
          ${variant.id}::uuid,
          'purchase_receipt'::"InventoryMovementType",
          10::integer,
          0::integer,
          'PurchaseInvoice'::text,
          ${invoice.id}::text,
          ${item.id}::text,
          ${`cost-smoke-stock:${item.id}`}::text,
          CURRENT_TIMESTAMP::timestamp,
          ${actor.id}::uuid,
          '{"smoke":true}'::jsonb
        )
      `
      const key = `cost-smoke-cost:${item.id}`
      const first = await tx.$queryRaw`
        SELECT "record_inventory_cost_movement"(
          ${variant.id}::uuid,
          ${branch.id}::uuid,
          'purchase_receipt'::"InventoryCostMovementType",
          10::integer,
          900::numeric,
          'PurchaseInvoice'::text,
          ${invoice.id}::text,
          ${item.id}::text,
          ${invoice.id}::uuid,
          ${item.id}::uuid,
          NULL::uuid,
          NULL::uuid,
          ${key}::text,
          CURRENT_TIMESTAMP::timestamp,
          ${actor.id}::uuid,
          NULL::numeric,
          '{"smoke":true}'::jsonb
        ) AS "movement_id"
      `
      const second = await tx.$queryRaw`
        SELECT "record_inventory_cost_movement"(
          ${variant.id}::uuid,
          ${branch.id}::uuid,
          'purchase_receipt'::"InventoryCostMovementType",
          10::integer,
          900::numeric,
          'PurchaseInvoice'::text,
          ${invoice.id}::text,
          ${item.id}::text,
          ${invoice.id}::uuid,
          ${item.id}::uuid,
          NULL::uuid,
          NULL::uuid,
          ${key}::text,
          CURRENT_TIMESTAMP::timestamp,
          ${actor.id}::uuid,
          NULL::numeric,
          '{"smoke":true}'::jsonb
        ) AS "movement_id"
      `
      invariant(first[0].movement_id === second[0].movement_id, 'Cost idempotency failed')
      invariant(
        await tx.inventoryCostMovement.count({ where: { idempotency_key: key } }) === 1,
        'Duplicate cost movement was stored',
      )
      const postedVariant = await tx.productVariant.findUnique({
        where: { id: variant.id },
      })
      invariant(Number(postedVariant.cost_price) === 90, 'Weighted cost was not posted')
      summary.receipt = true
      summary.idempotency = true
      summary.weighted_cost = true


      const supplierReturn = await tx.supplierReturn.create({
        data: {
          purchase_invoice_id: invoice.id,
          supplier_id: supplier.id,
          branch_id: branch.id,
          return_number: `COST-RETURN-${randomUUID()}`,
          status: 'posted',
          idempotency_key: `cost-smoke-supplier-return:${randomUUID()}`,
          command_fingerprint: randomUUID()
            .replaceAll('-', '')
            .padEnd(64, '0'),
          reason: 'Purchasing accounting smoke',
          credit_total: 180,
          inventory_value_removed: 180,
          purchase_price_variance: 0,
          occurred_at: new Date(),
          created_by: actor.id,
          items: {
            create: [{
              purchase_invoice_item_id: item.id,
              variant_id: variant.id,
              qty: 2,
              credit_unit_cost: 90,
              credit_total: 180,
              inventory_unit_cost: 90,
              inventory_value_removed: 180,
              purchase_price_variance: 0,
            }],
          },
        },
        include: { items: true },
      })
      const supplierReturnItem = supplierReturn.items[0]

      await tx.inventoryStock.update({
        where: {
          branch_id_variant_id: {
            branch_id: branch.id,
            variant_id: variant.id,
          },
        },
        data: { qty_on_hand: { decrement: 2 } },
      })
      await tx.$queryRaw`
        SELECT "record_inventory_movement"(
          ${branch.id}::uuid,
          ${variant.id}::uuid,
          'reversal'::"InventoryMovementType",
          -2::integer,
          0::integer,
          'SupplierReturn'::text,
          ${supplierReturn.id}::text,
          ${supplierReturnItem.id}::text,
          ${`cost-smoke-supplier-return-stock:${supplierReturnItem.id}`}::text,
          CURRENT_TIMESTAMP::timestamp,
          ${actor.id}::uuid,
          '{"smoke":true}'::jsonb
        )
      `
      await tx.$queryRaw`
        SELECT "record_inventory_cost_movement"(
          ${variant.id}::uuid,
          ${branch.id}::uuid,
          'supplier_return'::"InventoryCostMovementType",
          -2::integer,
          -180::numeric,
          'SupplierReturn'::text,
          ${supplierReturn.id}::text,
          ${supplierReturnItem.id}::text,
          ${invoice.id}::uuid,
          ${item.id}::uuid,
          ${supplierReturn.id}::uuid,
          ${supplierReturnItem.id}::uuid,
          ${`cost-smoke-supplier-return-cost:${supplierReturnItem.id}`}::text,
          CURRENT_TIMESTAMP::timestamp,
          ${actor.id}::uuid,
          NULL::numeric,
          '{"smoke":true}'::jsonb
        )
      `
      const afterSupplierReturn = await tx.productVariant.findUnique({
        where: { id: variant.id },
      })
      invariant(
        Number(afterSupplierReturn.cost_price) === 90,
        'Supplier return changed the moving-average cost',
      )
      summary.supplier_return = true

      await tx.inventoryStock.update({
        where: {
          branch_id_variant_id: {
            branch_id: branch.id,
            variant_id: variant.id,
          },
        },
        data: { qty_on_hand: { decrement: 8 } },
      })
      await tx.$queryRaw`
        SELECT "record_inventory_movement"(
          ${branch.id}::uuid,
          ${variant.id}::uuid,
          'reversal'::"InventoryMovementType",
          -8::integer,
          0::integer,
          'PurchaseInvoice'::text,
          ${invoice.id}::text,
          ${item.id}::text,
          ${`cost-smoke-reversal-stock:${item.id}`}::text,
          CURRENT_TIMESTAMP::timestamp,
          ${actor.id}::uuid,
          '{"smoke":true}'::jsonb
        )
      `
      await tx.$queryRaw`
        SELECT "record_inventory_cost_movement"(
          ${variant.id}::uuid,
          ${branch.id}::uuid,
          'purchase_reversal'::"InventoryCostMovementType",
          -8::integer,
          -720::numeric,
          'PurchaseInvoice'::text,
          ${invoice.id}::text,
          ${item.id}::text,
          ${invoice.id}::uuid,
          ${item.id}::uuid,
          NULL::uuid,
          NULL::uuid,
          ${`cost-smoke-reversal-cost:${item.id}`}::text,
          CURRENT_TIMESTAMP::timestamp,
          ${actor.id}::uuid,
          100::numeric,
          '{"smoke":true}'::jsonb
        )
      `
      const reversedVariant = await tx.productVariant.findUnique({
        where: { id: variant.id },
      })
      invariant(Number(reversedVariant.cost_price) === 100, 'Reversal did not restore cost')
      summary.reversal = true


      const historicalSale = await tx.salesInvoice.create({
        data: {
          invoice_number: `COST-SALE-${randomUUID()}`,
          branch_id: branch.id,
          cashier_id: actor.id,
          status: 'completed',
          subtotal: 80,
          tax_amount: 0,
          total: 80,
          payment_method: 'cash',
          language: 'ar',
          items: {
            create: [{
              variant_id: variant.id,
              qty: 1,
              unit_price: 80,
              unit_cost: 80,
              unit_tax: 0,
            }],
          },
        },
        include: { items: true },
      })
      const customerReturn = await tx.return.create({
        data: {
          original_invoice_id: historicalSale.id,
          branch_id: branch.id,
          return_invoice_number: `COST-CUSTOMER-RETURN-${randomUUID()}`,
          reason: 'Purchasing accounting customer-return smoke',
          is_partial: false,
          created_by: actor.id,
          refund_subtotal: 80,
          refund_tax: 0,
          refund_total: 80,
          status: 'completed',
          items: {
            create: [{
              sales_invoice_item_id: historicalSale.items[0].id,
              variant_id: variant.id,
              qty: 1,
              unit_price: 80,
              unit_cost: 80,
              unit_tax: 0,
            }],
          },
        },
      })
      await tx.inventoryStock.update({
        where: {
          branch_id_variant_id: {
            branch_id: branch.id,
            variant_id: variant.id,
          },
        },
        data: { qty_on_hand: { increment: 1 } },
      })
      await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE')

      const customerReturnCost = await tx.inventoryCostMovement.findUnique({
        where: {
          idempotency_key:
            `customer-return-cost:${customerReturn.id}:${variant.id}`,
        },
      })
      const afterCustomerReturn = await tx.productVariant.findUnique({
        where: { id: variant.id },
      })
      invariant(
        customerReturnCost?.movement_type === 'customer_return',
        'Customer return cost movement was not recorded',
      )
      invariant(
        Number(afterCustomerReturn.cost_price) === 80,
        'Customer return did not restore stock at the original sale cost',
      )
      summary.customer_return = true

      summary.rolled_back = true
      throw new RollbackPurchasingAccountingSmoke()
    },
    {
      isolationLevel: 'Serializable',
      maxWait: 15_000,
      timeout: 120_000,
    },
  )
} catch (error) {
  if (!(error instanceof RollbackPurchasingAccountingSmoke)) throw error
} finally {
  await prisma.$disconnect()
}

process.stdout.write(`${JSON.stringify(summary)}\n`)
