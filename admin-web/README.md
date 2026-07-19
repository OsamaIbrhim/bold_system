# Bold Admin – Next.js

Arabic RTL administration application for Bold POS. See the repository
[full installation and operations guide](../README.md) for database migrations,
deployment, recovery, security, and troubleshooting.

## Run

```bash
npm ci
NEXT_PUBLIC_API=http://localhost:3000/api/v1 npm run dev
```

Open `http://localhost:3001`. Development seed owner credentials are documented
in the root guide.

## Implemented pages

- Dashboard and reports.
- Paginated products (20 per page) and branch inventory.
- Paginated sales invoices, invoice detail, PDF, and return history.
- Customers, suppliers, purchasing, pricing, offers, and transfers.
- Branches, users/roles, shifts, registered POS terminals, and settings.

Navigation is built from the capabilities returned by `/auth/me`. Backend role
and branch guards remain authoritative. Invoice data is read directly from the
central database and refreshed every 30 seconds; terminal state refreshes every
20 seconds.

## Verify

```bash
npm run build
```
