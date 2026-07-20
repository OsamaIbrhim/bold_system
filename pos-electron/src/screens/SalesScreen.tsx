import React, { useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../api'
import { bold, LocalSale } from '../electron'
import { DeviceCredential, Invoice, InvoiceItem, Session, Shift, SyncState } from '../types'
import { FieldError, Modal } from '../components/ui'
import { money, paymentLabel } from '../utils'

export function SalesScreen({
  session,
  device,
  shift,
  syncState,
  onRegister,
  onSync,
  onCloseShift,
  notify
}: {
  session: Session,
  device: DeviceCredential,
  shift: Shift,
  syncState: SyncState,
  onRegister: () => void,
  onSync: () => void,
  onCloseShift: () => void,
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void
}) {
  const [query, setQuery] = useState('')
  const [method, setMethod] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [serverSales, setServerSales] = useState<Invoice[]>([])
  const [localSales, setLocalSales] = useState<LocalSale[]>([])
  const [selected, setSelected] = useState<Invoice | null>(null)
  const [returnInvoice, setReturnInvoice] = useState<any>(null)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const [server, local] = await Promise.all([
        api.listSales({ branch_id: device.branch_id, q: query, payment_method: method, page: 1, page_size: 50 }),
        bold.local_sales().catch(() => []),
      ])
      setServerSales(server.items || [])
      setLocalSales(local)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const openInvoice = async (invoice: Invoice) => {
    try {
      setSelected(await api.getSale(invoice.id))
    } catch (err) {
      notify((err as Error).message, 'error')
    }
  }

  const beginReturn = async (invoice: Invoice) => {
    try {
      setReturnInvoice(await api.invoiceLookup(invoice.invoice_number))
    } catch (err) {
      notify((err as Error).message, 'error')
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-brand">
          <div className="brand-mark small">B</div>
          <div>
            <b>Bold POS</b>
            <span>{device.terminal_code}</span>
          </div>
        </div>
        <nav className="main-nav">
          <button onClick={onRegister}>نقطة البيع</button>
          <button className="active">الفواتير والمرتجعات</button>
        </nav>
        <div className="header-status">
          <button
            className={`sync-pill ${syncState.sync_status}`}
            onClick={onSync}
          >
            <span />
            <b>
              {syncState.sync_status === 'success'
                ? 'متصل'
                : syncState.sync_status === 'syncing'
                  ? 'مزامنة…'
                  : 'تنبيه'}
            </b>
            <small>{syncState.pending_count} معلّق</small>
          </button>
          <div className="cashier-chip">
            <b>{session.user.name}</b>
            <span>
              وردية منذ{' '}
              {new Date(shift.opened_at).toLocaleTimeString('ar-EG', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
          <button className="button secondary compact" onClick={onCloseShift}>
            إغلاق الوردية
          </button>
        </div>
      </header>
      <main className="sales-page">
        <section className="page-heading">
          <div>
            <span className="eyebrow">عمليات الفرع</span>
            <h1>الفواتير والمرتجعات</h1>
          </div>
          <button className="button secondary" onClick={load}>
            تحديث
          </button>
        </section>
        <div className="sales-filters">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') load()
            }}
            placeholder="رقم الفاتورة أو هاتف العميل"
          />
          <select value={method} onChange={(event) => setMethod(event.target.value)}>
            <option value="">كل طرق الدفع</option>
            <option value="cash">نقدي</option>
            <option value="card">بطاقة</option>
            <option value="instapay">InstaPay</option>
            <option value="vodafone_cash">فودافون كاش</option>
            <option value="installment">تقسيط</option>
          </select>
          <button className="button primary" onClick={load}>
            بحث
          </button>
        </div>
        <FieldError>{error}</FieldError>
        {!!localSales.filter((sale) => sale.sync_status !== 'sent').length && (
          <section className="pending-banner">
            <div>
              <b>عمليات محفوظة محليًا</b>
              <span>هذه العمليات لم تصل إلى الخادم بعد، فلا تعِد إدخالها.</span>
            </div>
            <strong>{localSales.filter((sale) => sale.sync_status !== 'sent').length}</strong>
            <button className="button secondary" onClick={onSync}>
              مزامنة الآن
            </button>
          </section>
        )}
        <section className="data-card">
          <table className="sales-table">
            <thead>
              <tr>
                <th>رقم الفاتورة</th>
                <th>الوقت</th>
                <th>العميل</th>
                <th>طريقة الدفع</th>
                <th>الإجمالي</th>
                <th>الجهاز</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {serverSales.map((invoice) => (
                <tr key={invoice.id}>
                  <td>
                    <b>{invoice.invoice_number}</b>
                    <small>{invoice.status}</small>
                  </td>
                  <td>{new Date(invoice.created_at).toLocaleString('ar-EG')}</td>
                  <td>{invoice.customer?.name || invoice.customer?.phone || 'بدون عميل'}</td>
                  <td>{paymentLabel(invoice.payment_method)}</td>
                  <td>
                    <b>{money(invoice.total)} ج</b>
                  </td>
                  <td>{invoice.terminal?.terminal_code || '—'}</td>
                  <td>
                    <div className="row-actions">
                      <button onClick={() => openInvoice(invoice)}>تفاصيل</button>
                      <button onClick={() => beginReturn(invoice)}>مرتجع</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && !serverSales.length && (
                <tr>
                  <td colSpan={7}>
                    <div className="empty-state">
                      <b>لا توجد فواتير مطابقة</b>
                      <span>جرّب تغيير البحث أو طريقة الدفع.</span>
                    </div>
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan={7}>
                    <div className="table-loading">جارٍ تحميل الفواتير…</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </main>
      <InvoiceModal
        invoice={selected}
        onClose={() => setSelected(null)}
        onReturn={(invoice) => {
          setSelected(null)
          beginReturn(invoice)
        }}
        notify={notify}
      />
      <ReturnModal
        invoice={returnInvoice}
        onClose={() => setReturnInvoice(null)}
        onCompleted={async () => {
          setReturnInvoice(null)
          await load()
        }}
        notify={notify}
      />
    </div>
  )
}

function itemName(item: InvoiceItem) {
  return (
    item.variant?.product?.name_ar ||
    item.variant?.product?.name_en ||
    item.variant?.sku ||
    item.variant_id
  )
}

function InvoiceModal({
  invoice,
  onClose,
  onReturn,
  notify
}: {
  invoice: Invoice | null,
  onClose: () => void,
  onReturn: (invoice: Invoice) => void,
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void
}) {
  const reprint = async () => {
    if (!invoice) return
    const items = (invoice.items || []).map((item) => ({
      name: itemName(item),
      sku: item.variant?.sku,
      qty: item.qty,
      unit_price: Number(item.unit_price),
    }))
    const result = await bold.print(
      {
        invoice_number: invoice.invoice_number,
        total: Number(invoice.total),
        items,
      },
      'ar',
    )
    notify(
      result.ok
        ? 'تم إرسال الإيصال للطابعة'
        : result.reason || 'تعذرت الطباعة',
      result.ok ? 'success' : 'error',
    )
  }

  function returnedQty(item: InvoiceItem) {
    return (item.return_items || []).reduce(
      (sum, record) =>
        sum + Number(record.qty || 0),
      0,
    )
  }

  return (
    <Modal
      open={!!invoice}
      title={invoice ? `فاتورة ${invoice.invoice_number}` : 'الفاتورة'}
      onClose={onClose}
      width="820px"
    >
      {invoice && (
        <div className="invoice-details">
          <div className="invoice-summary">
            <div>
              <span>التاريخ</span>
              <b>{new Date(invoice.created_at).toLocaleString('ar-EG')}</b>
            </div>
            <div>
              <span>طريقة الدفع</span>
              <b>{paymentLabel(invoice.payment_method)}</b>
            </div>
            <div>
              <span>العميل</span>
              <b>{invoice.customer?.name || invoice.customer?.phone || 'بدون عميل'}</b>
            </div>
            <div>
              <span>الإجمالي</span>
              <b>{money(invoice.total)} ج</b>
            </div>
          </div>
          <table className="line-table">
            <thead>
              <tr>
                <th>الصنف</th>
                <th>الكمية الأصلية</th>
                <th>تم إرجاعه</th>
                <th>المتبقي</th>
                <th>السعر</th>
                <th>الإجمالي الأصلي</th>
              </tr>
            </thead>

            <tbody>
              {(invoice.items || []).map(item => {
                const returned = returnedQty(item)
                const remaining = Math.max(
                  0,
                  item.qty - returned,
                )

                return (
                  <tr key={item.id}>
                    <td>{itemName(item)}</td>
                    <td>{item.qty}</td>
                    <td>{returned}</td>
                    <td>
                      <b>{remaining}</b>
                    </td>
                    <td>{money(item.unit_price)}</td>
                    <td>
                      {money(
                        Number(item.unit_price) *
                        item.qty,
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <section className="invoice-returns">
            <div className="section-heading">
              <h3>سجل المرتجعات</h3>

              <span>
                {invoice.original_returns?.length || 0}
                {' '}عملية
              </span>
            </div>

            {!invoice.original_returns?.length ? (
              <div className="empty-state compact">
                <b>لم يتم إجراء مرتجع لهذه الفاتورة</b>
              </div>
            ) : (
              <table className="line-table">
                <thead>
                  <tr>
                    <th>رقم المرتجع</th>
                    <th>التاريخ</th>
                    <th>النوع</th>
                    <th>السبب</th>
                    <th>المبلغ المسترد</th>
                  </tr>
                </thead>

                <tbody>
                  {invoice.original_returns.map(record => (
                    <tr key={record.id}>
                      <td>
                        <b>
                          {record.return_invoice_number}
                        </b>
                      </td>

                      <td>
                        {new Date(
                          record.created_at,
                        ).toLocaleString('ar-EG')}
                      </td>

                      <td>
                        {record.is_partial
                          ? 'مرتجع جزئي'
                          : 'مرتجع كامل'}
                      </td>

                      <td>
                        {record.reason || '—'}
                      </td>

                      <td>
                        <b>
                          {money(record.refund_total)} ج
                        </b>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <div className="dialog-actions">
            <button className="button secondary" onClick={reprint}>
              إعادة الطباعة
            </button>
            <button className="button danger" onClick={() => onReturn(invoice)}>
              إنشاء مرتجع
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function ReturnModal({
  invoice,
  onClose,
  onCompleted,
  notify
}: {
  invoice: any,
  onClose: () => void,
  onCompleted: () => void | Promise<void>,
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void
}) {
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (invoice) {
      setQuantities({})
      setReason('')
      setError('')
      setBusy(false)
    }
  }, [invoice])

  const items: any[] = invoice?.items || []
  const selected = items.filter((item) => Number(quantities[item.id] || 0) > 0)
  const refund = useMemo(
    () =>
      selected.reduce(
        (sum, item) =>
          sum +
          (Number(item.unit_price) + Number(item.unit_tax || 0)) *
          Number(quantities[item.id]),
        0,
      ),
    [selected, quantities],
  )

  const submit = async () => {
    if (busy) return

    if (!selected.length) {
      setError('اختر صنفًا واحدًا على الأقل.')
      return
    }

    setBusy(true)
    setError('')

    try {
      const result = await api.returnSale({
        original_invoice_id: invoice.id,
        items: selected.map((item) => ({
          sales_invoice_item_id: item.id,
          qty: Number(quantities[item.id]),
        })),
        reason: reason.trim() || undefined,
      })

      notify(
        `تم تسجيل المرتجع ${result.return_invoice_number}`,
        'success',
      )

      await onCompleted()
    } catch (error) {
      const value = error as ApiError

      setError(
        `${value.message}${value.requestId
          ? ` — المرجع: ${value.requestId}`
          : ''
        }`,
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={!!invoice}
      title={invoice ? `مرتجع ${invoice.invoice_number}` : 'مرتجع'}
      onClose={() => { if (!busy) onClose() }}
      width="900px"
    >
      {invoice && (
        <div className="return-flow">
          <p className="muted">
            يعرض النظام الكمية المباعة أصلًا، وما تم إرجاعه
            في عمليات سابقة، والكمية المتبقية التي لا يزال
            مسموحًا بإرجاعها.
          </p>
          <table className="line-table">
            <thead>
              <tr>
                <th>الصنف</th>
                <th>الكمية الأصلية</th>
                <th>تم إرجاعه سابقًا</th>
                <th>المتبقي المسموح بإرجاعه</th>
                <th>كمية هذا المرتجع</th>
                <th>قيمة الاسترداد</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{itemName(item)}</td>
                  <td>{item.qty}</td>

                  <td>
                    {Number(item.returned_qty || 0)}
                  </td>

                  <td>
                    <b>{Number(item.returnable_qty || 0)}</b>

                    {Number(item.returnable_qty || 0) === 0 && (
                      <small className="return-complete-label">
                        تم إرجاع كامل الكمية
                      </small>
                    )}
                  </td>

                  <td>
                    <div className="qty-control">
                      <button
                        type="button"
                        disabled={
                          busy ||
                          Number(item.returnable_qty || 0) === 0
                        }
                        onClick={() =>
                          setQuantities(current => ({
                            ...current,
                            [item.id]: Math.max(
                              0,
                              Number(current[item.id] || 0) - 1,
                            ),
                          }))
                        }
                      >
                        −
                      </button>

                      <input
                        type="number"
                        min="0"
                        max={Number(item.returnable_qty || 0)}
                        disabled={
                          busy ||
                          Number(item.returnable_qty || 0) === 0
                        }
                        value={quantities[item.id] || 0}
                        onChange={event => {
                          const maximum = Number(
                            item.returnable_qty || 0,
                          )

                          const next = Math.min(
                            maximum,
                            Math.max(
                              0,
                              Number(event.target.value || 0),
                            ),
                          )

                          setQuantities(current => ({
                            ...current,
                            [item.id]: next,
                          }))
                        }}
                      />

                      <button
                        type="button"
                        disabled={
                          busy ||
                          Number(item.returnable_qty || 0) === 0
                        }
                        onClick={() =>
                          setQuantities(current => ({
                            ...current,
                            [item.id]: Math.min(
                              Number(item.returnable_qty || 0),
                              Number(current[item.id] || 0) + 1,
                            ),
                          }))
                        }
                      >
                        +
                      </button>
                    </div>
                  </td>
                  <td>
                    {money(
                      (Number(item.unit_price) + Number(item.unit_tax || 0)) *
                      Number(quantities[item.id] || 0),
                    )}{' '}
                    ج
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <label>سبب الإرجاع (اختياري)</label>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            placeholder="مثال: المقاس غير مناسب"
          />
          <div className="refund-total">
            <span>إجمالي الاسترداد</span>
            <b>{money(refund)} ج</b>
          </div>
          <FieldError>{error}</FieldError>
          <div className="dialog-actions">
            <button className="button secondary" disabled={busy} onClick={onClose}>
              إلغاء
            </button>
            <button
              className="button danger xl"
              disabled={busy || !selected.length}
              onClick={submit}
            >
              {busy ? 'جارٍ تسجيل المرتجع…' : 'تأكيد المرتجع'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}