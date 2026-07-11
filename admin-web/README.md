# Bold Admin – Next.js

Admin dashboard for Bold POS – Arabic RTL

- Next.js 14 App Router
- Tailwind + RTL
- TanStack Query ready
- API: http://localhost:3000/api/v1

Pages:
- /login – JWT login
- / – Dashboard
- /products – Barcode search
- /inventory – Branch stock lookup
- /sales – Sales / Returns info
- /customers – Loyalty lookup
- /pricing – Pricing engine calculator
- /offers – Slow-stock suggestions
- /transfers – Branch transfers
- /reports – Sales / Profit
- /settings – System settings

Run:
```
npm install
npm run dev
# http://localhost:3001
# login: +200100000000 / Bold1234
```

Set API endpoint:
```
NEXT_PUBLIC_API=http://localhost:3000/api/v1 npm run dev
```

UI is Arabic-first, product names in English, invoices AR/EN selectable.
Feed API_CONTRACT.yaml to Google Studio to expand the UI – all hooks are ready.
