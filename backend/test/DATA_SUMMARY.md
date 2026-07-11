# Bold POS – Test Data Summary
`prisma/seed.ts` – run: `npx prisma migrate reset --force` then seed auto-runs

## Counts

| Entity | Count | Notes |
|---|---|---|
| Branches | 2 | BOLD-01 طنطا (Main), BOLD-02 القاهرة الجديدة |
| Users | 4 | owner +200100000000, manager +200100000001, cashier +200100000002, warehouse +200100000003 – all password: **Bold1234** |
| Suppliers | 3 | Mohamed Fabrics (alias: Mohamed Trading), El-Nasr Trading, Classic Wear |
| Categories | 3 | T-Shirts, Shirts, Jeans |
| Products | 12 | Classic T-Shirt, Polo Shirt, Slim Jeans, Oxford Shirt, Graphic Tee, Chino Pants, V-Neck Tee, Linen Shirt, Cargo Jeans, Henley Tee, Denim Shirt, Jogger Pants |
| Variants / SKUs | 28 | Sizes: S/M/L/XL / 32/34/36 – Colors: Black/White/Navy/Gray/Blue/Beige/Olive/Indigo – Cost: 80–230 EGP |
| Barcodes | 28 EAN-13 + 28 internal | Example: `6223001000011` – Classic T-Shirt S Black – Cost 85 EGP |
| Inventory Stock rows | 56 | 28 variants × 2 branches – qty 0–25 |
| Pricing Rules | 3 | Global: 20% overhead / 35% profit / 14% tax – Jeans: 45% profit – T-Shirts: 30% profit – formula: compound |
| Customers | 8 | Phones 01011111111 … 01088888888 – VIP: 01011111111, 01033333333 – Loyalty eligible: same |
| Sales Invoices | 15 | Across both branches – payment methods: cash, card, instapay, vodafone_cash, installment – linked to customers |
| Sales Invoice Items | ~30 | – |
| Returns | 2 | Linked to original invoices – 14-day window – return_count tracked |
| Purchase Invoices | 3 | From the 3 suppliers – with discounts % / EGP |
| Transfers | 2 | BOLD-01 ↔ BOLD-02 – 1 received, 1 pending |
| Offer Suggestions | 3 | Slow stock >90 days – suggested price never below cost+overhead |

## Test barcodes (scan these in POS)
- `6223001000011` – Classic T-Shirt S Black – 85 EGP cost
- `6223001001011` – Slim Jeans 32 Blue – 210 EGP cost
- `6223001000031` – Oxford Shirt M White – 165 EGP cost

## Test customers
- `01011111111` – Ahmed – VIP – 6 invoices – 2450 EGP – loyalty eligible
- `01033333333` – Karim – VIP – 8 invoices – 3200 EGP – loyalty eligible
- `01022222222` – Mahmoud – regular – 3 invoices

## Test users
All password: `Bold1234`
- Owner: `+200100000000`
- Branch Manager: `+200100000001`
- Cashier: `+200100000002` – NO cost prices
- Warehouse: `+200100000003`

## API test file
`test/api-test.http` – 32 traced endpoints – import into VSCode REST Client – login first, copy token to `@token`

Run seed:
```
cd bold_system/backend
npx prisma migrate reset --force
# seed runs automatically
npm run start:dev
```
