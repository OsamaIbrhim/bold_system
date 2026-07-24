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
  'branches.manage',
  'users.manage',
  'shifts.manage',
  'terminals.read',
  'terminals.manage',
  'settings.manage',
] as const;

export type Capability = typeof CAPABILITIES[number];

const roleCapabilities: Record<Role, Capability[]> = {
  owner: [...CAPABILITIES],
  branch_manager: [
    'dashboard.read', 'products.read', 'products.manage', 'inventory.read',
    'sales.read', 'sales.create', 'returns.create', 'customers.read',
    'customers.manage', 'purchasing.read', 'purchasing.manage',
    'suppliers.manage', 'pricing.manage', 'offers.manage', 'transfers.manage',
    'reports.read', 'shifts.manage', 'terminals.read',
    'terminals.manage',
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
};

export function capabilitiesFor(role: Role): Capability[] {
  return roleCapabilities[role] || [];
}
