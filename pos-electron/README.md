# Bold POS – Electron

Offline-first cashier app for Bold Men's Clothing.

- React + Vite + Electron 31
- Local SQLite: products, stock, outbox
- Barcode scanner (USB HID keyboard) – auto-focus input
- Cart, Customer phone, Payments: نقدي / فيزا / انستا باي / فودافون كاش / تقسيط
- Sale saved locally with sync_id, auto-sync every 15s when online
- Print AR/EN – ESC/POS stub ready
- RTL Arabic UI, product names in English

## Run
```
npm install
npm run dev
# in second terminal:
npx electron .
```

## Config
Open DevTools Console:
```
localStorage.setItem('branch_id', 'YOUR-BRANCH-UUID')
localStorage.setItem('token', 'YOUR_JWT')
localStorage.setItem('bold_api', 'http://localhost:3000/api/v1')
```

The app will pull products/stock from `/sync/pull` and push sales to `/pos/sale`.

Offline: sales go to outbox, stock decremented locally. Reconnect = auto upload.

Build installer:
```
npm run build
npx electron-builder
```
