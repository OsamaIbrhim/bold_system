import { createHmac } from 'crypto';
import {
  priceSnapshotKeyId,
  priceVersion,
  signPriceSnapshot,
  verifyLegacyPriceSnapshot,
  verifyPriceSnapshot,
} from './price-snapshot';

const key = {
  id: 'price-2026-07',
  secret: 'test-price-snapshot-secret-at-least-32-characters',
};
const otherKey = {
  id: 'price-2026-06',
  secret: 'different-price-snapshot-secret-at-least-32-characters',
};
const input = { branch_id: 'branch-1', variant_id: 'variant-1', unit_price: 100, unit_tax: 14 };

function legacyToken() {
  const claims = {
    v: 1,
    branch_id: input.branch_id,
    variant_id: input.variant_id,
    unit_price: '100.00',
    unit_tax: '14.00',
    price_version: priceVersion(input),
    issued_at: '2026-07-21T00:00:00.000Z',
  };
  const encoded = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', key.secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

describe('versioned signed price snapshots', () => {
  it('keeps a stable financial version when signing keys rotate', () => {
    expect(priceVersion(input)).toBe(priceVersion({ ...input, unit_price: '100.00' }));
    expect(signPriceSnapshot(key, input).price_version).toBe(signPriceSnapshot(otherKey, input).price_version);
  });

  it('embeds and verifies the exact key id, branch, variant, and amounts', () => {
    const signed = signPriceSnapshot(key, { ...input, issued_at: '2026-07-21T00:00:00.000Z' });
    expect(priceSnapshotKeyId(signed.price_token)).toBe(key.id);
    const claims = verifyPriceSnapshot(key, signed.price_token, {
      ...input,
      price_version: signed.price_version,
    });
    expect(claims.kid).toBe(key.id);
  });

  it('rejects an unknown/wrong key and a locally modified amount', () => {
    const signed = signPriceSnapshot(key, input);
    expect(() => verifyPriceSnapshot(otherKey, signed.price_token, {
      ...input,
      price_version: signed.price_version,
    })).toThrow();
    expect(() => verifyPriceSnapshot(key, signed.price_token, {
      ...input,
      unit_price: 99,
      price_version: signed.price_version,
    })).toThrow();
  });

  it('supports old two-part tokens only through the explicit legacy verifier', () => {
    const token = legacyToken();
    expect(priceSnapshotKeyId(token)).toBeNull();
    const claims = verifyLegacyPriceSnapshot(key.secret, token, {
      ...input,
      price_version: priceVersion(input),
    });
    expect(claims.v).toBe(1);
    expect(() => verifyPriceSnapshot(key, token, {
      ...input,
      price_version: priceVersion(input),
    })).toThrow();
  });
});
