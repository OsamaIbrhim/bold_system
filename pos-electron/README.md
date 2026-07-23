# Bold POS – Electron

Offline-first cashier app built with React, Vite, Electron, and a local sql.js
database. See the repository [full installation and operations guide](../README.md)
for API/database setup, deployment, recovery, and security guidance.

## Behavior

- Sales, local stock changes, and outbox commands commit in one transaction.
- Pending sales upload before a new product/price/stock snapshot is accepted.
- Automatic synchronization runs at login, every 15 seconds, and after network
  reconnection; operators can also select **Sync now**.
- Multi-page change pulls must reach a strictly advancing final cursor before
  catalog validity is restored. A partial, stalled, or excessive pull keeps
  checkout blocked instead of exposing a half-applied catalog.
- The header shows real API online/offline state, last successful sync, pending
  sale count, and the last error.
- A manager-issued, one-use code enrolls the stable device ID. The resulting
  secret is encrypted with Electron `safeStorage`; Admin can display, rename,
  monitor, or revoke the terminal.
- Access, refresh, device, and offline-accounting credentials remain in the
  Electron main process. The renderer receives only non-secret user, terminal,
  and authorization metadata.
- SQLite mutations are persisted atomically. If the database file cannot be
  replaced, the in-memory transaction is restored and the cashier sees a
  failure instead of a false successful sale.
- An enrolled terminal and a cashier/branch-manager login from the same branch
  are both required for sales, returns, synchronization, and heartbeats.
- Every app start returns to cashier login instead of silently reopening the
  previous session. After one successful online login, the same cashier can
  unlock an unexpired open shift offline using a salted `scrypt` verifier; the
  password itself is never stored.
- Printing uses a main-process-owned window lifecycle. Print cancellation is
  reported separately and cannot undo or duplicate a saved sale.
- Held sales are stored in the durable SQLite database, scoped to the current
  branch, cashier, and shift. Resuming a draft rebuilds every line from the
  current signed price catalog and available stock; open drafts block shift
  closure until they are completed or deleted.

## Run

```bash
npm ci
npm run dev:electron
```

The development build uses `http://localhost:3000/api/v1`. Override it before
starting Electron when the backend runs elsewhere:

```bash
BOLD_API_URL=http://192.168.1.20:3000/api/v1 npm run dev:electron
```

For a packaged build, define `BOLD_API_URL` in the process environment before
launching the app. API origins cannot be changed from DevTools because that
would allow renderer content to redirect protected credentials.

## Reset a test installation

The supported DevTools reset commands deliberately clear credentials inside
the main process without returning them to the renderer:

```js
await window.bold.api_clear_session()
location.reload()
```

To clear both terminal enrollment and cashier login:

```js
await window.bold.api_clear_device()
location.reload()
```

## Test and build

```bash
npm test
npm run test:soft
npm run build
npm run dist   # Windows NSIS installer
```

Preserve Electron's `bold_pos.sqlite` file whenever pending outbox sales exist.
Never re-enter a sale after a print error until its `sync_id` is checked.
