const EGYPTIAN_MOBILE_PATTERN = /^(?:\+20|0)1[0125]\d{8}$/

export function normalizeUserPhone(value: string) {
  return value.replace(/\s+/g, '')
}

export function validateUserPhone(value: string) {
  const phone = normalizeUserPhone(value)
  if (!phone) return 'رقم الهاتف مطلوب لإنشاء حساب يمكنه تسجيل الدخول.'
  if (!EGYPTIAN_MOBILE_PATTERN.test(phone)) {
    return 'أدخل رقم موبايل مصري صحيح، مثل 01012345678 أو +201012345678.'
  }
  return ''
}
