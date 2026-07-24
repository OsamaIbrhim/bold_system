import { Role } from '@prisma/client';

export const CAPABILITIES = [
  'dashboard.read',
  'products.read',
  'products.manage',
  'inventory.read',
  'sales.read',
  'sales.create',
  'returns.create',
  'customers.read',
  'customers.manage',
  'purchasing.read',
  'purchasing.manage',
  'suppliers.manage',
  'pricing.manage',
  'offers.manage',
  'transfers.manage',
  'reports.read',
  'reports.send',
  'branches.manage',
  'users.manage',
  'shifts.manage',
  'terminals.read',
  'terminals.manage',
  'settings.manage',
  'seller_reports.read',
  'seller_settings.manage',
  'seller_periods.close',
] as const;

export type Capability = typeof CAPABILITIES[number];

const roleCapabilities: Record<Role, Capability[]> = {
  owner: [...CAPABILITIES],
  branch_manager: [
    'dashboard.read', 'products.read', 'products.manage', 'inventory.read',
    'sales.read', 'sales.create', 'returns.create', 'customers.read',
    'customers.manage', 'purchasing.read', 'purchasing.manage',
    'suppliers.manage', 'pricing.manage', 'offers.manage', 'transfers.manage',
    'reports.read', 'reports.send', 'shifts.manage', 'terminals.read',
    'terminals.manage', 'users.manage', 'seller_reports.read',
  ],
  cashier: [
    'products.read', 'inventory.read', 'sales.create', 'returns.create',
    'customers.read', 'shifts.manage',
  ],
  warehouse_manager: [
    'dashboard.read', 'products.read', 'products.manage', 'inventory.read',
    'purchasing.read', 'purchasing.manage', 'suppliers.manage',
    'transfers.manage', 'reports.read',
  ],
  seller: [
    'products.read', 'inventory.read', 'customers.read',
  ],
};

export function capabilitiesFor(role: Role): Capability[] {
  return roleCapabilities[role] || [];
}

export type PermissionSource = {
  role: Role;
  granted_capabilities?: string[] | null;
  revoked_capabilities?: string[] | null;
};

export function effectiveCapabilities(user: PermissionSource): Capability[] {
  if (user.role === 'owner') return [...CAPABILITIES];
  const valid = new Set<string>(CAPABILITIES);
  const result = new Set<Capability>(capabilitiesFor(user.role));
  for (const capability of user.granted_capabilities || []) {
    if (valid.has(capability)) result.add(capability as Capability);
  }
  for (const capability of user.revoked_capabilities || []) {
    result.delete(capability as Capability);
  }
  return [...result];
}
