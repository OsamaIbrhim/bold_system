# Bold POS

Bold POS is a multi-branch point-of-sale and inventory system for a men's
clothing retailer in Egypt. The repository contains a NestJS/PostgreSQL API,
an Arabic RTL Next.js administration application, and an offline-first
Electron cashier application.

This guide covers local installation, configuration, database setup,
application workflows, testing, production deployment, backup and recovery,
and the limitations that remain before a production launch.

## Contents

- [System status](#system-status)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [Environment configuration](#environment-configuration)
- [Database setup and migrations](#database-setup-and-migrations)
- [Running each application](#running-each-application)
- [Accounts, authentication, and roles](#accounts-authentication-and-roles)
- [Core business workflows](#core-business-workflows)
- [Offline POS behavior](#offline-pos-behavior)
- [API examples](#api-examples)
- [Testing and CI](#testing-and-ci)
- [Production deployment](#production-deployment)
- [Backup and recovery](#backup-and-recovery)
- [Security checklist](#security-checklist)
- [Troubleshooting](#troubleshooting)
- [Known limitations](#known-limitations)
- [Recommended next architecture phase](#recommended-next-architecture-phase)

## System status

The current codebase includes the following safeguards:

- JWT authentication is default-deny across the API.
- Access tokens are short lived; refresh tokens are opaque, hashed in the
  database, rotated on use, and revocable.
- Roles and branch ownership are checked server-side.
- API payloads use validated DTOs and reject unknown properties.
- Sales, returns, purchases, transfers, and shift closure use database
  transactions for their related writes.
- Sale prices, costs, cashier identity, branch identity, and refund totals are
  derived or verified by the server.
- Sales are idempotent by `sync_id`.
- Sale and transfer stock deductions are atomic and respect reserved stock.
- Returns lock original sale lines and cannot exceed the remaining returnable
  quantity.
- Financial reports account for completed returns and exclude VAT from profit.
- The POS commits a local sale, its outbox command, and its local stock change
  in one SQLite transaction.
- Admin product and sales lists load automatically and use server-side pages of
  20 records instead of unbounded browser-side lists.
- POS terminals use a manager-issued, one-use enrollment code, keep the
  resulting device credential in Electron `safeStorage`, publish heartbeat and
  sync state, and can be monitored or revoked from Admin.
- Initial POS synchronization is a complete branch snapshot; subsequent pulls
  use a durable PostgreSQL change cursor and transfer only changed catalog,
  price, and stock records.
- API failures have stable error codes, Arabic/English guidance, field names,
  and a request reference ID that support can locate in server logs.
- Receipt printing is isolated from sale persistence: cancelling or failing a
  print cannot undo, duplicate, or crash a completed local sale.
- CI validates the Prisma schema, runs backend tests, builds all applications,
  and blocks high-severity dependency advisories.

This is not yet a turn-key production release. Read [Known limitations](#known-limitations)
and complete the [Production deployment](#production-deployment) checklist
before using real business data.

## Architecture

```mermaid
flowchart TD
    Admin["Admin Web<br/>Next.js"] --> API["Bold API<br/>NestJS"]
    POS["Cashier POS<br/>Electron + local SQLite"] --> API
    API --> DB["PostgreSQL<br/>system of record"]
    API --> Notify["SMTP / WhatsApp<br/>optional integrations"]
    POS --> Outbox["Local outbox<br/>offline sales"]
    Outbox --> API
```

The code is intentionally a modular monolith. Business modules share one API
and one PostgreSQL database, while transaction boundaries preserve consistency
between invoices, stock, returns, and audit records. There is no need to split
the system into microservices at its current scale.

### Sources of truth

| Concern | Source of truth |
| --- | --- |
| Users, roles, branches, refresh sessions | PostgreSQL via the API |
| Product catalog and pricing rules | PostgreSQL via the API |
| Official invoices and returns | PostgreSQL via the API |
| Current server stock | PostgreSQL `InventoryStock` |
| Unsynchronized cashier sales | POS SQLite outbox |
| POS product/price/stock cache | POS SQLite snapshot plus incremental cursor |
| POS device identity | Enrolled secret in Electron `safeStorage`; hash in PostgreSQL `PosTerminal` |
| POS last reported state | PostgreSQL `PosTerminal` heartbeat fields |
| POS last successful local synchronization | POS SQLite `sync_meta` |

The POS cache is not authoritative. The server re-prices and re-validates every
uploaded sale.

## Repository layout

```text
bold_system/
├── .github/workflows/ci.yml   # Build, test, schema, and audit gates
├── backend/                   # NestJS API and Prisma data model
│   ├── prisma/
│   │   ├── migrations/        # Ordered PostgreSQL migrations
│   │   ├── schema.prisma      # Current database schema
│   │   └── seed.ts            # Destructive development seed
│   ├── src/                   # API modules
│   └── test/                  # Manual HTTP examples
├── admin-web/                 # Arabic RTL Next.js administration UI
└── pos-electron/              # Offline-first Electron cashier UI
```

## Prerequisites

Install the following before starting:

- Node.js `20.11` or newer.
- npm compatible with the installed Node.js version.
- PostgreSQL 14 or newer.
- Git, if working from the repository rather than the ZIP archive.
- Windows when building the NSIS POS installer locally. Development builds can
  run on Linux or macOS, but the configured distributable target is Windows.

Optional services:

- An SMTP provider for email reports.
- A Meta WhatsApp Cloud API account for WhatsApp reports.

The current application does not require Redis or S3/R2 for its implemented
workflows.

Confirm the toolchain:

```bash
node --version
npm --version
psql --version
```

## Quick start

The commands below assume PostgreSQL is already running locally.

### 1. Create the database

```bash
createdb bold_pos
```

Alternatively, from `psql`:

```sql
CREATE DATABASE bold_pos;
```

### 2. Configure and start the API

```bash
cd backend
cp .env.example .env
```

Edit `.env` before starting. At minimum, set valid database URLs and a unique
JWT secret with 32 or more characters. A safe development secret can be
generated with:

```bash
openssl rand -hex 32
```

Then install, migrate, seed, and run:

```bash
npm ci
npx prisma generate
npx prisma migrate deploy
npm run prisma:seed
npm run start:dev
```

The API should be available at:

- API base: `http://localhost:3000/api/v1`
- Swagger UI: `http://localhost:3000/api/docs`

> **Warning:** `npm run prisma:seed` deletes existing sales, returns,
> purchases, transfers, stock, products, customers, users, shifts, and related
> records before creating sample data. Never run it against a production or
> shared database.

### 3. Start the Admin application

Open another terminal:

```bash
cd admin-web
npm ci
NEXT_PUBLIC_API=http://localhost:3000/api/v1 npm run dev
```

Open `http://localhost:3001`.

### 4. Enroll and start the POS application

Open another terminal:

```bash
cd pos-electron
npm ci
npm run dev:electron
```

Before the first cashier login:

1. Sign in to Admin as an owner or branch manager.
2. Open **POS terminals**.
3. Select the branch, enter a descriptive till name, and create an enrollment
   code. The 12-character code expires after 10 minutes and works once.
4. Enter that code on the POS setup screen while the terminal is online.
5. Sign in with a cashier or branch-manager account assigned to the same
   branch.

The terminal remains bound to that branch. Cashiers cannot select or alter the
sale branch. An owner account is not a cashier account; create a branch-bound
cashier or manager for POS operation.

### Development seed accounts

All development seed users use the password `Bold1234`:

| Role | Phone |
| --- | --- |
| Owner | `+200100000000` |
| Branch manager | `+200100000001` |
| Cashier | `+200100000002` |
| Warehouse manager | `+200100000003` |

These credentials are for local development only. Replace or remove all seed
accounts before using a persistent environment.

## Environment configuration

The API reads `backend/.env`. Start from `backend/.env.example`.

### Required API variables

| Variable | Purpose | Example |
| --- | --- | --- |
| `DATABASE_URL` | Application PostgreSQL connection | `postgresql://postgres:postgres@localhost:5432/bold_pos` |
| `DIRECT_URL` | Direct connection used by Prisma migrations | Same as `DATABASE_URL` locally |
| `JWT_SECRET` | JWT signing secret; must be unique, non-default, and at least 32 characters | Output of `openssl rand -hex 32` |
| `PORT` | API port | `3000` |
| `CORS_ORIGINS` | Comma-separated allowed browser/Electron origins | `http://localhost:3001,http://localhost:5173,file://,null` |

For hosted PostgreSQL using a pooler, point `DATABASE_URL` at the pooler and
`DIRECT_URL` at the provider's non-pooled PostgreSQL endpoint.

### Session variables

| Variable | Default | Format |
| --- | --- | --- |
| `JWT_EXPIRES` | `15m` | Value supported by the JWT library, such as `15m` or `1h` |
| `REFRESH_EXPIRES` | `30d` | Integer followed by `m`, `h`, or `d` |
| `POS_ONLINE_THRESHOLD_MS` | `90000` | Time without a heartbeat before Admin derives a terminal as offline |
| `POS_ENROLLMENT_TTL_MS` | `600000` | Lifetime of a one-use terminal enrollment code |
| `AUTH_RECHECK_TTL_MS` | `1000` | Coalesce concurrent JWT user rechecks; `0` disables caching, maximum is 5000 ms |
| `LIST_COUNT_CACHE_MS` | `5000` | Short cache for identical product/invoice pagination counts; maximum is 30000 ms |
| `SLOW_REQUEST_MS` | `500` | API duration that produces a structured slow-request warning |
| `HTTP_TIMING_LOGS` | `false` | Log timings for every request instead of only slow requests |

Do not make access tokens long lived to compensate for UI problems. The Admin
and POS applications automatically rotate refresh tokens after a `401`.

### Notification variables

| Variable | Purpose |
| --- | --- |
| `SMTP_HOST` | SMTP server; email remains a stub when empty |
| `SMTP_PORT` | SMTP port, normally `587` |
| `SMTP_USER` / `SMTP_PASS` | SMTP credentials |
| `SMTP_FROM` | Sender address |
| `REPORT_EMAIL_TO` | Report recipient |
| `WHATSAPP_TOKEN` | Meta WhatsApp Cloud API token |
| `WHATSAPP_PHONE_ID` | WhatsApp Cloud phone-number ID |
| `REPORT_WHATSAPP_TO` | Report recipient in international format |

Keep secrets outside source control. Use the deployment platform's secret
manager in production.

### Admin variable

`NEXT_PUBLIC_API` is the browser-visible API base URL. It is embedded at build
time for a production Next.js build:

```bash
NEXT_PUBLIC_API=https://api.example.com/api/v1 npm run build
```

### POS API address

The POS defaults to `http://localhost:3000/api/v1`. For a development build,
set another address once in Electron DevTools and restart:

```js
localStorage.setItem('bold_api', 'https://api.example.com/api/v1')
```

For a managed production rollout, replace this manual setting with an installer
or device-enrollment configuration before distributing the application.

## Database setup and migrations

### New database

From `backend/`:

```bash
npm ci
npx prisma generate
npx prisma migrate deploy
```

Use `prisma migrate deploy` for existing, shared, staging, and production
databases. It applies committed migrations without generating a new migration.

### Creating a migration during development

After intentionally changing `prisma/schema.prisma`:

```bash
npx prisma migrate dev --name describe_the_change
npx prisma validate
npx prisma generate
```

Commit both the schema change and the generated migration directory.

### Important migration preconditions

The integrity migrations intentionally surface invalid historical data rather
than assigning it to arbitrary branches. Before production migration, check for:

- Returns whose original invoice no longer exists.
- Transfers containing unknown status strings.
- Transfer items with zero or negative quantities.
- Multiple open shifts for the same branch.
- Duplicate pending offer suggestions for the same branch and variant.
- User references that point to deleted users.

The terminal-observability migration creates `PosTerminal` and restores the
`SalesInvoice(branch_id, created_at)` index used by the paginated Admin invoice
query. It does not rewrite existing invoice or stock data.

The performance migrations enable PostgreSQL `pg_trgm`, add search/list and
hot pagination/relation indexes, add one-use terminal enrollment, create
`SyncChange` triggers, and record the enrolled terminal on every new POS sale.
Existing invoices keep a nullable terminal field because their physical source
cannot be reconstructed.
The migration user therefore needs permission to install `pg_trgm`; most hosted
PostgreSQL providers expose it as an allowed extension. Existing automatically
registered terminals have no device credential and must be enrolled once after
this upgrade. No sales or outbox rows are deleted by that process.

Always rehearse migrations against a recent restored production backup first.

### Prisma commands

```bash
npx prisma validate          # Validate schema configuration
npx prisma generate          # Regenerate the typed client
npx prisma migrate status    # Show applied/pending migrations
npx prisma migrate deploy    # Apply committed migrations
npx prisma studio            # Local database browser; do not expose publicly
```

## Running each application

### API development

```bash
cd backend
npm run start:dev
```

The API fails at startup when `JWT_SECRET` is missing, shorter than 32
characters, or begins with `change-me`. This is intentional.

### API production build

```bash
cd backend
npm ci
npx prisma generate
npm run build
npm run start:prod
```

The production entry point is `backend/dist/src/main.js`.

### Admin development

```bash
cd admin-web
npm ci
NEXT_PUBLIC_API=http://localhost:3000/api/v1 npm run dev
```

### Admin production

```bash
cd admin-web
npm ci
NEXT_PUBLIC_API=https://api.example.com/api/v1 npm run build
NEXT_PUBLIC_API=https://api.example.com/api/v1 npm run start
```

The configured production port is `3001`.

### POS development

```bash
cd pos-electron
npm ci
npm run dev:electron
```

### POS production package

Build the configured Windows NSIS installer on Windows:

```bash
cd pos-electron
npm ci
npm run dist
```

Use `npm run pack` for an unpacked directory build. The POS data file is named
`bold_pos.sqlite` and is stored in Electron's platform-specific `userData`
directory. Preserve that file when troubleshooting unsynchronized sales.

## Accounts, authentication, and roles

### Session behavior

1. Login verifies an active user with bcrypt.
2. The API returns a short-lived JWT access token and a random refresh token.
3. Only the refresh-token SHA-256 hash is stored in PostgreSQL.
4. Refreshing revokes the presented token and creates a new token in one
   transaction.
5. Every authenticated API request reloads the current role, branch, and active
   state from PostgreSQL. Disabling or moving a user takes effect immediately.
6. Logout revokes the current refresh token.

Admin currently stores its browser session in local storage. The POS does not:
Electron encrypts its cashier session and terminal credential at rest with the
operating system through `safeStorage`. POS startup rejects missing, malformed,
`null`, or `undefined` branch/session values and verifies the cached user with
`GET /auth/me` whenever the server is reachable.

### POS device and cashier identities

POS authorization has two independent layers:

1. An owner or branch manager creates a short-lived enrollment code for one
   branch through `POST /terminals/enrollment-codes`.
2. The untrusted terminal exchanges it once through public
   `POST /terminals/enroll` and receives a random device credential. Only its
   SHA-256 hash is stored by the API.
3. A cashier or branch manager assigned to the same branch signs in.
4. Sales, returns, sync pulls, invoice-return lookups, and heartbeats require
   both the cashier JWT and the enrolled device credential.
5. Revoking a terminal removes its credential. Re-enabling it requires a new
   enrollment code; an old copied credential cannot come online again.

The first enrollment and first cashier login require connectivity. A previously
validated cashier session may unlock offline for at most 24 hours. Logout ends
the cashier session without removing the device enrollment.

### Role overview

| Area | Owner | Branch manager | Cashier | Warehouse manager |
| --- | --- | --- | --- | --- |
| Users and new branches | Yes | No | No | No |
| Product search | All branches/cost | Own branch/cost | Own branch/no cost | All branches/cost |
| Product mutations | Yes | Yes | No | Yes |
| Customer lookup/create | Yes | Yes | Yes | Yes |
| Customer VIP/update/delete | Yes | Yes | No | No |
| Sales and returns | Yes | Own branch | Own branch | No |
| Purchasing | All branches | Own branch | No | All branches |
| Transfers | All branches | Participating branch | No | All branches |
| Reports and offers | All branches | Own branch | No | No |
| Shifts | All branches | Own branch | Own branch | No |

The API remains the authority even if a client hides a button. Never rely on
frontend visibility for authorization.

`GET /auth/me` returns the current user and effective capability list. Admin
uses that list to build its navigation. The owner receives every Admin
capability; branch-scoped roles see only the applicable operational sections.

### Validation and support references

API errors use this safe contract:

```json
{
  "code": "INSUFFICIENT_STOCK",
  "message": "The requested quantity is not available.",
  "message_ar": "الكمية المطلوبة غير متاحة.",
  "field": "quantity",
  "request_id": "0cfd..."
}
```

Admin and POS display the Arabic guidance next to the relevant field and keep
the user's entered data available for correction. Expected input, permission,
stock, enrollment, and connectivity failures do not expose stack traces.
Unexpected failures show the request reference ID; use that ID and timestamp to
find the matching protected API log entry. Passwords, access tokens, refresh
tokens, and device credentials must never be included in support screenshots or
logs.

## Core business workflows

### Sale

1. The POS records the command locally with a UUID `sync_id`.
2. The API checks the authenticated cashier's branch.
3. Duplicate variants are aggregated.
4. Active pricing rules and product cost are loaded on the server.
5. Available stock is atomically checked as `qty_on_hand - qty_reserved`.
6. Stock, invoice lines, tax snapshots, customer totals, cashier identity, and
   enrolled terminal identity are committed together.
7. Replaying the same `sync_id` returns the existing invoice without deducting
   stock twice.

The client must not send unit price, cost, tax, cashier ID, or profit.

### Return

1. The POS looks up the official invoice number or invoice UUID online.
2. The API returns sale-line IDs and remaining returnable quantities without
   exposing cost.
3. The cashier selects quantities from the original lines.
4. The API enforces branch ownership and the 14-day window.
5. Each sale line is locked before prior returns are summed.
6. Refund subtotal, tax, total, stock restoration, customer totals, and QA
   counters are committed together.

Returns cannot be created for arbitrary variants and cannot exceed the original
quantity minus completed earlier returns.

### Purchase receipt

1. An owner, warehouse manager, or authorized branch manager submits a supplier,
   branch, items, quantities, and unit costs.
2. The API validates the active branch, supplier, and variants.
3. The API calculates subtotal and either an amount discount or percentage
   discount. Supplying both is rejected.
4. Invoice creation, stock increments, and discounted weighted-average product
   cost updates are committed together.

### Transfer

The lifecycle is:

```text
pending -> shipped -> received
```

- Creating a transfer does not change stock.
- Shipping is authorized against the source branch and atomically removes
  available source stock.
- Receiving is authorized against the destination branch and adds exactly the
  quantities stored on the transfer. The client cannot replace them during
  receipt.
- Invalid or repeated state transitions return a conflict response.

### Shift close

Closing cash is compared with:

```text
opening cash + completed cash sales - completed returns of cash sales
```

Only one open shift per branch is permitted. Both a database partial unique
index and a transaction advisory lock protect this invariant.

### Pricing

Pricing-rule priority is:

```text
variant -> product -> brand -> category -> global
```

The compound calculation is:

```text
net = cost × (1 + overhead%) × (1 + profit%)
tax = selling total - net
selling total = net × (1 + tax%)
```

Money snapshots are written to sale lines so later rule changes do not rewrite
historical invoices.

## Offline POS behavior

### Local tables

The Electron main process maintains:

- `products`: synced SKU, barcode, display name, net price, and tax snapshot.
- `stock`: cached branch quantities.
- `sales_local`: local receipts keyed by `sync_id`.
- `outbox`: commands waiting to reach the API.
- `sync_meta`: stable device ID, terminal name, last successful sync, state,
  and latest error.

### Offline sale guarantees

- A local sale is rejected if cached stock is insufficient.
- Stock decrement, local receipt, and outbox insert share one SQLite transaction.
- Replaying the same local `sync_id` does not decrement stock again.
- The sync loop uploads pending sales before pulling a server snapshot.
- If any upload fails, the POS does not overwrite its locally reserved stock
  with a newer server snapshot.

### Current synchronization model

The POS synchronizes immediately after login, every 15 seconds thereafter,
when the operating system reports that connectivity returned, and on demand
through **Sync now**. Each cycle publishes a heartbeat, uploads pending sales,
pulls server changes only after every upload succeeds, saves the server cursor
and timestamp, and publishes the final state and pending count.

The status badge therefore represents real API reachability rather than only
the browser network flag. Admin derives online state from `last_seen_at`; the
default threshold is 90 seconds and can be changed with
`POS_ONLINE_THRESHOLD_MS`.

The first `GET /sync/pull` returns a full active catalog and branch-stock
snapshot plus a cursor. PostgreSQL triggers append relevant product, variant,
pricing-rule, and inventory changes to `SyncChange`. Later requests send the
cursor and receive only affected variants and branch stock. Catalog-wide price
or product changes request a safe local catalog reset. The cursor is advanced
inside the same local SQLite transaction that applies the delta, so an
interrupted update is replayed rather than skipped.

Pricing for a snapshot or delta is calculated in bulk: active rules are loaded
once instead of querying the product and all rules for every variant. API
responses larger than 1 KiB are compressed.

`POST /sync/push` returns `501 Not Implemented`. Sales are uploaded through the
idempotent `/pos/sale` command endpoint.

Receipt printing runs after the local sale transaction. A cancelled or failed
print reports **sale saved, printing failed** and the `sync_id`; it does not
roll back the sale. Do not enter that transaction again—check its outbox or
the central invoice list and reprint instead.

If a pending sale is permanently rejected by the server, preserve the POS
SQLite database and investigate before attempting manual edits. The current UI
does not yet provide an outbox conflict-resolution screen.

## API examples

Use Swagger at `/api/docs` for the complete generated route list.

### Login

```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"phone":"+200100000002","password":"Bold1234"}'
```

Save the returned access token in a shell variable for development examples:

```bash
TOKEN='paste-access-token-here'
```

### Refresh

```bash
curl -X POST http://localhost:3000/api/v1/auth/refresh \
  -H 'Content-Type: application/json' \
  -d '{"refresh_token":"paste-refresh-token-here"}'
```

Refresh tokens rotate. Replace the locally stored refresh token with the new
one returned by every successful refresh.

### Create a sale

```bash
curl -X POST http://localhost:3000/api/v1/pos/sale \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-pos-device-id: $DEVICE_ID" \
  -H "x-pos-device-token: $DEVICE_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "sync_id":"11111111-1111-4111-8111-111111111111",
    "branch_id":"BRANCH_UUID",
    "customer_phone":"01012345678",
    "items":[{"variant_id":"VARIANT_UUID","qty":1}],
    "payment_method":"cash",
    "language":"ar"
  }'
```

### List Admin products and invoices

```bash
curl 'http://localhost:3000/api/v1/products?q=&page=1&page_size=20' \
  -H "Authorization: Bearer $TOKEN"

curl 'http://localhost:3000/api/v1/sales?page=1&page_size=20&from=2026-07-01&to=2026-07-31' \
  -H "Authorization: Bearer $TOKEN"
```

`/products/search` remains a backward-compatible maximum-20-result lookup for
installed POS clients. Admin uses the paginated `/products` endpoint.

### Publish and inspect terminal status

```bash
# Owner/manager creates a 10-minute one-use code.
curl -X POST http://localhost:3000/api/v1/terminals/enrollment-codes \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"branch_id":"BRANCH_UUID","name":"Main till 1"}'

# The new device exchanges the code once; save DEVICE_TOKEN with safeStorage.
curl -X POST http://localhost:3000/api/v1/terminals/enroll \
  -H 'Content-Type: application/json' \
  -d '{
    "enrollment_code":"12_CHAR_CODE",
    "device_id":"11111111-1111-4111-8111-111111111111",
    "name":"Main till 1",
    "app_version":"1.2.0"
  }'

curl -X POST http://localhost:3000/api/v1/terminals/heartbeat \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-pos-device-token: $DEVICE_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "device_id":"11111111-1111-4111-8111-111111111111",
    "name":"Main till 1",
    "app_version":"1.0.0",
    "sync_status":"success",
    "last_sync_at":"2026-07-19T18:00:00.000Z",
    "pending_count":0
  }'

curl http://localhost:3000/api/v1/terminals \
  -H "Authorization: Bearer $TOKEN"
```

### Look up an invoice for return

```bash
curl 'http://localhost:3000/api/v1/pos/invoices/lookup?reference=INVOICE_NUMBER' \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-pos-device-id: $DEVICE_ID" \
  -H "x-pos-device-token: $DEVICE_TOKEN"
```

### Create a return

```bash
curl -X POST http://localhost:3000/api/v1/pos/return \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-pos-device-id: $DEVICE_ID" \
  -H "x-pos-device-token: $DEVICE_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "original_invoice_id":"INVOICE_UUID",
    "items":[{"sales_invoice_item_id":"SALE_LINE_UUID","qty":1}],
    "reason":"Wrong size"
  }'
```

### Receive a purchase

```bash
curl -X POST http://localhost:3000/api/v1/purchasing/receive \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "supplier_id":"SUPPLIER_UUID",
    "branch_id":"BRANCH_UUID",
    "invoice_number":"SUP-1001",
    "discount_percent":5,
    "items":[{"variant_id":"VARIANT_UUID","qty":10,"unit_cost":125.50}]
  }'
```

### Create and process a transfer

```bash
curl -X POST http://localhost:3000/api/v1/transfers \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "from_branch_id":"SOURCE_BRANCH_UUID",
    "to_branch_id":"DESTINATION_BRANCH_UUID",
    "items":[{"variant_id":"VARIANT_UUID","qty":3}]
  }'

curl -X POST http://localhost:3000/api/v1/transfers/TRANSFER_UUID/ship \
  -H "Authorization: Bearer $TOKEN"

curl -X POST http://localhost:3000/api/v1/transfers/TRANSFER_UUID/receive \
  -H "Authorization: Bearer $TOKEN"
```

## Testing and CI

The repository has two deliberately separate gates. **Soft** checks answer
"can this revision run correctly?". **Hard** checks answer "does it remain
correct and responsive under volume and concurrency?". A performance failure
must not be hidden inside an ordinary unit-test run.

### Soft suite

Run every foundational check from the repository root:

```bash
npm run test:soft
```

This runs backend unit/contract tests and builds, the production Admin build,
and POS unit tests plus its production build. Individual commands are:

```bash
cd backend
npm ci
npm run test:soft

cd ../admin-web
npm ci
npm run test:soft

cd ../pos-electron
npm ci
npm run test:soft
```

The soft suite covers refresh rotation, permission enforcement, server-owned
pricing, decimal totals, atomic stock, idempotent sales, return concurrency,
Arabic/English PDF font embedding and pagination, product/invoice pagination,
one-use terminal enrollment, device credential enforcement, stale POS session
rejection, incremental synchronization, outbox safety, purchasing, transfers,
shifts, and structured user-facing errors.

### Hard smoke and load suites

Hard tests require a running API and a dedicated PostgreSQL database. Never
point volume seeding at production. The volume seeder refuses to run unless the
database URL contains `bold_perf`, unless the operator explicitly overrides the
safety gate.

Prepare a representative performance database:

```bash
cd backend
npm ci
npx prisma migrate deploy
npm run prisma:seed
PERF_PRODUCTS=10000 PERF_INVOICES=50000 npm run perf:seed
npm run build
npm run start:prod
```

The volume seeder is restartable: deterministic identifiers plus
`skipDuplicates` allow an interrupted or repeated run to add only missing
products, stock rows, invoices, and invoice lines. Keep the same product and
invoice targets when resuming a partially completed seed.

From another terminal, run a short gate:

```bash
cd backend
PERF_LOGIN_PHONE=+200100000000 \
PERF_LOGIN_PASSWORD=Bold1234 \
npm run test:hard:smoke
```

Run the full default load profile:

```bash
PERF_LOGIN_PHONE=+200100000000 \
PERF_LOGIN_PASSWORD=Bold1234 \
PERF_CONCURRENCY=25 \
PERF_REQUESTS_PER_WORKER=20 \
PERF_READ_P95_MS=300 \
npm run test:hard
```

The full runner first verifies that the performance database contains at least
10,000 products and 50,000 invoices. If it reports `DATASET_TOO_SMALL`, run the
volume seeder; use `test:hard:smoke` for a deliberately small development data
set. `PERF_REQUIRE_VOLUME=0` is available only for diagnostics and must not be
used as release qualification.

The runner warms each route, measures a single-client baseline, then exercises
first-page and deep-page product/invoice queries, an initial POS snapshot, and
an empty incremental pull. It reports request count, throughput, error rate,
p50/p95/p99 client latency, API `server_p95_ms`, time outside the server, and
timing-header coverage. Requests time out after 15 seconds by default; change
that diagnostic ceiling with `PERF_REQUEST_TIMEOUT_MS`.

Unlike the earlier fail-fast script, every readable scenario completes and all
threshold or correctness failures are collected in the final `summary` record.
Defaults are p95 below 300 ms and unexpected errors below 0.5% for the full
profile. Calibrate budgets on hardware comparable to production; do not weaken
them merely to make an overloaded host pass.

Interpret the timing split as follows:

- High `server_p95_ms`: inspect PostgreSQL pool waiting, slow-query plans, API
  CPU, and `SLOW` log entries.
- Low server time but high `outside_server_p95_ms`: inspect the client/server
  hosts, HTTP socket queuing, proxy, antivirus, or network path.
- Missing `server-timing`: rebuild and restart the API from the same source
  before trusting the result.

Set `PERF_MUTATIONS=1` on an isolated performance database to run concurrent
real sales as well. That phase generates unique `sync_id` values, retries an
accepted command, and then queries PostgreSQL directly to assert: exactly one
invoice per command, no duplicate stock deduction, non-negative stock, and
exact line subtotal + tax = invoice total using decimal arithmetic. Its default
sale budget is p95 below 500 ms.

The scheduled CI profile seeds 10,000 products and 50,000 invoices. For release
qualification, increase `PERF_PRODUCTS`, `PERF_INVOICES`, concurrency, and
duration to match expected three-year volume, then perform a 30–60 minute soak
while monitoring PostgreSQL CPU, locks, connections, API memory, and slow logs.

### Schema validation

Prisma validation requires both connection variables to exist even when it
does not connect to the database:

```bash
cd backend
DATABASE_URL=postgresql://user:password@localhost:5432/bold \
DIRECT_URL=postgresql://user:password@localhost:5432/bold \
npx prisma validate
```

### Admin and POS builds

```bash
cd admin-web
npm ci
npm run build

cd ../pos-electron
npm ci
npm run build
```

### Dependency audits

```bash
cd backend && npm audit
cd ../admin-web && npm audit --omit=dev
cd ../pos-electron && npm audit --omit=dev
```

At the time of this guide, backend and POS audits report zero vulnerabilities.
The Admin dependency tree reports two moderate transitive PostCSS advisories
inside Next.js 15 for which npm reports no available fix. CI blocks high or
critical advisories.

### GitHub Actions

`.github/workflows/ci.yml` runs on pull requests and pushes to `master`. It:

1. Installs each application from its lockfile with `npm ci`.
2. Validates the Prisma schema.
3. Runs all soft tests and builds.
4. Starts a real PostgreSQL 16 service, deploys migrations, seeds test data,
   starts the API, and runs the hard smoke thresholds.
5. Runs high-severity dependency audit gates.
6. On a nightly schedule or manual dispatch, adds the large deterministic
   dataset and runs the full hard load profile.

## Production deployment

### Before the first deployment

- Create a PostgreSQL backup and prove it can be restored.
- Rehearse all migrations against a restored copy of real data.
- Replace all development seed users and passwords.
- Generate a unique production `JWT_SECRET`.
- Configure HTTPS for both Admin and API endpoints.
- Set an exact production `CORS_ORIGINS` list. Do not use wildcard origins.
- Configure `NEXT_PUBLIC_API` before building Admin.
- Decide how the packaged POS discovers the API without DevTools.
- Configure process supervision for the API and Admin applications.
- Centralize logs and database monitoring.
- Test SMTP and WhatsApp using non-production recipients first.
- Run smoke tests for sale, retry, return, purchase, transfer, report, and POS
  reconnection.

### Recommended order

1. Put the application into a controlled maintenance window.
2. Back up PostgreSQL.
3. Deploy the new API source and install from `package-lock.json`.
4. Run `npx prisma migrate deploy` using `DIRECT_URL`.
5. Run `npx prisma generate` and `npm run build`.
6. Start the API and verify health through Swagger/login.
7. Build and deploy Admin with the correct public API URL.
8. Test one non-critical POS device before broad rollout.
9. Confirm the device appears in Admin with the correct branch, heartbeat,
   version, pending count, and last successful synchronization.
10. Confirm pending POS outboxes are empty or understood.
11. End the maintenance window and monitor errors and stock movement.

### API host

```bash
cd backend
npm ci
npx prisma generate
npx prisma migrate deploy
npm run build
npm run start:prod
```

Run the process behind a reverse proxy that terminates TLS, limits request
sizes, sets appropriate timeouts, and forwards the original client address.
Do not expose PostgreSQL or Prisma Studio publicly.

### Admin host

```bash
cd admin-web
npm ci
NEXT_PUBLIC_API=https://api.example.com/api/v1 npm run build
NEXT_PUBLIC_API=https://api.example.com/api/v1 npm run start
```

Because `NEXT_PUBLIC_API` is public browser configuration, it must contain an
HTTPS URL reachable from cashier/admin networks.

### POS rollout

- Build a signed Windows installer where possible.
- Enroll a small pilot group first.
- In Admin → **POS terminals**, issue one enrollment code per physical till.
- Enter the code on that till within 10 minutes, then sign in with a cashier or
  branch manager assigned to the same branch.
- Perform the initial online snapshot before allowing offline sales.
- Verify the configured thermal printer and Windows cash-drawer behavior.
- Back up or preserve the POS SQLite file whenever an outbox is pending.
- Verify the terminal code, application version, branch, last connection, last
  successful synchronization, and pending count in Admin.
- Revocation invalidates the device secret. To restore a revoked device,
  re-enable it in Admin, issue a new one-use enrollment code, and enroll it
  again; the old secret remains invalid.

## Backup and recovery

### Backup

Use PostgreSQL's custom format so individual objects can be inspected and
restored:

```bash
pg_dump --format=custom --file=bold_pos_YYYYMMDD.dump "$DIRECT_URL"
```

Store backups encrypted, outside the application host, and according to a
defined retention policy.

### Verify a backup

Listing a dump is not a complete restore test, but catches obviously damaged
files:

```bash
pg_restore --list bold_pos_YYYYMMDD.dump > backup_contents.txt
```

Regularly restore into a separate database and run smoke tests:

```bash
createdb bold_pos_restore_test
pg_restore --clean --if-exists --no-owner \
  --dbname=bold_pos_restore_test bold_pos_YYYYMMDD.dump
```

Never test a restore over the live production database.

### POS recovery

If a workstation fails while sales are pending:

1. Stop the POS application.
2. Copy the complete Electron `userData` directory, including
   `bold_pos.sqlite`.
3. Work on a duplicate of the file.
4. Do not delete outbox rows manually without matching the official server
   invoice state by `sync_id`.

## Security checklist

- [ ] Production database and `.env` are not committed to source control.
- [ ] `JWT_SECRET` is randomly generated, unique, and at least 32 characters.
- [ ] Seed credentials are removed or changed.
- [ ] HTTPS is mandatory for API and Admin traffic.
- [ ] `CORS_ORIGINS` contains only expected Admin, development, and packaged POS
      origins.
- [ ] PostgreSQL accepts connections only from approved application/migration
      hosts.
- [ ] Database backups are encrypted and restore-tested.
- [ ] SMTP and WhatsApp credentials are stored in a secret manager.
- [ ] Owner accounts are limited and reviewed.
- [ ] Disabled users and branch assignments are tested operationally.
- [ ] CI passes before deployment.
- [ ] Dependency audits contain no high or critical finding.
- [ ] Rate limiting and login abuse protection are added at the reverse proxy or
      API before public exposure.
- [ ] POS workstations use OS accounts, disk encryption, and restricted
      physical access.

## Troubleshooting

### API fails with `JWT_SECRET must be configured`

The secret is missing, too short, or starts with `change-me`. Generate a new
value and restart:

```bash
openssl rand -hex 32
```

### Prisma reports `P1001` or cannot reach PostgreSQL

- Confirm PostgreSQL is running.
- Verify host, port, username, password, and database in both URLs.
- Confirm firewall and hosted-provider allowlists.
- Use a direct endpoint for `DIRECT_URL` when `DATABASE_URL` uses a pooler.

### Prisma validation says `DIRECT_URL` is missing

Add `DIRECT_URL` to `backend/.env`. It may equal `DATABASE_URL` for a local
PostgreSQL instance.

### Admin redirects to login repeatedly

- Confirm the API URL is correct and reachable from the browser.
- Check the browser network panel for `401` or CORS errors.
- Clear old `token`, `refresh_token`, and `user` local-storage values, then
  sign in again.
- Confirm the user is active.

### Admin owner cannot see invoices or other menu entries

- Open `GET /api/v1/auth/me` with the current session and confirm the role is
  `owner` and the response includes `sales.read` plus the other capabilities.
- Sign out and sign in again after upgrading so the browser replaces any
  capability-free user object saved by an older release.
- Confirm Admin points to the upgraded API, not an older server on another
  port or host.
- If the sidebar says permissions could not be loaded, restore API connectivity
  and sign in again. It intentionally does not guess permissions client-side.

Invoices are under **فواتير المبيعات**. The page loads the newest 20 records
immediately, updates while visible every 30 seconds, and supports date, payment,
branch, invoice-number, customer-name, and customer-phone filters. Empty and
loading pages show an explanatory state instead of an unlabelled blank area.

### Browser reports a CORS error

Add the exact Admin/POS origin to `CORS_ORIGINS` and restart the API. Packaged
Electron file renderers may send the literal origin `null`; this is why the
default development list contains both `file://` and `null`.

### POS opens but contains no products

- Confirm the device was enrolled for the intended branch and the cashier is
  assigned to that same branch.
- Confirm enrollment, first login, and the first snapshot happened online.
- Confirm `/sync/pull?branch_id=...` succeeds for that user.
- Confirm the API has products, pricing rules, and branch stock.
- Check `sync_meta.sync_cursor`; do not edit it manually. **Sync now** safely
  retries the current cursor.
- Inspect the Electron console and preserve the SQLite file before resetting
  any local data.

### POS asks for enrollment or shows an undefined branch

Install a build produced after generated `src/*.js` files were removed. Those
files previously shadowed the current TypeScript and could open the old UI.
The current startup rejects literal `undefined`/`null` branch values and clears
legacy renderer tokens. Create a fresh one-use code in Admin → **POS terminals**
and enroll the device. Do not copy the encrypted credential file between tills.

### A user sees an error reference number

Ask for the exact operation, time, terminal code, and displayed reference ID.
Search centralized API logs for the bracketed request ID. The UI message is
safe to share; do not request passwords, tokens, device secrets, or the full
secure-state file. Validation errors should identify the field that needs
correction. A `500 INTERNAL_ERROR` requires server-log investigation; retrying
financial operations blindly can create confusion even though sale `sync_id`
is idempotent.

### POS sales remain pending

- Check API reachability and token refresh.
- Search the API/database for the sale's `sync_id` before retrying manually.
- Check for server rejection caused by insufficient stock, an inactive branch,
  or a deleted variant.
- Do not pull/overwrite or delete the outbox manually; the fail-closed behavior
  is protecting the local stock reservation.

### Hard test reports a BigInt serialization error

Rebuild and restart the API from current source. Sync cursors are decimal
strings in the public contract, and the Express adapter has a scoped fallback
for any future database `BigInt`. Do not patch `BigInt.prototype.toJSON`; that
changes global JavaScript behavior and can hide a service returning the wrong
type. Confirm the hard-test snapshot reports `"cursor_type":"string"`.

### Hard test is slow with only seed data

The full suite requires `npm run perf:seed`; otherwise it records
`DATASET_TOO_SMALL`. The baseline records still help diagnose the machine. A
large API time means the server/database is slow; a large outside-server time
means the delay is in sockets, proxy, host contention, or the network. Always
run `npm run build` and `npm run start:prod` for performance qualification—not
the TypeScript watcher—and keep the API and test runner in separate terminals.

### Transfer cannot ship

The transfer must be `pending`, the actor must control the source branch (or be
an owner/warehouse manager), and every line must have enough unreserved source
stock.

### Transfer cannot receive

The transfer must already be `shipped`, and the actor must control the
destination branch (or be an owner/warehouse manager).

### Arabic invoice PDF fails

Run `npm ci` and `npm run build` in `backend/`. The renderer embeds complete
DejaVu Sans regular/bold TTF files from the pinned `dejavu-fonts-ttf` package.
It must not be changed back to a browser WOFF language subset or manually
reverse/pre-shape Arabic strings; both cause missing boxes or disconnected
mixed Arabic/number text. Run the PDF tests and visually render one Arabic and
one English sample before release.

### Electron reports `Object has been destroyed`

Install a POS build containing the single-owner print-window lifecycle. Older
builds printed and closed the receipt window from both renderer JavaScript and
the Electron callback. The current build prints only from the main process and
reports printing separately from the saved sale. Before re-entering a sale
from an older build, check its `sync_id` in the local outbox and Admin invoices.

### POS is online but Admin shows it offline

Confirm the POS can reach `/api/v1/terminals/heartbeat`, its user is assigned
to the expected branch, the device was enrolled for that branch, and the
terminal has not been revoked. The default
online window is 90 seconds; configure `POS_ONLINE_THRESHOLD_MS` on the API to
change it.

### Migration fails on a constraint or unique index

Do not edit the migration or assign arbitrary replacement data. Restore a copy
of the database, identify the invalid rows described under migration
preconditions, reconcile them with the business owner, and rehearse again.

## Known limitations

The following work is still required or intentionally incomplete:

1. **No append-only stock ledger.** `InventoryStock` is transactionally updated,
   but the project does not yet have a single immutable `InventoryMovement`
   table covering sale, return, purchase, transfer, and adjustment events.
2. **Initial snapshots are not paginated.** Subsequent sync is cursor-based and
   incremental, but a brand-new till still receives the active catalog and
   branch stock in one compressed response. Very large catalogs should add
   resumable snapshot pages and retention/compaction for `SyncChange`.
3. **No POS conflict-resolution screen.** A permanently rejected outbox sale
   remains pending and prevents a snapshot pull so stock is not silently
   overwritten.
4. **Offers are review records, not live promotions.** Approval records status
   and an audit entry but does not publish a dated fixed-price promotion.
5. **Exchange workflow is absent.** The POS supports linked returns, not a
   combined return-and-replacement transaction.
6. **Advanced reconciliation remains absent.** Admin now covers sales history,
   purchase receiving, shifts, roles, branches, and terminals, but there is no
   dedicated inventory variance/reconciliation workflow yet.
7. **OCR import is a stub.** Supplier invoice OCR returns a draft placeholder.
8. **Notifications require external verification.** Email and WhatsApp code is
   present but depends on real provider credentials and has not been validated
   against the user's production accounts.
9. **Admin browser token storage needs hardening.** POS credentials now use
   Electron `safeStorage`, but Admin still stores refresh tokens in browser
   local storage. A production internet-facing Admin should use Secure,
   HttpOnly, SameSite cookies and CSRF protection.
10. **Terminal identity is secret-bound, not hardware-bound.** Enrollment codes,
    hashed device credentials, branch binding, encrypted local storage, and
    revocation are implemented. High-risk deployments may additionally require
    OS-backed client certificates or hardware attestation.
11. **No login rate limiter or MFA.** Add rate limiting, monitoring, lockout
    policy, and preferably MFA for owner accounts before public exposure.
12. **Money handling is not yet universal.** Pricing, sale totals, and return
    totals now calculate with Prisma Decimal, while a few reporting and legacy
    UI calculations still convert to JavaScript numbers. Continue moving every
    financial formula into the shared server boundary.
13. **End-to-end coverage is incomplete.** CI now deploys migrations to real
    PostgreSQL and runs hard smoke/load gates, but browser automation, packaged
    Electron printer tests, and a concurrent mutation/soak environment on
    production-equivalent hardware are still required.
14. **Admin has two moderate transitive PostCSS advisories.** npm reports no fix
    in the current Next.js 15 dependency line; continue monitoring or validate a
    controlled Next.js 16/React 19 upgrade.

## Recommended next architecture phase

Keep the modular monolith. The next shared foundation should be:

### 1. Inventory movement ledger

Create an immutable movement table with at least:

```text
id, branch_id, variant_id, quantity_delta, movement_type,
source_type, source_id, source_line_id, actor_id, occurred_at
```

Enforce a unique source key so retries cannot create duplicate movements.
Derive or reconcile the current stock projection from the ledger. Route sale,
return, purchase, transfer ship/receive, and manual adjustment through one
inventory domain service.

### 2. Incremental-sync hardening

The monotonically ordered `SyncChange` journal and POS cursor now exist. The
next iteration should paginate first-time snapshots, compact old changes only
after every active device has advanced past them, expose device cursor lag in
Admin, and add a rejected-command reconciliation screen.

Add explicit outbox states:

```text
pending -> sending -> accepted
                   -> rejected -> reconciled/voided
```

### Follow-on foundations

- Add a real `Promotion` model with branch scope, fixed or percentage price,
  validity window, approval, and pricing-engine precedence.
- Consider hardware-bound terminal certificates where the threat model requires
  more than the current enrolled secret and OS encryption.
- Finish moving report and legacy UI financial rounding into the decimal money
  boundary.
- Add PostgreSQL integration tests around concurrent sale, return, purchase,
  and transfer operations.

These changes provide stronger auditability and reliable incremental offline
sync without introducing the operational cost of microservices.
