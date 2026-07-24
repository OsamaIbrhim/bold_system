import type { AdminUser } from './api'

export const NAV_ITEMS = [
  { href: '/', label: 'لوحة التحكم', capability: 'dashboard.read' },
  { href: '/sales', label: 'فواتير المبيعات', capability: 'sales.read' },
  { href: '/products', label: 'المنتجات', capability: 'products.read' },
  { href: '/inventory', label: 'المخزون', capability: 'inventory.read' },
  { href: '/customers', label: 'العملاء', capability: 'customers.read' },
  { href: '/purchasing', label: 'المشتريات', capability: 'purchasing.read' },
  { href: '/suppliers', label: 'الموردون', capability: 'suppliers.manage' },
  { href: '/pricing', label: 'التسعير', capability: 'pricing.manage' },
  { href: '/offers', label: 'العروض', capability: 'offers.manage' },
  { href: '/transfers', label: 'التحويلات', capability: 'transfers.manage' },
  { href: '/shifts', label: 'الورديات', capability: 'shifts.manage' },
  { href: '/terminals', label: 'أجهزة نقاط البيع', capability: 'terminals.read' },
  { href: '/reports', label: 'التقارير', capability: 'reports.read' },
  { href: '/branches', label: 'الفروع', capability: 'branches.manage' },
  { href: '/users', label: 'المستخدمون والصلاحيات', capability: 'users.manage' },
  { href: '/settings', label: 'الإعدادات', capability: 'settings.manage' },
] as const

export type Capability = typeof NAV_ITEMS[number]['capability']
  | 'products.manage'
  | 'customers.manage'
  | 'purchasing.manage'
  | 'terminals.manage'
  | 'users.manage'
  | 'seller_reports.read'
  | 'seller_settings.manage'
  | 'seller_periods.close'

export function hasCapability(
  user: Pick<AdminUser, 'capabilities'> | null | undefined,
  capability: Capability,
) {
  return user?.capabilities?.includes(capability) === true
}

export function requiredCapability(pathname: string): Capability | null {
  const route = NAV_ITEMS
    .filter(({ href }) => href === '/'
      ? pathname === '/'
      : pathname === href || pathname.startsWith(`${href}/`))
    .sort((left, right) => right.href.length - left.href.length)[0]
  return route?.capability || null
}

export function canAccessPath(
  user: Pick<AdminUser, 'capabilities'> | null | undefined,
  pathname: string,
) {
  if (pathname === '/login') return true
  const capability = requiredCapability(pathname)
  return capability === null || hasCapability(user, capability)
}

export function firstAccessiblePath(
  user: Pick<AdminUser, 'capabilities'> | null | undefined,
) {
  return NAV_ITEMS.find(({ capability }) => hasCapability(user, capability))?.href || '/login'
}
