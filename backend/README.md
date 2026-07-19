# Bold POS API – NestJS + Prisma

Multi-branch, offline-first POS for Bold Men's Clothing – Egypt

## Quick start
Requires Node.js 20.11 or newer and PostgreSQL.

```
cp .env.example .env
# Set JWT_SECRET to a unique value with at least 32 characters.
# For local PostgreSQL, DIRECT_URL can match DATABASE_URL.
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
- Auth – short-lived JWT access tokens, rotating hashed refresh tokens, bcryptjs, RBAC
- Pricing – compound engine, protected overhead, min_allowed_price
- Products – search by EAN-13 / internal barcode, stock_by_branch
- Inventory – lookup across branches
- Sales – server-priced, idempotent, transactional stock decrement
- Returns – original-line lookup, 14-day window, concurrency-safe quantities, refund snapshots
- Purchasing – atomic invoice/stock receipt, discount % / EGP, weighted cost, OCR import stub
- Customers – phone/WhatsApp, VIP pricing tier
- Transfers – authorized pending → shipped → received lifecycle with guarded stock
- Reports – sales / profit / best sellers
- Offers – slow-stock suggestions (90d default)
- Notifications – Email / WhatsApp Cloud API
- Sync – first branch snapshot followed by durable cursor-based product, price,
  and stock deltas; sales upload through idempotent command endpoints

All business endpoints require a JWT. Role authorization is enforced
server-side, with reusable branch scoping on branch-owned resources. Login,
refresh, and logout are the only public application endpoints.

AR/EN i18n ready, EGP, tax configurable.
