import { capabilitiesFor } from './permissions';

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
});
