import { priceVersion, signPriceSnapshot, verifyPriceSnapshot } from './price-snapshot';

const secret = 'test-price-snapshot-secret-at-least-32-characters';
const input = { branch_id: 'branch-1', variant_id: 'variant-1', unit_price: 100, unit_tax: 14 };

describe('signed price snapshots', () => {
  it('keeps a stable version for the same financial snapshot', () => {
    expect(priceVersion(input)).toBe(priceVersion({ ...input, unit_price: '100.00' }));
  });

  it('verifies the exact branch, variant and money values', () => {
    const signed = signPriceSnapshot(secret, { ...input, issued_at: '2026-07-21T00:00:00.000Z' });
    const claims = verifyPriceSnapshot(secret, signed.price_token, { ...input, price_version: signed.price_version });
    expect(claims.price_version).toBe(signed.price_version);
  });

  it('rejects a locally modified amount', () => {
    const signed = signPriceSnapshot(secret, input);
    expect(() => verifyPriceSnapshot(secret, signed.price_token, {
      ...input, unit_price: 99, price_version: signed.price_version,
    })).toThrow();
  });

  it('rejects a modified token', () => {
    const signed = signPriceSnapshot(secret, input);
    expect(() => verifyPriceSnapshot(secret, `${signed.price_token}x`, {
      ...input, price_version: signed.price_version,
    })).toThrow();
  });
});
