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
| POS product/price/stock cache | POS SQLite snapshot |

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

Redis and S3/R2 variables exist in `.env.example`, but the current application
does not depend on them for its implemented workflows.

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

### 4. Start the POS application

Open another terminal:

```bash
cd pos-electron
npm ci
npm run dev:electron
```

The cashier signs in inside the application. The assigned branch comes from
the authenticated user record; it is not selected or trusted from the sale
payload.

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

1. Login verifies an active user with Argon2.
2. The API returns a short-lived JWT access token and a random refresh token.
3. Only the refresh-token SHA-256 hash is stored in PostgreSQL.
4. Refreshing revokes the presented token and creates a new token in one
   transaction.
5. Every authenticated API request reloads the current role, branch, and active
   state from PostgreSQL. Disabling or moving a user takes effect immediately.
6. Logout revokes the current refresh token.

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

## Core business workflows

### Sale

1. The POS records the command locally with a UUID `sync_id`.
2. The API checks the authenticated cashier's branch.
3. Duplicate variants are aggregated.
4. Active pricing rules and product cost are loaded on the server.
5. Available stock is atomically checked as `qty_on_hand - qty_reserved`.
6. Stock, invoice lines, tax snapshots, customer totals, and cashier identity
   are committed together.
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

### Offline sale guarantees

- A local sale is rejected if cached stock is insufficient.
- Stock decrement, local receipt, and outbox insert share one SQLite transaction.
- Replaying the same local `sync_id` does not decrement stock again.
- The sync loop uploads pending sales before pulling a server snapshot.
- If any upload fails, the POS does not overwrite its locally reserved stock
  with a newer server snapshot.

### Current synchronization model

`GET /sync/pull` intentionally returns a full branch snapshot. It does not
pretend to be incremental because the current product, pricing, and stock
tables do not all have a reliable change cursor.

`POST /sync/push` returns `501 Not Implemented`. Sales are uploaded through the
idempotent `/pos/sale` command endpoint.

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

### Look up an invoice for return

```bash
curl 'http://localhost:3000/api/v1/pos/invoices/lookup?reference=INVOICE_NUMBER' \
  -H "Authorization: Bearer $TOKEN"
```

### Create a return

```bash
curl -X POST http://localhost:3000/api/v1/pos/return \
  -H "Authorization: Bearer $TOKEN" \
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

### Backend tests

```bash
cd backend
npm ci
npm test -- --runInBand
npm run build
```

The current suite covers authentication refresh rotation, role enforcement,
server-authoritative sales, insufficient and reserved stock, return fraud and
quantity controls, Arabic invoice PDFs, pricing-rule selection, transactional
purchasing, transfer transitions, and shift cash calculations.

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
3. Runs all backend tests.
4. Builds the API, Admin, and POS applications.
5. Runs high-severity dependency audit gates.

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
9. Confirm pending POS outboxes are empty or understood.
10. End the maintenance window and monitor errors and stock movement.

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
- Sign in each till with a user assigned to the correct branch.
- Perform the initial online snapshot before allowing offline sales.
- Verify the configured thermal printer and Windows cash-drawer behavior.
- Back up or preserve the POS SQLite file whenever an outbox is pending.

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

### Browser reports a CORS error

Add the exact Admin/POS origin to `CORS_ORIGINS` and restart the API. Packaged
Electron file renderers may send the literal origin `null`; this is why the
default development list contains both `file://` and `null`.

### POS opens but contains no products

- Confirm the user is assigned to a branch.
- Confirm the first login happened while online.
- Confirm `/sync/pull?branch_id=...` succeeds for that user.
- Confirm the API has products, pricing rules, and branch stock.
- Inspect the Electron console and preserve the SQLite file before resetting
  any local data.

### POS sales remain pending

- Check API reachability and token refresh.
- Search the API/database for the sale's `sync_id` before retrying manually.
- Check for server rejection caused by insufficient stock, an inactive branch,
  or a deleted variant.
