import { capabilitiesFor, effectiveCapabilities } from './permissions';

describe('role capabilities', () => {
  it('keeps read-only product access separate from product management', () => {
    expect(capabilitiesFor('cashier')).toContain('products.read');
    expect(capabilitiesFor('cashier')).not.toContain('products.manage');
  });

  it('advertises the terminal actions already authorized for branch managers', () => {
    expect(capabilitiesFor('branch_manager')).toEqual(expect.arrayContaining([
      'terminals.read',
      'terminals.manage',
    ]));
  });

  it('advertises dashboard and report reads authorized for warehouse managers', () => {
    expect(capabilitiesFor('warehouse_manager')).toEqual(
      expect.arrayContaining([
        'dashboard.read',
        'reports.read',
      ]),
    );
  });

  it('applies per-user grants and revocations over the role template', () => {
    const capabilities = effectiveCapabilities({
      role: 'seller',
      granted_capabilities: ['sales.read'],
      revoked_capabilities: ['inventory.read'],
    });
    expect(capabilities).toContain('sales.read');
    expect(capabilities).not.toContain('inventory.read');
  });

  it('never allows overrides to reduce the owner authority', () => {
    expect(effectiveCapabilities({
      role: 'owner',
      revoked_capabilities: ['users.manage'],
    })).toContain('users.manage');
  });
});
