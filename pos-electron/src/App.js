import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { startSync } from './sync';
// @ts-ignore
const bold = window.bold;
export default function App() {
    const [cart, setCart] = useState([]);
    const [barcode, setBarcode] = useState('');
    const [customerPhone, setCustomerPhone] = useState('');
    const [branchId] = useState(localStorage.getItem('branch_id') || '');
    const barcodeRef = useRef(null);
    useEffect(() => { barcodeRef.current?.focus(); if (branchId)
        startSync(branchId); }, [branchId]);
    const addByBarcode = async (code) => {
        if (!code)
            return;
        const results = await bold.search(code);
        const p = results[0];
        if (!p) {
            alert('الصنف غير موجود');
            return;
        }
        const stock = await bold.stock(p.id);
        setCart(c => {
            const found = c.find(i => i.variant_id === p.id);
            if (found)
                return c.map(i => i.variant_id === p.id ? { ...i, qty: i.qty + 1 } : i);
            return [...c, { variant_id: p.id, sku: p.sku, name: p.name_en, qty: 1, unit_price: 199, unit_cost: Number(p.cost_price || 0) }];
        });
        setBarcode('');
        setTimeout(() => barcodeRef.current?.focus(), 0);
    };
    const subtotal = cart.reduce((s, i) => s + i.unit_price * i.qty, 0);
    const tax = Math.round(subtotal * 0.14);
    const total = subtotal + tax;
    const doSale = async (payment_method) => {
        if (!cart.length)
            return;
        const sync_id = crypto.randomUUID();
        const payload = {
            sync_id,
            branch_id: branchId || '00000000-0000-0000-0000-000000000000',
            customer_phone: customerPhone || undefined,
            items: cart.map(i => ({ variant_id: i.variant_id, qty: i.qty, unit_price: i.unit_price, unit_cost: i.unit_cost })),
            payment_method,
            language: 'ar',
            total
        };
        const res = await bold.sale(payload);
        await bold.print({ invoice_number: 'POS-' + Date.now(), total, items: cart }, 'ar');
        alert('تم البيع ✓  Sync: ' + res.sync_id);
        setCart([]);
        barcodeRef.current?.focus();
    };
    return (_jsxs("div", { className: "pos", children: [_jsxs("div", { className: "left", children: [_jsxs("div", { style: { display: 'flex', gap: 12, alignItems: 'center' }, children: [_jsx("h2", { style: { margin: 0 }, children: "Bold POS \u2013 \u0646\u0642\u0637\u0629 \u0628\u064A\u0639" }), _jsxs("span", { className: "badge", children: ["\u0641\u0631\u0639: ", branchId || 'غير محدد'] }), _jsx("span", { className: "small", style: { marginRight: 'auto' }, children: "Offline-First" })] }), _jsx("input", { ref: barcodeRef, className: "barcode-input", placeholder: "\u0627\u0645\u0633\u062D \u0627\u0644\u0628\u0627\u0631\u0643\u0648\u062F \u0647\u0646\u0627\u2026", value: barcode, onChange: e => setBarcode(e.target.value), onKeyDown: e => { if (e.key === 'Enter') {
                            addByBarcode(barcode.trim());
                        } }, autoFocus: true }), _jsx("div", { className: "cart-table", children: _jsxs("table", { children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0627\u0644\u0635\u0646\u0641" }), _jsx("th", { children: "SKU" }), _jsx("th", { children: "\u0627\u0644\u0643\u0645\u064A\u0629" }), _jsx("th", { children: "\u0627\u0644\u0633\u0639\u0631" }), _jsx("th", { children: "\u0627\u0644\u0625\u062C\u0645\u0627\u0644\u064A" }), _jsx("th", {})] }) }), _jsxs("tbody", { children: [cart.map((it, idx) => (_jsxs("tr", { children: [_jsx("td", { children: it.name }), _jsx("td", { children: it.sku }), _jsx("td", { children: it.qty }), _jsxs("td", { children: [it.unit_price, " \u062C"] }), _jsxs("td", { children: [it.unit_price * it.qty, " \u062C"] }), _jsx("td", { children: _jsx("button", { onClick: () => setCart(cart.filter((_, i) => i !== idx)), children: "\u2715" }) })] }, idx))), !cart.length && _jsx("tr", { children: _jsx("td", { colSpan: 6, style: { textAlign: 'center', color: '#888', padding: 24 }, children: "\u0627\u0645\u0633\u062D \u0628\u0627\u0631\u0643\u0648\u062F \u0644\u0625\u0636\u0627\u0641\u0629 \u0635\u0646\u0641" }) })] })] }) }), _jsx("div", { className: "small", children: "\u062A\u0644\u0645\u064A\u062D: \u0627\u0644\u0645\u0627\u0633\u062D USB \u064A\u0639\u0645\u0644 \u0643\u0643\u064A\u0628\u0648\u0631\u062F \u2013 \u0627\u0644\u0645\u0624\u0634\u0631 \u062F\u0627\u0626\u0645\u0627 \u0641\u064A \u062E\u0627\u0646\u0629 \u0627\u0644\u0628\u0627\u0631\u0643\u0648\u062F. Enter \u064A\u0636\u064A\u0641 \u062A\u0644\u0642\u0627\u0626\u064A\u0627." })] }), _jsxs("div", { className: "right", children: [_jsxs("div", { children: [_jsx("label", { children: "\u0647\u0627\u062A\u0641 \u0627\u0644\u0639\u0645\u064A\u0644 (\u0627\u062E\u062A\u064A\u0627\u0631\u064A)" }), _jsx("input", { value: customerPhone, onChange: e => setCustomerPhone(e.target.value), placeholder: "01xxxxxxxxx", style: { width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ccc' } }), _jsx("div", { className: "small", children: "\u064A\u0633\u062A\u062E\u062F\u0645 \u0644\u0644\u0648\u0644\u0627\u0621 / \u0648\u0627\u062A\u0633\u0627\u0628 \u0627\u0644\u0639\u0631\u0648\u0636" })] }), _jsxs("div", { className: "totals", children: [_jsxs("div", { children: [_jsx("span", { children: "\u0627\u0644\u0645\u062C\u0645\u0648\u0639 \u0627\u0644\u0641\u0631\u0639\u064A" }), _jsxs("b", { children: [subtotal, " \u062C"] })] }), _jsxs("div", { children: [_jsx("span", { children: "\u0627\u0644\u0636\u0631\u064A\u0628\u0629 14%" }), _jsxs("b", { children: [tax, " \u062C"] })] }), _jsxs("div", { style: { fontSize: 22, borderTop: '2px solid #111', paddingTop: 8 }, children: [_jsx("span", { children: "\u0627\u0644\u0625\u062C\u0645\u0627\u0644\u064A" }), _jsxs("b", { children: [total, " \u062C"] })] })] }), _jsxs("div", { className: "pay-grid", children: [_jsx("button", { className: "pay-btn accent", onClick: () => doSale('cash'), children: "\u0646\u0642\u062F\u064A" }), _jsx("button", { className: "pay-btn", onClick: () => doSale('card'), children: "\u0641\u064A\u0632\u0627" }), _jsx("button", { className: "pay-btn", onClick: () => doSale('instapay'), children: "\u0627\u0646\u0633\u062A\u0627 \u0628\u0627\u064A" }), _jsx("button", { className: "pay-btn", onClick: () => doSale('vodafone_cash'), children: "\u0641\u0648\u062F\u0627\u0641\u0648\u0646 \u0643\u0627\u0634" }), _jsx("button", { className: "pay-btn", onClick: () => doSale('installment'), style: { gridColumn: '1 / -1' }, children: "\u062A\u0642\u0633\u064A\u0637" })] }), _jsxs("div", { style: { display: 'flex', gap: 8 }, children: [_jsx("button", { className: "pay-btn", style: { flex: 1, background: '#555' }, onClick: () => setCart([]), children: "\u062A\u0641\u0631\u064A\u063A" }), _jsx("button", { className: "pay_btn", style: { flex: 1, padding: 14, borderRadius: 10, border: '1px solid #ccc', background: '#fff' }, onClick: () => alert('إرجاع – امسح رقم الفاتورة الأصلية'), children: "\u0625\u0631\u062C\u0627\u0639 / \u0627\u0633\u062A\u0628\u062F\u0627\u0644" })] }), _jsxs("div", { className: "small", children: ["\u0637\u0628\u0627\u0639\u0629: \u0639\u0631\u0628\u064A / English \u2013 \u0627\u0644\u062F\u0631\u062C: ", localStorage.getItem('cash_drawer') || 'معطل', _jsx("br", {}), "\u0627\u0644\u0633\u0639\u0631 \u064A\u0634\u0645\u0644 \u0627\u0644\u0636\u0631\u064A\u0628\u0629. \u0627\u0644\u0645\u0646\u062A\u062C\u0627\u062A \u0628\u0627\u0644\u0625\u0646\u062C\u0644\u064A\u0632\u064A\u0629 \u0643\u0645\u0627 \u0637\u0644\u0628\u062A."] })] })] }));
}
