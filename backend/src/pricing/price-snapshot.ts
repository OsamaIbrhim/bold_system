import { createHash, createHmac, timingSafeEqual } from 'crypto';

export type PriceSnapshotClaims = {
  v: 1;
  branch_id: string;
  variant_id: string;
  unit_price: string;
  unit_tax: string;
  price_version: string;
  issued_at: string;
};

export type PriceSnapshotInput = {
  branch_id: string;
  variant_id: string;
  unit_price: number | string;
  unit_tax: number | string;
  issued_at?: string;
};

function canonicalMoney(value: number | string) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) throw new Error('Invalid money value');
  return numeric.toFixed(2);
}

export function priceVersion(input: Omit<PriceSnapshotInput, 'issued_at'>) {
  const canonical = [
    'v1',
    input.branch_id,
    input.variant_id,
    canonicalMoney(input.unit_price),
    canonicalMoney(input.unit_tax),
  ].join('|');
  return createHash('sha256').update(canonical).digest('hex');
}

export function signPriceSnapshot(secret: string, input: PriceSnapshotInput) {
  if (!secret || secret.length < 32) throw new Error('PRICE_SNAPSHOT_SECRET must be at least 32 characters');
  const claims: PriceSnapshotClaims = {
    v: 1,
    branch_id: input.branch_id,
    variant_id: input.variant_id,
    unit_price: canonicalMoney(input.unit_price),
    unit_tax: canonicalMoney(input.unit_tax),
    price_version: priceVersion(input),
    issued_at: input.issued_at || new Date().toISOString(),
  };
  const encoded = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
  return { ...claims, price_token: `${encoded}.${signature}` };
}

export function verifyPriceSnapshot(
  secret: string,
  token: string,
  expected: Omit<PriceSnapshotInput, 'issued_at'> & { price_version: string },
) {
  if (!secret || secret.length < 32) throw new Error('PRICE_SNAPSHOT_SECRET must be at least 32 characters');
  const [encoded, signature, extra] = String(token || '').split('.');
  if (!encoded || !signature || extra) throw new Error('Malformed price token');
  const calculated = createHmac('sha256', secret).update(encoded).digest();
  const supplied = Buffer.from(signature, 'base64url');
  if (calculated.length !== supplied.length || !timingSafeEqual(calculated, supplied)) {
    throw new Error('Invalid price token signature');
  }
  const claims = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as PriceSnapshotClaims;
  const recomputed = priceVersion(expected);
  if (
    claims.v !== 1 ||
    claims.branch_id !== expected.branch_id ||
    claims.variant_id !== expected.variant_id ||
    claims.unit_price !== canonicalMoney(expected.unit_price) ||
    claims.unit_tax !== canonicalMoney(expected.unit_tax) ||
    claims.price_version !== expected.price_version ||
    claims.price_version !== recomputed ||
    !Number.isFinite(new Date(claims.issued_at).getTime())
  ) {
    throw new Error('Price snapshot does not match the sale line');
  }
  return claims;
}
