export const PAYMENT_METHODS = [
  'cash',
  'card',
  'instapay',
  'vodafone_cash',
  'installment',
] as const

export type PaymentMethod =
  typeof PAYMENT_METHODS[number]

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EGYPTIAN_PHONE =
  /^(?:\+20|0)1[0125]\d{8}$/

export class PosSaleValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'PosSaleValidationError'
  }
}

export function validateLocalSaleInput(
  sale: any,
  enrolledBranchId: string,
) {
  const syncId = String(sale?.sync_id || '')
  const branchId = String(sale?.branch_id || '')
  const paymentMethod = String(
    sale?.payment_method || '',
  ) as PaymentMethod
  const customerPhone = sale?.customer_phone
    ? String(sale.customer_phone)
        .trim()
        .replace(/\s+/g, '')
    : undefined

  if (!UUID.test(syncId)) {
    throw new PosSaleValidationError(
      'INVALID_SYNC_ID',
      'تعذر إنشاء مرجع آمن للبيع. أعد المحاولة.',
    )
  }
  if (
    !UUID.test(branchId) ||
    branchId !== enrolledBranchId
  ) {
    throw new PosSaleValidationError(
      'BRANCH_MISMATCH',
      'هذا الجهاز غير مسجل على الفرع المحدد.',
    )
  }
  if (!PAYMENT_METHODS.includes(paymentMethod)) {
    throw new PosSaleValidationError(
      'PAYMENT_METHOD_INVALID',
      'اختر طريقة دفع صحيحة.',
    )
  }
  if (
    customerPhone &&
    !EGYPTIAN_PHONE.test(customerPhone)
  ) {
    throw new PosSaleValidationError(
      'CUSTOMER_PHONE_INVALID',
      'رقم هاتف العميل غير صحيح.',
    )
  }
  if (
    !Array.isArray(sale?.items) ||
    sale.items.length < 1 ||
    sale.items.length > 100
  ) {
    throw new PosSaleValidationError(
      'SALE_ITEMS_INVALID',
      'يجب أن تحتوي الفاتورة على صنف واحد إلى 100 صنف.',
    )
  }

  const seen = new Set<string>()
  const items = sale.items.map((item: any) => {
    const normalized = {
      variant_id: String(item?.variant_id || ''),
      qty: Number(item?.qty),
      unit_price: Number(item?.unit_price),
      unit_tax: Number(item?.unit_tax),
      price_version: String(
        item?.price_version || '',
      ),
      price_token: String(item?.price_token || ''),
    }
    if (
      !UUID.test(normalized.variant_id) ||
      !Number.isInteger(normalized.qty) ||
      normalized.qty < 1 ||
      normalized.qty > 1_000 ||
      !Number.isFinite(normalized.unit_price) ||
      normalized.unit_price <= 0 ||
      !Number.isFinite(normalized.unit_tax) ||
      normalized.unit_tax < 0 ||
      !normalized.price_version ||
      !normalized.price_token
    ) {
      throw new PosSaleValidationError(
        'SALE_ITEM_INVALID',
        'توجد كمية أو هوية صنف أو لقطة سعر غير صحيحة في الفاتورة.',
      )
    }
    if (seen.has(normalized.variant_id)) {
      throw new PosSaleValidationError(
        'DUPLICATE_SALE_ITEM',
        'لا يمكن تكرار الصنف كسطرين منفصلين في الفاتورة.',
      )
    }
    seen.add(normalized.variant_id)
    return normalized
  })

  return {
    syncId,
    branchId,
    paymentMethod,
    customerPhone,
    language: sale?.language === 'en' ? 'en' as const : 'ar' as const,
    localTotal: Number(sale?.local_total),
    items,
  }
}