- Do not pull/overwrite or delete the outbox manually; the fail-closed behavior
  is protecting the local stock reservation.

### Transfer cannot ship

The transfer must be `pending`, the actor must control the source branch (or be
an owner/warehouse manager), and every line must have enough unreserved source
stock.

### Transfer cannot receive

The transfer must already be `shipped`, and the actor must control the
destination branch (or be an owner/warehouse manager).

### Arabic invoice PDF fails

Run `npm ci` in `backend/`. The Cairo Arabic WOFF font is loaded from the pinned
`@fontsource/cairo` dependency; there is no separately downloaded TTF file.

### Migration fails on a constraint or unique index

Do not edit the migration or assign arbitrary replacement data. Restore a copy
of the database, identify the invalid rows described under migration
preconditions, reconcile them with the business owner, and rehearse again.

## Known limitations

The following work is still required or intentionally incomplete:

1. **No append-only stock ledger.** `InventoryStock` is transactionally updated,
   but the project does not yet have a single immutable `InventoryMovement`
   table covering sale, return, purchase, transfer, and adjustment events.
2. **Snapshot sync only.** Product, price, and stock pulls are full snapshots.
   There is no durable server change cursor or sync-event journal.
3. **No POS conflict-resolution screen.** A permanently rejected outbox sale
   remains pending and prevents a snapshot pull so stock is not silently
   overwritten.
4. **Offers are review records, not live promotions.** Approval records status
   and an audit entry but does not publish a dated fixed-price promotion.
5. **Exchange workflow is absent.** The POS supports linked returns, not a
   combined return-and-replacement transaction.
6. **Several Admin surfaces remain minimal.** Sales history, purchase receiving,
   shifts, settings, and reconciliation need complete operator interfaces.
7. **OCR import is a stub.** Supplier invoice OCR returns a draft placeholder.
8. **Notifications require external verification.** Email and WhatsApp code is
   present but depends on real provider credentials and has not been validated
   against the user's production accounts.
9. **Client token storage needs hardening.** Admin and POS currently keep refresh
   tokens in renderer/browser local storage. Production should use HttpOnly
   cookies for Admin and Electron `safeStorage` or an OS keychain for POS.
10. **No device enrollment model.** The system has users and branches but no
    registered till/device identity, certificate, remote revocation, or POS
    configuration policy.
11. **No login rate limiter or MFA.** Add rate limiting, monitoring, lockout
    policy, and preferably MFA for owner accounts before public exposure.
12. **Money handling is mixed.** Purchasing and shifts use Prisma Decimal, while
    some pricing/report calculations still use JavaScript numbers. Standardize
    all financial calculation through a shared decimal/money module.
13. **Database integration/E2E coverage is incomplete.** Unit tests and builds
    pass, but a real PostgreSQL integration suite and browser/Electron E2E suite
    are still needed.
14. **Admin has two moderate transitive PostCSS advisories.** npm reports no fix
    in the current Next.js 15 dependency line; continue monitoring or validate a
    controlled Next.js 16/React 19 upgrade.

## Recommended next architecture phase

Keep the modular monolith and add two shared foundations:

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

### 2. Sync event journal

In the same transaction as every sync-relevant change, write a monotonically
ordered event containing entity type, entity ID, branch scope, operation, and
version. POS devices can then pull events after a durable cursor instead of
downloading full snapshots.

Add explicit outbox states:

```text
pending -> sending -> accepted
                   -> rejected -> reconciled/voided
```

### Follow-on foundations

- Add a real `Promotion` model with branch scope, fixed or percentage price,
  validity window, approval, and pricing-engine precedence.
- Add a `Device`/`Till` model and move refresh-token storage into platform-safe
  storage.
- Centralize financial rounding in a decimal money service.
- Add PostgreSQL integration tests around concurrent sale, return, purchase,
  and transfer operations.

These changes provide stronger auditability and reliable incremental offline
sync without introducing the operational cost of microservices.