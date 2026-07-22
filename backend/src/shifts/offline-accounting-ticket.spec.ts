import {
  signOfflineAccountingTicket,
  verifyOfflineAccountingTicket,
} from './offline-accounting-ticket';

const key = {
  id: 'offline-2026-07',
  secret: 'offline-ticket-secret-with-enough-character-diversity-001',
};

const input = {
  session_id: '11111111-1111-4111-8111-111111111111',
  user_id: '22222222-2222-4222-8222-222222222222',
  role: 'cashier' as const,
  branch_id: '33333333-3333-4333-8333-333333333333',
  terminal_id: '44444444-4444-4444-8444-444444444444',
  shift_id: '55555555-5555-4555-8555-555555555555',
  issued_at: '2026-07-22T00:00:00.000Z',
  expires_at: '2026-07-23T00:00:00.000Z',
};

describe('offline accounting ticket', () => {
  it('binds the cashier, branch, terminal and shift to a signed session', () => {
    const signed = signOfflineAccountingTicket(key, input);
    const claims = verifyOfflineAccountingTicket(
      new Map([[key.id, key]]),
      signed.token,
    );
    expect(claims).toMatchObject(input);
  });

  it('rejects a modified ticket payload', () => {
    const signed = signOfflineAccountingTicket(key, input);
    const [keyId, payload, signature] = signed.token.split('.');
    const modified = `${keyId}.${payload.slice(0, -1)}A.${signature}`;
    expect(() =>
      verifyOfflineAccountingTicket(new Map([[key.id, key]]), modified),
    ).toThrow();
  });

  it('rejects an unknown rotation key id', () => {
    const signed = signOfflineAccountingTicket(key, input);
    expect(() =>
      verifyOfflineAccountingTicket(new Map(), signed.token),
    ).toThrow(/Unknown/);
  });
});
