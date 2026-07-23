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
Liveness: http://localhost:3000/api/v1/health/live
Readiness: http://localhost:3000/api/v1/health/ready

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
refresh, logout, liveness, and readiness are the only public application
endpoints.

AR/EN i18n ready, EGP, tax configurable.

## Railway production deployment

The API intentionally refuses to start with missing, reused, placeholder, or
legacy cryptographic secrets. Configure all of these Railway variables before
deploying:

```
NODE_ENV=production
DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...
JWT_SECRET=<unique random value of at least 32 characters>
PRICE_SNAPSHOT_KEYS=price-YYYY-MM=<different random value>
POS_OFFLINE_TICKET_KEYS=offline-YYYY-MM=<third different random value>
CORS_ORIGINS=https://bold-system.vercel.app
```

Remove the obsolete `PRICE_SNAPSHOT_SECRET` and `PRICE_SNAPSHOT_SECRETS`
variables. Generate each secret independently with `openssl rand -hex 32`;
never copy the CI values or commit production values.

Use this Railway pre-deploy command:

```
npm run prisma:migrate:deploy
```

Use `npm run start:prod` as the start command and
`/api/v1/health/ready` as the health-check path. A `503` readiness response
means the process is running but PostgreSQL is unavailable; a failed process
startup means the required environment contract was rejected.

### Required release gate

Backend releases must follow this path:

```
feature branch -> pull request -> release-gate -> master -> Railway
```

Protect `master` in GitHub and require the uniquely named `release-gate`
status check. Disable direct pushes and require the branch to be up to date
before merging. In Railway, enable **Wait for CI** for the connected GitHub
branch. Railway must keep `npm run prisma:migrate:deploy` as its pre-deploy
command; never put seeding or `prisma migrate resolve` in deployment commands.

The CI migration gate performs all of the following before a release can
reach Railway:

- rejects edits or deletions of migrations already present in the target
  branch;
- rejects a Prisma schema change without a new forward-only migration;
- applies the complete migration chain twice to an empty PostgreSQL schema;
- builds the previous release, seeds representative data, and upgrades it
  with the proposed migrations;
- applies the upgrade twice, checks migration status, and detects Prisma
  schema drift.

Run the immutable-history check locally against the exact target commit:

```
npm run prisma:migrations:policy -- --base origin/master
```

New database changes must be added in a new timestamped migration. A failed
production migration must stop the release and be investigated; do not edit
an applied migration and do not use `migrate resolve --applied` to bypass the
gate. `prisma/migration-repairs.json` records the one historic transfer
incident as an exact old/new checksum pair. It cannot authorize later edits
to that migration.

### Recovering the failed transfer-state migration

Migration `202607230002_transfer_state_machine` originally re-added the
existing `TransferItem_qty_positive` constraint. PostgreSQL committed its
earlier DDL before that duplicate constraint failed, so do not mark the failed
migration as applied and do not manually drop the committed columns.

After deploying the corrected migration file, run:

```
npx prisma migrate resolve --rolled-back 202607230002_transfer_state_machine
npm run prisma:migrate:deploy
```

Run `npm run prisma:seed` only against an isolated development or test
database. It intentionally resets accounting, purchase, inventory-ledger, and
transfer data. The reset is blocked in production and requires:

```
ALLOW_DEVELOPMENT_ACCOUNTING_RESET=reset-development-accounting
```

A disposable remote test database additionally requires:

```
ALLOW_REMOTE_DEVELOPMENT_ACCOUNTING_RESET=1
```
