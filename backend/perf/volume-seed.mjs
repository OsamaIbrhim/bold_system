import { PrismaClient } from '@prisma/client'
import { createHash } from 'node:crypto'
import { ensureSeededInventoryLedger } from '../prisma/ensure-seeded-inventory-ledger.mjs'

const databaseUrl = process.env.DATABASE_URL || ''
if (!databaseUrl.includes('bold_perf') && process.env.PERF_ALLOW_VOLUME_SEED !== '1') {
  throw new Error('Volume seeding is restricted to a database whose URL contains bold_perf. Set PERF_ALLOW_VOLUME_SEED=1 only for an isolated performance database.')
}

const prisma = new PrismaClient()
function positiveInteger(name, fallback) {
  const value = Number(process.env[name] || fallback)
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`)
  return value
}

function stableUuid(kind, index) {
  const hex = createHash('sha256').update(`bold-perf:${kind}:${index}`).digest('hex').slice(0, 32).split('')
  hex[12] = '4'
  hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16], 16) % 4]
  return `${hex.slice(0,8).join('')}-${hex.slice(8,12).join('')}-${hex.slice(12,16).join('')}-${hex.slice(16,20).join('')}-${hex.slice(20).join('')}`
}

const productCount = positiveInteger('PERF_PRODUCTS', 10_000)
const invoiceCount = positiveInteger('PERF_INVOICES', 50_000)
const batchSize = 500

try {
const branch = await prisma.branch.findFirst({ where: { is_active: true } })
const category = await prisma.category.findFirst()
if (!branch || !category) throw new Error('Run the normal development seed before volume-seed.mjs')

const variantIds = []
for (let offset = 0; offset < productCount; offset += batchSize) {
  const size = Math.min(batchSize, productCount - offset)
  const indexes = Array.from({ length: size }, (_, local) => offset + local)
  const skus = indexes.map((index) => `PERF-${String(index).padStart(8, '0')}`)
  const existing = await prisma.productVariant.findMany({ where:{sku:{in:skus}}, select:{id:true,sku:true} })
  const existingBySku = new Map(existing.map((variant) => [variant.sku, variant.id]))
  const missingIndexes = indexes.filter((index) => !existingBySku.has(`PERF-${String(index).padStart(8, '0')}`))
  const products = missingIndexes.map((index) => ({
    id: stableUuid('product', index), name_en: `Performance product ${index}`,
    name_ar: `منتج اختبار أداء ${index}`, category_id: category.id,
    brand: 'Bold Perf', has_variants: false,
  }))
  const variants = products.map((product) => {
    const index = Number(product.name_en.slice('Performance product '.length))
    const id = stableUuid('variant', index)
    return { id, product_id: product.id, sku: `PERF-${String(index).padStart(8, '0')}`, barcode_internal: `PERF-${index}`, cost_price: 100 + (index % 200) }
  })
  const newVariantBySku = new Map(variants.map((variant) => [variant.sku, variant.id]))
  const batchVariantIds = skus.map((sku) => existingBySku.get(sku) || newVariantBySku.get(sku))
  if (batchVariantIds.some((id) => !id)) throw new Error(`Unable to resolve every performance variant in batch ${offset}`)
  variantIds.push(...batchVariantIds)
  await prisma.$transaction([
    prisma.product.createMany({ data: products, skipDuplicates: true }),
    prisma.productVariant.createMany({ data: variants, skipDuplicates: true }),
    prisma.inventoryStock.createMany({ data: batchVariantIds.map((variantId) => ({ branch_id: branch.id, variant_id: variantId, qty_on_hand: 100_000 })), skipDuplicates: true }),
  ])
  process.stdout.write(`\rproducts ${Math.min(offset + size, productCount)}/${productCount}`)
}
process.stdout.write('\n')

// InventoryStock is a materialized balance. Every newly seeded non-zero row must
// receive an opening movement before historical invoice fixtures are inserted.
await ensureSeededInventoryLedger(prisma, 'volume-seed')

for (let offset = 0; offset < invoiceCount; offset += batchSize) {
  const size = Math.min(batchSize, invoiceCount - offset)
  const indexes = Array.from({ length: size }, (_, local) => offset + local)
  const numbers = indexes.map((index) => `PERF-INV-${String(index).padStart(10, '0')}`)
  const existing = await prisma.salesInvoice.findMany({ where:{invoice_number:{in:numbers}}, select:{id:true,invoice_number:true} })
  const existingNumbers = new Set(existing.map((invoice) => invoice.invoice_number))
  const missingIndexes = indexes.filter((index) => !existingNumbers.has(`PERF-INV-${String(index).padStart(10, '0')}`))
  const invoices = missingIndexes.map((index) => {
    return {
      id: stableUuid('invoice', index), invoice_number: `PERF-INV-${String(index).padStart(10, '0')}`,
      branch_id: branch.id, subtotal: 100, tax_amount: 14, total: 114,
      payment_method: index % 2 ? 'cash' : 'card', status: 'completed', language: 'ar',
      created_at: new Date(Date.now() - (index % 365) * 86_400_000),
    }
  })
  const items = invoices.map((invoice) => {
    const index = Number(invoice.invoice_number.slice('PERF-INV-'.length))
    return {
      id: stableUuid('invoice-item', index),
      sales_invoice_id: invoice.id,
      variant_id: variantIds[index % variantIds.length],
      qty: 1,
      unit_price: 100,
      unit_cost: 70,
      unit_tax: 14,
    }
  })
  await prisma.$transaction([
    prisma.salesInvoice.createMany({ data: invoices, skipDuplicates: true }),
    prisma.salesInvoiceItem.createMany({ data: items, skipDuplicates: true }),
  ])
  process.stdout.write(`\rinvoices ${Math.min(offset + size, invoiceCount)}/${invoiceCount}`)
}
process.stdout.write('\nvolume seed complete\n')
} finally {
  await prisma.$disconnect()
}
