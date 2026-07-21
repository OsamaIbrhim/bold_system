import { describe, expect, it } from 'vitest';

function catalogIsFresh(validUntil?: string | null, now = Date.now()) {
  const timestamp = new Date(validUntil || 0).getTime();
  return Number.isFinite(timestamp) && timestamp > now;
}

describe('POS price catalog policy', () => {
  it('allows payment before the server-issued validity deadline', () => {
    expect(catalogIsFresh('2026-07-21T12:00:00.000Z', Date.parse('2026-07-21T11:59:59.000Z'))).toBe(true);
  });
  it('blocks payment at or after the deadline', () => {
    expect(catalogIsFresh('2026-07-21T12:00:00.000Z', Date.parse('2026-07-21T12:00:00.000Z'))).toBe(false);
  });
});
