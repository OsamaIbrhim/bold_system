# Bold POS – Electron

Offline-first cashier app built with React, Vite, Electron, and a local sql.js
database. See the repository [full installation and operations guide](../README.md)
for API/database setup, deployment, recovery, and security guidance.

## Behavior

- Sales, local stock changes, and outbox commands commit in one transaction.
- Pending sales upload before a new product/price/stock snapshot is accepted.
- Automatic synchronization runs at login, every 15 seconds, and after network
  reconnection; operators can also select **Sync now**.
- The header shows real API online/offline state, last successful sync, pending
  sale count, and the last error.
- A manager-issued, one-use code enrolls the stable device ID. The resulting
  secret is encrypted with Electron `safeStorage`; Admin can display, rename,
  monitor, or revoke the terminal.
- An enrolled terminal and a cashier/branch-manager login from the same branch
  are both required for sales, returns, synchronization, and heartbeats.
- Printing uses a main-process-owned window lifecycle. Print cancellation is
  reported separately and cannot undo or duplicate a saved sale.

## Run

```bash
npm ci
npm run dev:electron
```

For a different development API, set this once in DevTools and restart:

```js
localStorage.setItem('bold_api', 'http://localhost:3000/api/v1')
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
