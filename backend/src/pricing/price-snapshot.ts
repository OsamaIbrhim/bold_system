import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { PriceSnapshotKey } from '../config/environment';
import { moneyString } from '../common/money';

export type PriceSnapshotClaims = {
  v: 2;
  kid: string;
  branch_id: string;
  variant_id: string;
  unit_price: string;
  unit_tax: string;
  price_version: string;
  issued_at: string;
};

export type LegacyPriceSnapshotClaims = {
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

type ExpectedSnapshot = Omit<PriceSnapshotInput, 'issued_at'> & {
  price_version: string;
};

function canonicalMoney(value: number | string) {
  const canonical = moneyString(value);
  if (canonical.startsWith('-')) throw new Error('Invalid money value');
  return canonical;
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

function verifySignature(secret: string, signedValue: string, suppliedValue: string) {
  const calculated = createHmac('sha256', secret).update(signedValue).digest();
  const supplied = Buffer.from(suppliedValue, 'base64url');
  if (calculated.length !== supplied.length || !timingSafeEqual(calculated, supplied)) {
    throw new Error('Invalid price token signature');
  }
}

function verifyFinancialClaims(
  claims: PriceSnapshotClaims | LegacyPriceSnapshotClaims,
  expected: ExpectedSnapshot,
) {
  const recomputed = priceVersion(expected);
  if (
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
}

export function signPriceSnapshot(key: PriceSnapshotKey, input: PriceSnapshotInput) {
  const claims: PriceSnapshotClaims = {
    v: 2,
    kid: key.id,
    branch_id: input.branch_id,
    variant_id: input.variant_id,
    unit_price: canonicalMoney(input.unit_price),
    unit_tax: canonicalMoney(input.unit_tax),
    price_version: priceVersion(input),
    issued_at: input.issued_at || new Date().toISOString(),
  };
  const encoded = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signedValue = `${key.id}.${encoded}`;
  const signature = createHmac('sha256', key.secret).update(signedValue).digest('base64url');
  return { ...claims, price_token: `${signedValue}.${signature}` };
}

export function priceSnapshotKeyId(token: string) {
  const parts = String(token || '').split('.');
  return parts.length === 3 && parts[0] ? parts[0] : null;
}

export function verifyPriceSnapshot(
  key: PriceSnapshotKey,
  token: string,
  expected: ExpectedSnapshot,
) {
  const [tokenKeyId, encoded, signature, extra] = String(token || '').split('.');
  if (!tokenKeyId || !encoded || !signature || extra) throw new Error('Malformed price token');
  if (tokenKeyId !== key.id) throw new Error('Price token key id does not match the verification key');
  verifySignature(key.secret, `${tokenKeyId}.${encoded}`, signature);
  const claims = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as PriceSnapshotClaims;
  if (claims.v !== 2 || claims.kid !== tokenKeyId) {
    throw new Error('Unsupported price snapshot version or key id');
  }
  verifyFinancialClaims(claims, expected);
  return claims;
}

export function verifyLegacyPriceSnapshot(
  secret: string,
  token: string,
  expected: ExpectedSnapshot,
) {
  const [encoded, signature, extra] = String(token || '').split('.');
  if (!encoded || !signature || extra) throw new Error('Malformed legacy price token');
  verifySignature(secret, encoded, signature);
  const claims = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as LegacyPriceSnapshotClaims;
  if (claims.v !== 1) throw new Error('Unsupported legacy price snapshot version');
  verifyFinancialClaims(claims, expected);
  return claims;
}
