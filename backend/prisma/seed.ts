import { PrismaClient } from '@prisma/client';
import * as bcryptjs from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding Bold POS – Test Data v2.1 – Full with line items …');

  // Clean – reverse FK order
  await prisma.returnItem.deleteMany();
  await prisma.return.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.salesInvoiceItem.deleteMany();
  await prisma.salesInvoice.deleteMany();
  await prisma.purchaseInvoiceItem.deleteMany();
  await prisma.purchaseInvoice.deleteMany();
  await prisma.transferItem.deleteMany();
  await prisma.transfer.deleteMany();
  await prisma.$executeRawUnsafe('DELETE FROM "Shift"');
  await prisma.inventoryStock.deleteMany();
  await prisma.offerSuggestion.deleteMany();
  await prisma.productVariant.deleteMany();
  await prisma.product.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.pricingRule.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.user.deleteMany();
  await prisma.category.deleteMany();
  await prisma.branch.deleteMany();

  const password_hash = await bcryptjs.hash('Bold1234', 10);

  // Branches
  const b1 = await prisma.branch.create({ data: { code: 'BOLD-01', name_ar: 'بولد – الفرع الرئيسي', name_en: 'Bold Main', address: 'طنطا', phone: '0400000000', cash_drawer_enabled: false }});
  const b2 = await prisma.branch.create({ data: { code: 'BOLD-02', name_ar: 'بولد – القاهرة الجديدة', name_en: 'Bold New Cairo', cash_drawer_enabled: true }});

  // Users
  const owner = await prisma.user.create({ data: { name: 'Owner – أسامة', phone: '+200100000000', email: 'owner@bold.eg', password_hash, role: 'owner', branch_id: b1.id }});
  const manager = await prisma.user.create({ data: { name: 'مدير فرع', phone: '+200100000001', email: 'manager@bold.eg', password_hash, role: 'branch_manager', branch_id: b1.id }});
  const cashier = await prisma.user.create({ data: { name: 'كاشير', phone: '+200100000002', email: 'cashier@bold.eg', password_hash, role: 'cashier', branch_id: b1.id }});
  const warehouse = await prisma.user.create({ data: { name: 'أمين مخزن', phone: '+200100000003', email: 'warehouse@bold.eg', password_hash, role: 'warehouse_manager', branch_id: b1.id }});

  // Suppliers
  const s1 = await prisma.supplier.create({ data: { name: 'محمد', company_name: 'Mohamed Fabrics Co.', phone: '01222222222', alias_names: ['Mohamed Fabrics Co.', 'Mohamed Trading'] }});
  const s2 = await prisma.supplier.create({ data: { name: 'النصر', company_name: 'El-Nasr Trading', phone: '01233333333', alias_names: [] }});
  const s3 = await prisma.supplier.create({ data: { name: 'Classic Wear', company_name: 'Classic Wear Co.', phone: '01244444444', alias_names: ['Classic'] }});

  // Categories
  const cat_t = await prisma.category.create({ data: { name_ar: 'تيشيرتات', name_en: 'T-Shirts' }});
  const cat_s = await prisma.category.create({ data: { name_ar: 'قمصان', name_en: 'Shirts' }});
  const cat_j = await prisma.category.create({ data: { name_ar: 'جينز', name_en: 'Jeans' }});

  // Products + Variants – 12 products, 28 variants
  const productsData = [
    { name_en: 'Classic T-Shirt', brand: 'Bold', category_id: cat_t.id, variants: [
      { sku: 'BOLD-TS-001-S-BLK', size: 'S', color: 'Black', cost: 85, ean: '6223001000011' },
      { sku: 'BOLD-TS-001-M-BLK', size: 'M', color: 'Black', cost: 85, ean: '6223001000012' },
      { sku: 'BOLD-TS-001-L-BLK', size: 'L', color: 'Black', cost: 85, ean: '6223001000013' },
      { sku: 'BOLD-TS-001-M-WHT', size: 'M', color: 'White', cost: 85, ean: '6223001000014' },
    ]},
    { name_en: 'Polo Shirt', brand: 'Bold', category_id: cat_s.id, variants: [
      { sku: 'BOLD-PO-002-M-NAV', size: 'M', color: 'Navy', cost: 140, ean: '6223001000021' },
      { sku: 'BOLD-PO-002-L-NAV', size: 'L', color: 'Navy', cost: 140, ean: '6223001000022' },
      { sku: 'BOLD-PO-002-XL-GRY', size: 'XL', color: 'Gray', cost: 140, ean: '6223001000023' },
    ]},
    { name_en: 'Slim Jeans', brand: 'DenimCo', category_id: cat_j.id, variants: [
      { sku: 'DNM-JN-101-32-BLU', size: '32', color: 'Blue', cost: 210, ean: '6223001001011' },
      { sku: 'DNM-JN-101-34-BLU', size: '34', color: 'Blue', cost: 210, ean: '6223001001012' },
      { sku: 'DNM-JN-101-32-BLK', size: '32', color: 'Black', cost: 210, ean: '6223001001013' },
    ]},
    { name_en: 'Oxford Shirt', brand: 'Bold', category_id: cat_s.id, variants: [
      { sku: 'BOLD-OX-003-M-WHT', size: 'M', color: 'White', cost: 165, ean: '6223001000031' },
      { sku: 'BOLD-OX-003-L-WHT', size: 'L', color: 'White', cost: 165, ean: '6223001000032' },
      { sku: 'BOLD-OX-003-M-BLU', size: 'M', color: 'Blue', cost: 165, ean: '6223001000033' },
    ]},
    { name_en: 'Graphic Tee', brand: 'Bold', category_id: cat_t.id, variants: [
      { sku: 'BOLD-GT-004-M-BLK', size: 'M', color: 'Black', cost: 95, ean: '6223001000041' },
      { sku: 'BOLD-GT-004-L-BLK', size: 'L', color: 'Black', cost: 95, ean: '6223001000042' },
    ]},
    { name_en: 'Chino Pants', brand: 'Classic Wear', category_id: cat_j.id, variants: [
      { sku: 'CL-CH-201-32-BEG', size: '32', color: 'Beige', cost: 190, ean: '6223001002011' },
      { sku: 'CL-CH-201-34-BEG', size: '34', color: 'Beige', cost: 190, ean: '6223001002012' },
      { sku: 'CL-CH-201-32-OLV', size: '32', color: 'Olive', cost: 190, ean: '6223001002013' },
    ]},
    { name_en: 'V-Neck Tee', brand: 'Bold', category_id: cat_t.id, variants: [
      { sku: 'BOLD-VN-005-M-GRY', size: 'M', color: 'Gray', cost: 80, ean: '6223001000051' },
      { sku: 'BOLD-VN-005-L-GRY', size: 'L', color: 'Gray', cost: 80, ean: '6223001000052' },
    ]},
    { name_en: 'Linen Shirt', brand: 'Classic Wear', category_id: cat_s.id, variants: [
      { sku: 'CL-LN-301-M-WHT', size: 'M', color: 'White', cost: 175, ean: '6223001003011' },
      { sku: 'CL-LN-301-L-BEG', size: 'L', color: 'Beige', cost: 175, ean: '6223001003012' },
    ]},
    { name_en: 'Cargo Jeans', brand: 'DenimCo', category_id: cat_j.id, variants: [
      { sku: 'DNM-CG-102-34-GRY', size: '34', color: 'Gray', cost: 230, ean: '6223001001021' },
      { sku: 'DNM-CG-102-36-GRY', size: '36', color: 'Gray', cost: 230, ean: '6223001001022' },
    ]},
    { name_en: 'Henley Tee', brand: 'Bold', category_id: cat_t.id, variants: [
      { sku: 'BOLD-HN-006-M-BLU', size: 'M', color: 'Blue', cost: 90, ean: '6223001000061' },
      { sku: 'BOLD-HN-006-L-BLU', size: 'L', color: 'Blue', cost: 90, ean: '6223001000062' },
    ]},
    { name_en: 'Denim Shirt', brand: 'DenimCo', category_id: cat_s.id, variants: [
      { sku: 'DNM-DS-401-M-IND', size: 'M', color: 'Indigo', cost: 185, ean: '6223001004011' },
      { sku: 'DNM-DS-401-L-IND', size: 'L', color: 'Indigo', cost: 185, ean: '6223001004012' },
    ]},
    { name_en: 'Jogger Pants', brand: 'Bold', category_id: cat_j.id, variants: [
      { sku: 'BOLD-JG-007-M-BLK', size: 'M', color: 'Black', cost: 150, ean: '6223001000071' },
      { sku: 'BOLD-JG-007-L-BLK', size: 'L', color: 'Black', cost: 150, ean: '6223001000072' },
      { sku: 'BOLD-JG-007-M-GRY', size: 'M', color: 'Gray', cost: 150, ean: '6223001000073' },
    ]},
  ];

  const allVariants: any[] = [];
  for (const p of productsData) {
    const prod = await prisma.product.create({
      data: {
        name_en: p.name_en,
        brand: p.brand,
        category_id: p.category_id,
        has_variants: true,
        variants: {
          create: p.variants.map(v => ({
            sku: v.sku,
            barcode_ean13: v.ean,
            barcode_internal: v.sku,
            size: v.size,
            color: v.color,
            cost_price: v.cost,
            return_count: 0,
          }))
        }
      },
      include: { variants: true }
    });
    allVariants.push(...prod.variants.map(v => ({ ...v, product_name: p.name_en, brand: p.brand })));
  }

  // Inventory
  for (const v of allVariants) {
    await prisma.inventoryStock.create({ data: { branch_id: b1.id, variant_id: v.id, qty_on_hand: Math.floor(Math.random()*20)+2, last_sold_at: Math.random() > 0.3 ? new Date(Date.now() - Math.random()*60*86400000) : null }});
    await prisma.inventoryStock.create({ data: { branch_id: b2.id, variant_id: v.id, qty_on_hand: Math.floor(Math.random()*12), last_sold_at: Math.random() > 0.5 ? new Date(Date.now() - Math.random()*90*86400000) : null }});
  }

  // Pricing rules
  await prisma.pricingRule.create({ data: { name: 'Global Default EG', scope_type: 'global', overhead_percent: 20, profit_percent: 35, tax_percent: 14, formula: 'compound', is_protected: true, priority: 999 }});
  await prisma.pricingRule.create({ data: { name: 'Jeans – 45% Profit', scope_type: 'category', scope_id: cat_j.id, overhead_percent: 20, profit_percent: 45, tax_percent: 14, formula: 'compound', priority: 50 }});
  await prisma.pricingRule.create({ data: { name: 'T-Shirts – 30% Profit', scope_type: 'category', scope_id: cat_t.id, overhead_percent: 20, profit_percent: 30, tax_percent: 14, formula: 'compound', priority: 50 }});

  // Customers
  const custData = [
    { name: 'أحمد محمد', phone: '01011111111', total_invoices: 6, total_spent: 2450, is_vip: true },
    { name: 'محمود علي', phone: '01022222222', total_invoices: 3, total_spent: 890, is_vip: false },
    { name: 'كريم سامي', phone: '01033333333', total_invoices: 8, total_spent: 3200, is_vip: true },
    { name: 'عمر خالد', phone: '01044444444', total_invoices: 1, total_spent: 320, is_vip: false },
    { name: 'يوسف حسن', phone: '01055555555', total_invoices: 2, total_spent: 650, is_vip: false },
    { name: 'مصطفى إبراهيم', phone: '01066666666', total_invoices: 4, total_spent: 1400, is_vip: false },
    { name: 'عبدالله', phone: '01077777777', total_invoices: 1, total_spent: 280, is_vip: false },
    { name: 'سيف', phone: '01088888888', total_invoices: 0, total_spent: 0, is_vip: false },
  ];
  const customers = [];
  for (const c of custData) {
    customers.push(await prisma.customer.create({ data: { name: c.name, phone: c.phone, whatsapp: c.phone, is_vip: c.is_vip, total_invoices: c.total_invoices, total_spent: c.total_spent }}));
  }

  // Sales Invoices – 15 with items
  const paymentMethods = ['cash','card','instapay','vodafone_cash','installment'];
  const salesInvoices = [];
  for (let i=0; i<15; i++) {
    const branch = i %3 ===0 ? b2 : b1;
    const customer = customers[i % customers.length];
    const itemCount = Math.floor(Math.random()*3)+1;
    const items = [];
    let subtotal = 0;
    for (let j=0; j<itemCount; j++) {
      const v = allVariants[Math.floor(Math.random()*allVariants.length)];
      const qty = 1;
      const unit_cost = Number(v.cost_price);
      const unit_price = Math.round(unit_cost * 1.2 * 1.35); // net
      subtotal += unit_price * qty;
      items.push({ variant_id: v.id, qty, unit_price, unit_cost });
    }
    const tax_amount = Math.round(subtotal * 0.14);
    const total = subtotal + tax_amount;
    const inv = await prisma.salesInvoice.create({
      data: {
        invoice_number: `BOLD-2026${String(1001+i).padStart(4,'0')}`,
        branch_id: branch.id,
        customer_id: Math.random() > 0.3 ? customer.id : null,
        cashier_id: cashier.id,
        status: 'completed',
        subtotal, tax_amount, total,
        payment_method: paymentMethods[i % paymentMethods.length],
        language: 'ar',
        created_at: new Date(Date.now() - Math.random()*30*86400000),
        items: { create: items }
      }
    });
    salesInvoices.push(inv);
  }

  // Returns – 2
  for (let i=0; i<2 && i < salesInvoices.length; i++) {
    const s = salesInvoices[i];
    await prisma.return.create({ data: {
      original_invoice_id: s.id,
      branch_id: s.branch_id,
      return_invoice_number: `R-${s.invoice_number}`,
      reason: 'مقاس غير مناسب',
      is_partial: true,
      created_by: cashier.id
    }});
  }

  // Purchase Invoices – 3 with line items
  const pi1 = await prisma.purchaseInvoice.create({ data: {
    supplier_id: s1.id, branch_id: b1.id, invoice_number: 'SUP-2026-001',
    subtotal: 4200, discount_amount: 200, discount_percent: 0, total: 4000,
    created_by: warehouse.id,
    items: { create: [
      { variant_id: allVariants[0].id, qty: 50, unit_cost: 80 },
      { variant_id: allVariants[1].id, qty: 30, unit_cost: 80 },
      { variant_id: allVariants[4].id, qty: 20, unit_cost: 130 },
    ]}
  }});
  await prisma.purchaseInvoice.create({ data: {
    supplier_id: s2.id, branch_id: b1.id, invoice_number: 'SUP-2026-002',
    subtotal: 3100, discount_amount: 155, discount_percent: 5, total: 2945,
    created_by: warehouse.id,
    items: { create: [
      { variant_id: allVariants[5].id, qty: 15, unit_cost: 160 },
      { variant_id: allVariants[6].id, qty: 10, unit_cost: 90 },
    ]}
  }});
  await prisma.purchaseInvoice.create({ data: {
    supplier_id: s3.id, branch_id: b2.id, invoice_number: 'SUP-2026-003',
    subtotal: 5600, discount_amount: 300, discount_percent: 0, total: 5300,
    created_by: warehouse.id,
    items: { create: [
      { variant_id: allVariants[10].id, qty: 25, unit_cost: 175 },
      { variant_id: allVariants[15].id, qty: 20, unit_cost: 140 },
    ]}
  }});

  // Transfers – 2 with items
  const tr1 = await prisma.transfer.create({ data: {
    from_branch_id: b1.id, to_branch_id: b2.id,
    transfer_number: 'TR-2026001', status: 'received', created_by: manager.id,
    items: { create: [
      { variant_id: allVariants[0].id, qty: 5 },
      { variant_id: allVariants[2].id, qty: 3 },
    ]}
  }});
  await prisma.transfer.create({ data: {
    from_branch_id: b2.id, to_branch_id: b1.id,
    transfer_number: 'TR-2026002', status: 'pending', created_by: manager.id,
    items: { create: [
      { variant_id: allVariants[5].id, qty: 2 },
    ]}
  }});

  // Offer suggestions – 3
  for (const v of allVariants.slice(0,3)) {
    const cost = Number(v.cost_price);
    const current = Math.round(cost * 1.2 * 1.35 * 1.14);
    const min_allowed = Math.round(cost * 1.2 * 1.14);
    await prisma.offerSuggestion.create({ data: {
      variant_id: v.id, branch_id: b1.id, days_unsold: 95,
      current_price: current,
      suggested_price: Math.round((current + min_allowed)/2),
      min_allowed_price: min_allowed,
      status: 'pending'
    }});
  }

  console.log(`
✅ Bold POS Test Data v2.1 – Full

Branches: 2
Users: 4 – all password Bold1234
  owner:            +200100000000
  branch_manager:   +200100000001
  cashier:          +200100000002
  warehouse:        +200100000003
Suppliers: 3
Categories: 3
Products: 12 – Variants: ${allVariants.length}
Customers: 8 – VIP: 01011111111, 01033333333
Sales Invoices: 15 – with items
Returns: 2
Purchase Invoices: 3 – WITH line items
Transfers: 2 – WITH line items
Pricing Rules: 3
Offers: 3

Test barcode: 6223001000011
Test customer: 01011111111
API: http://localhost:3000/api/docs
`);
}

main().catch(e=>{ console.error(e); process.exit(1)}).finally(()=>prisma.$disconnect());
