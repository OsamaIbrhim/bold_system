import { createHmac, timingSafeEqual } from 'crypto';
import { VersionedSecretKey } from '../config/environment';

export type OfflineAccountingRole = 'cashier' | 'branch_manager';

export type OfflineAccountingClaims = {
  v: 1;
  purpose: 'pos-offline-accounting';
  session_id: string;
  user_id: string;
  role: OfflineAccountingRole;
  branch_id: string;
  terminal_id: string;
  shift_id: string;
  issued_at: string;
  expires_at: string;
};

export type OfflineAccountingIssueInput = Omit<
  OfflineAccountingClaims,
  'v' | 'purpose' | 'issued_at' | 'expires_at'
> & {
  issued_at?: string;
  expires_at: string;
};

function encodeClaims(claims: OfflineAccountingClaims) {
  return Buffer.from(JSON.stringify(claims)).toString('base64url');
}

export function signOfflineAccountingTicket(
  key: VersionedSecretKey,
  input: OfflineAccountingIssueInput,
) {
  const claims: OfflineAccountingClaims = {
    v: 1,
    purpose: 'pos-offline-accounting',
    session_id: input.session_id,
    user_id: input.user_id,
    role: input.role,
    branch_id: input.branch_id,
    terminal_id: input.terminal_id,
    shift_id: input.shift_id,
    issued_at: input.issued_at || new Date().toISOString(),
    expires_at: input.expires_at,
  };
  const encoded = encodeClaims(claims);
  const signature = createHmac('sha256', key.secret)
    .update(`${key.id}.${encoded}`)
    .digest('base64url');
  return {
    ...claims,
    key_id: key.id,
    token: `${key.id}.${encoded}.${signature}`,
  };
}

export function verifyOfflineAccountingTicket(
  keysById: Map<string, VersionedSecretKey>,
  token: string,
) {
  const [keyId, encoded, signature, extra] = String(token || '').split('.');
  if (!keyId || !encoded || !signature || extra) {
    throw new Error('Malformed offline accounting ticket');
  }
  const key = keysById.get(keyId);
  if (!key) throw new Error('Unknown offline accounting ticket key');

  const calculated = createHmac('sha256', key.secret)
    .update(`${keyId}.${encoded}`)
    .digest();
  const supplied = Buffer.from(signature, 'base64url');
  if (
    calculated.length !== supplied.length ||
    !timingSafeEqual(calculated, supplied)
  ) {
    throw new Error('Invalid offline accounting ticket signature');
  }

  let claims: OfflineAccountingClaims;
  try {
    claims = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    ) as OfflineAccountingClaims;
  } catch {
    throw new Error('Invalid offline accounting ticket payload');
  }

  if (
    claims.v !== 1 ||
    claims.purpose !== 'pos-offline-accounting' ||
    !claims.session_id ||
    !claims.user_id ||
    !['cashier', 'branch_manager'].includes(claims.role) ||
    !claims.branch_id ||
    !claims.terminal_id ||
    !claims.shift_id ||
    !Number.isFinite(Date.parse(claims.issued_at)) ||
    !Number.isFinite(Date.parse(claims.expires_at)) ||
    Date.parse(claims.expires_at) <= Date.parse(claims.issued_at)
  ) {
    throw new Error('Invalid offline accounting ticket claims');
  }

  return claims;
}
