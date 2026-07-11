# Bold POS API – NestJS + Prisma

Multi-branch, offline-first POS for Bold Men's Clothing – Egypt

## Quick start
```
cp .env.example .env
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run prisma:seed
npm run start:dev
```
API: http://localhost:3000/api/v1
Docs: http://localhost:3000/api/docs

Seed login: phone `+200100000000` / password `Bold1234` – role: owner

## Modules
- Auth – JWT, Argon2, RBAC (owner / branch_manager / cashier / warehouse_manager)
- Pricing – compound engine, protected overhead, min_allowed_price
- Products – search by EAN-13 / internal barcode, stock_by_branch
- Inventory – lookup across branches
- Sales – POST /api/v1/pos/sale – sync_id idempotent, stock decrement
- Returns – POST /api/v1/pos/return – 14-day window, return_count++, QA flag
- Purchasing – bulk receive, discount % / EGP, OCR import stub
- Customers – phone/WhatsApp, VIP pricing tier
- Transfers – branch-to-branch
- Reports – sales / profit / best sellers
- Offers – slow-stock suggestions (90d default)
- Notifications – Email / WhatsApp Cloud API
- Sync – /sync/push /sync/pull for Electron POS

All tables are e-commerce ready. Same API powers future online store.

AR/EN i18n ready, EGP, tax configurable.
