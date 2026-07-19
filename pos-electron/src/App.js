import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { startSync } from './sync';
import { api } from './api';
// @ts-ignore
const bold = window.bold;
function LoginScreen({ onLogin }) {
    const [phone, setPhone] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const submit = async (event) => {
        event.preventDefault();
        setLoading(true);
        setError('');
        try {
            const session = await api.login(phone, password);
            onLogin(session.user.branch_id);
        }
        catch (err) {
            setError(err.message || 'تعذر تسجيل الدخول');
        }
        finally {
            setLoading(false);
        }
    };
    return (_jsx("div", { className: "pos", style: { display: 'grid', placeItems: 'center' }, children: _jsxs("form", { onSubmit: submit, style: { width: 380, background: '#fff', borderRadius: 16, padding: 28, boxShadow: '0 12px 40px #0002' }, children: [_jsx("h1", { style: { marginTop: 0 }, children: "Bold POS" }), _jsx("p", { className: "small", children: "\u0633\u062C\u0644 \u0627\u0644\u062F\u062E\u0648\u0644 \u0628\u062D\u0633\u0627\u0628 \u0627\u0644\u0643\u0627\u0634\u064A\u0631 \u0627\u0644\u0645\u0631\u062A\u0628\u0637 \u0628\u0647\u0630\u0627 \u0627\u0644\u0641\u0631\u0639." }), _jsx("label", { children: "\u0631\u0642\u0645 \u0627\u0644\u0647\u0627\u062A\u0641" }), _jsx("input", { className: "barcode-input", style: { fontSize: 18, margin: '6px 0 14px' }, value: phone, onChange: e => setPhone(e.target.value), placeholder: "+201xxxxxxxxx", autoFocus: true }), _jsx("label", { children: "\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631" }), _jsx("input", { className: "barcode-input", style: { fontSize: 18, margin: '6px 0 14px' }, type: "password", value: password, onChange: e => setPassword(e.target.value) }), error && _jsx("div", { style: { color: '#b91c1c', marginBottom: 12 }, children: error }), _jsx("button", { className: "pay-btn accent", style: { width: '100%' }, disabled: loading, children: loading ? 'جارٍ الدخول…' : 'دخول' })] }) }));
}
export default function App() {
    const [cart, setCart] = useState([]);
    const [barcode, setBarcode] = useState('');
    const [customerPhone, setCustomerPhone] = useState('');
    const [customerInfo, setCustomerInfo] = useState(null);
    const [loyalty, setLoyalty] = useState(null);
    const [authenticated, setAuthenticated] = useState(api.hasSession());
    const [branchId, setBranchId] = useState(authenticated ? localStorage.getItem('branch_id') || '' : '');
    const barcodeRef = useRef(null);
    useEffect(() => {
        const expired = () => { setAuthenticated(false); setBranchId(''); };
        window.addEventListener('bold-auth-expired', expired);
        return () => window.removeEventListener('bold-auth-expired', expired);
    }, []);
    useEffect(() => {
        if (!authenticated || !branchId)
            return;
        barcodeRef.current?.focus();
        return startSync(branchId);
    }, [authenticated, branchId]);
    // Customer loyalty lookup – debounced
    useEffect(() => {
        if (!authenticated || !customerPhone || customerPhone.length < 11) {
            setCustomerInfo(null);
            setLoyalty(null);
            return;
        }
        const t = setTimeout(async () => {
            const c = await api.customerLookup(customerPhone).catch(() => null);
            setCustomerInfo(c);
            const l = await api.customerLoyalty(customerPhone).catch(() => ({ eligible: false }));
            setLoyalty(l);
        }, 400);
        return () => clearTimeout(t);
    }, [authenticated, customerPhone]);
    const addByBarcode = async (code) => {
        if (!code)
            return;
        const results = await bold.search(code);
        const p = results[0];
        if (!p) {
            alert('الصنف غير موجود');
            return;
        }
        // Pricing Engine – try live API first, then the version synced locally.
        let unit_price = 0;
        let unit_tax = 0;
        const priceResp = await api.pricing(p.id).catch(() => null);
        if (priceResp?.net_price) {
            unit_price = Number(priceResp.net_price);
            unit_tax = Number(priceResp.tax_amount || 0);
        }
        else {
            unit_price = Number(p.selling_price || 0);
            unit_tax = Number(p.unit_tax || 0);
        }
        if (unit_price <= 0) {
            alert('لا يوجد سعر معتمد للصنف. اتصل بالإنترنت وحدّث البيانات قبل البيع.');
            return;
        }
        setCart(c => {
            const found = c.find(i => i.variant_id === p.id);
            if (found)
                return c.map(i => i.variant_id === p.id ? { ...i, qty: i.qty + 1 } : i);
            return [...c, { variant_id: p.id, sku: p.sku, name: p.name_en, qty: 1, unit_price, unit_tax }];
        });
        setBarcode('');
        setTimeout(() => barcodeRef.current?.focus(), 0);
    };
    const subtotal = cart.reduce((s, i) => s + i.unit_price * i.qty, 0);
    const tax = Math.round(cart.reduce((sum, item) => sum + item.unit_tax * item.qty, 0) * 100) / 100;
    const total = Math.round((subtotal + tax) * 100) / 100;
    const doSale = async (payment_method) => {
        if (!cart.length)
            return;
        if (!branchId) {
            alert('لا يوجد فرع مرتبط بالمستخدم');
            return;
        }
        const sync_id = crypto.randomUUID();
        const payload = {
            sync_id,
            branch_id: branchId,
            customer_phone: customerPhone || undefined,
            items: cart.map(i => ({ variant_id: i.variant_id, qty: i.qty })),
            payment_method,
            language: 'ar',
            // Used only by the local Electron database and stripped before sync.
            local_total: total
        };
        try {
            const res = await bold.sale(payload);
            await bold.print({ invoice_number: 'POS-' + Date.now(), total, items: cart }, 'ar');
            alert('تم البيع ✓  Sync: ' + res.sync_id);
            setCart([]);
            barcodeRef.current?.focus();
        }
        catch (error) {
            alert('تعذر إتمام البيع: ' + (error.message || 'المخزون المحلي غير كافٍ'));
        }
    };
    const doReturn = async () => {
        const reference = prompt('أدخل رقم الفاتورة الأصلية أو UUID:');
        if (!reference)
            return;
        try {
            const invoice = await api.invoiceLookup(reference.trim());
            const items = [];
            for (const item of invoice.items || []) {
                if (item.returnable_qty <= 0)
                    continue;
                const name = item.variant?.product?.name_ar || item.variant?.product?.name_en || item.variant?.sku;
                const answer = prompt(`${name}\nالمتاح للإرجاع: ${item.returnable_qty}\nالكمية المطلوبة:`, '0');
                const qty = Number(answer || 0);
                if (!Number.isInteger(qty) || qty < 0 || qty > item.returnable_qty) {
                    throw new Error(`كمية غير صحيحة للصنف ${name}`);
                }
                if (qty > 0)
                    items.push({ sales_invoice_item_id: item.id, qty });
            }
            if (!items.length) {
                alert('لم يتم اختيار أي كمية للإرجاع');
                return;
            }
            const reason = prompt('سبب الإرجاع (اختياري):') || undefined;
            const result = await api.returnSale({ original_invoice_id: invoice.id, items, reason });
            alert(`تم تسجيل المرتجع ✓\nرقم المرتجع: ${result.return_invoice_number}\nقيمة الاسترداد: ${Number(result.refund_total)} ج`);
            await api.pull(branchId).then(data => bold.sync_apply_pull(data)).catch(() => undefined);
        }
        catch (error) {
            alert('تعذر تنفيذ المرتجع: ' + (error.message || 'يجب الاتصال بالخادم'));
        }
    };
    if (!authenticated || !branchId) {
        return _jsx(LoginScreen, { onLogin: (id) => { setBranchId(id); setAuthenticated(true); } });
    }
    return (_jsxs("div", { className: "pos", children: [_jsxs("div", { className: "left", children: [_jsxs("div", { style: { display: 'flex', gap: 12, alignItems: 'center' }, children: [_jsx("h2", { style: { margin: 0 }, children: "Bold POS \u2013 \u0646\u0642\u0637\u0629 \u0628\u064A\u0639" }), _jsxs("span", { className: "badge", children: ["\u0641\u0631\u0639: ", branchId || 'غير محدد'] }), _jsx("span", { className: "small", style: { marginRight: 'auto' }, children: "Offline-First" }), _jsx("button", { onClick: async () => { await api.logout(); setAuthenticated(false); setBranchId(''); }, children: "\u062E\u0631\u0648\u062C" })] }), _jsx("input", { ref: barcodeRef, className: "barcode-input", placeholder: "\u0627\u0645\u0633\u062D \u0627\u0644\u0628\u0627\u0631\u0643\u0648\u062F \u0647\u0646\u0627\u2026", value: barcode, onChange: e => setBarcode(e.target.value), onKeyDown: e => { if (e.key === 'Enter') {
                            addByBarcode(barcode.trim());
                        } }, autoFocus: true }), _jsx("div", { className: "cart-table", children: _jsxs("table", { children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0627\u0644\u0635\u0646\u0641" }), _jsx("th", { children: "SKU" }), _jsx("th", { children: "\u0627\u0644\u0643\u0645\u064A\u0629" }), _jsx("th", { children: "\u0627\u0644\u0633\u0639\u0631" }), _jsx("th", { children: "\u0627\u0644\u0625\u062C\u0645\u0627\u0644\u064A" }), _jsx("th", {})] }) }), _jsxs("tbody", { children: [cart.map((it, idx) => (_jsxs("tr", { children: [_jsx("td", { children: it.name }), _jsx("td", { children: it.sku }), _jsx("td", { children: it.qty }), _jsxs("td", { children: [it.unit_price, " \u062C"] }), _jsxs("td", { children: [it.unit_price * it.qty, " \u062C"] }), _jsx("td", { children: _jsx("button", { onClick: () => setCart(cart.filter((_, i) => i !== idx)), children: "\u2715" }) })] }, idx))), !cart.length && _jsx("tr", { children: _jsx("td", { colSpan: 6, style: { textAlign: 'center', color: '#888', padding: 24 }, children: "\u0627\u0645\u0633\u062D \u0628\u0627\u0631\u0643\u0648\u062F \u0644\u0625\u0636\u0627\u0641\u0629 \u0635\u0646\u0641" }) })] })] }) }), _jsx("div", { className: "small", children: "\u062A\u0644\u0645\u064A\u062D: \u0627\u0644\u0645\u0627\u0633\u062D USB \u064A\u0639\u0645\u0644 \u0643\u0643\u064A\u0628\u0648\u0631\u062F \u2013 \u0627\u0644\u0645\u0624\u0634\u0631 \u062F\u0627\u0626\u0645\u0627 \u0641\u064A \u062E\u0627\u0646\u0629 \u0627\u0644\u0628\u0627\u0631\u0643\u0648\u062F. Enter \u064A\u0636\u064A\u0641 \u062A\u0644\u0642\u0627\u0626\u064A\u0627." })] }), _jsxs("div", { className: "right", children: [_jsxs("div", { children: [_jsx("label", { children: "\u0647\u0627\u062A\u0641 \u0627\u0644\u0639\u0645\u064A\u0644 (\u0627\u062E\u062A\u064A\u0627\u0631\u064A)" }), _jsx("input", { value: customerPhone, onChange: e => setCustomerPhone(e.target.value), placeholder: "01xxxxxxxxx", style: { width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ccc' } }), !customerPhone && _jsx("div", { className: "small", children: "\u064A\u0633\u062A\u062E\u062F\u0645 \u0644\u0644\u0648\u0644\u0627\u0621 / \u0648\u0627\u062A\u0633\u0627\u0628 \u0627\u0644\u0639\u0631\u0648\u0636" }), customerPhone && customerInfo && (_jsxs("div", { className: "small", style: { marginTop: 4, padding: '6px 8px', background: '#f3f4f6', borderRadius: 6 }, children: [customerInfo.name || 'عميل', " \u2013 \u0641\u0648\u0627\u062A\u064A\u0631: ", customerInfo.total_invoices || 0, " \u2013 \u0625\u062C\u0645\u0627\u0644\u064A: ", Number(customerInfo.total_spent || 0), " \u062C", customerInfo.is_vip && _jsx("span", { style: { color: '#f59e0b', fontWeight: 'bold' }, children: " \u2013 VIP \u2B50" })] })), loyalty?.eligible && (_jsx("div", { className: "small", style: { marginTop: 4, padding: '6px 8px', background: '#ecfdf5', color: '#065f46', borderRadius: 6, fontWeight: 'bold' }, children: "\u2713 \u0639\u0645\u064A\u0644 \u0645\u0645\u064A\u0632 \u2013 \u064A\u062D\u0642 \u0644\u0647 \u062E\u0635\u0645 \u0648\u0644\u0627\u0621" })), customerPhone && customerPhone.length >= 11 && !customerInfo && (_jsx("div", { className: "small", style: { color: '#888' }, children: "\u0639\u0645\u064A\u0644 \u062C\u062F\u064A\u062F \u2013 \u0633\u064A\u062A\u0645 \u0625\u0646\u0634\u0627\u0624\u0647 \u0645\u0639 \u0623\u0648\u0644 \u0641\u0627\u062A\u0648\u0631\u0629" }))] }), _jsxs("div", { className: "totals", children: [_jsxs("div", { children: [_jsx("span", { children: "\u0627\u0644\u0645\u062C\u0645\u0648\u0639 \u0627\u0644\u0641\u0631\u0639\u064A (\u063A\u064A\u0631 \u0634\u0627\u0645\u0644 \u0627\u0644\u0636\u0631\u064A\u0628\u0629)" }), _jsxs("b", { children: [subtotal, " \u062C"] })] }), _jsxs("div", { children: [_jsx("span", { children: "\u0636\u0631\u064A\u0628\u0629 \u0627\u0644\u0642\u064A\u0645\u0629 \u0627\u0644\u0645\u0636\u0627\u0641\u0629" }), _jsxs("b", { children: [tax, " \u062C"] })] }), _jsxs("div", { style: { fontSize: 22, borderTop: '2px solid #111', paddingTop: 8 }, children: [_jsx("span", { children: "\u0627\u0644\u0625\u062C\u0645\u0627\u0644\u064A \u0634\u0627\u0645\u0644 \u0627\u0644\u0636\u0631\u064A\u0628\u0629" }), _jsxs("b", { children: [total, " \u062C"] })] })] }), _jsxs("div", { className: "pay-grid", children: [_jsx("button", { className: "pay-btn accent", onClick: () => doSale('cash'), children: "\u0646\u0642\u062F\u064A" }), _jsx("button", { className: "pay-btn", onClick: () => doSale('card'), children: "\u0641\u064A\u0632\u0627" }), _jsx("button", { className: "pay-btn", onClick: () => doSale('instapay'), children: "\u0627\u0646\u0633\u062A\u0627 \u0628\u0627\u064A" }), _jsx("button", { className: "pay-btn", onClick: () => doSale('vodafone_cash'), children: "\u0641\u0648\u062F\u0627\u0641\u0648\u0646 \u0643\u0627\u0634" }), _jsx("button", { className: "pay-btn", onClick: () => doSale('installment'), style: { gridColumn: '1 / -1' }, children: "\u062A\u0642\u0633\u064A\u0637" })] }), _jsxs("div", { style: { display: 'flex', gap: 8 }, children: [_jsx("button", { className: "pay-btn", style: { flex: 1, background: '#555' }, onClick: () => setCart([]), children: "\u062A\u0641\u0631\u064A\u063A" }), _jsx("button", { style: { flex: 1, padding: 14, borderRadius: 10, border: '1px solid #ccc', background: '#fff', cursor: 'pointer' }, onClick: doReturn, children: "\u0625\u0631\u062C\u0627\u0639" })] }), _jsxs("div", { className: "small", style: { lineHeight: 1.5 }, children: ["\uD83D\uDDA8\uFE0F \u0637\u0628\u0627\u0639\u0629: \u0639\u0631\u0628\u064A / English \u2013 80mm thermal", _jsx("br", {}), "\uD83D\uDCB5 \u0627\u0644\u062F\u0631\u062C: ", localStorage.getItem('cash_drawer') || 'معطل', " \u2013 \u064A\u0641\u062A\u062D \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B \u0645\u0639 \u0627\u0644\u0637\u0628\u0627\u0639\u0629", _jsx("br", {}), "\uD83D\uDCE6 \u0627\u0644\u0623\u0633\u0639\u0627\u0631 \u063A\u064A\u0631 \u0634\u0627\u0645\u0644\u0629 \u0627\u0644\u0636\u0631\u064A\u0628\u0629 \u2013 \u062A\u064F\u0636\u0627\u0641 \u0627\u0644\u0636\u0631\u064A\u0628\u0629 \u0627\u0644\u0645\u0639\u062A\u0645\u062F\u0629 \u0639\u0646\u062F \u0627\u0644\u062F\u0641\u0639", _jsx("br", {}), "\uD83C\uDFF7\uFE0F \u0623\u0633\u0645\u0627\u0621 \u0627\u0644\u0645\u0646\u062A\u062C\u0627\u062A \u0628\u0627\u0644\u0625\u0646\u062C\u0644\u064A\u0632\u064A\u0629", loyalty?.eligible && _jsx("div", { style: { color: '#065f46', fontWeight: 'bold' }, children: "\u2713 \u062E\u0635\u0645 \u0648\u0644\u0627\u0621 \u0645\u062A\u0627\u062D \u0644\u0647\u0630\u0627 \u0627\u0644\u0639\u0645\u064A\u0644" })] })] })] }));
}
