# Bold POS – Electron

Offline-first cashier app for Bold Men's Clothing.

- React + Vite + Electron 31
- Local SQLite: products, stock, outbox
- Barcode scanner (USB HID keyboard) – auto-focus input
- Cart, Customer phone, Payments: نقدي / فيزا / انستا باي / فودافون كاش / تقسيط
- Sale saved locally with sync_id, auto-sync every 15s when online
- Cashier login with rotating refresh sessions and server-derived branch identity
- Online original-invoice returns with remaining-quantity enforcement
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
The cashier signs in inside the app. To point a development build at another API,
open DevTools Console once and set:
```
localStorage.setItem('bold_api', 'http://localhost:3000/api/v1')
```

The app will pull products/stock from `/sync/pull` and push sales to `/pos/sale`.

Offline: sales are committed to the outbox and local stock in one SQLite
transaction. Reconnect uploads pending sales before accepting a fresh stock snapshot.

Build installer:
```
npm run build
npx electron-builder
```
