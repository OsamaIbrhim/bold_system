import { UnprocessableEntityException } from '@nestjs/common';
import { OfflineAccountingTicketService } from './offline-accounting-ticket.service';

const originalKeys = process.env.POS_OFFLINE_TICKET_KEYS;
const originalTtl = process.env.POS_OFFLINE_TICKET_TTL_MS;
const originalSkew = process.env.POS_OFFLINE_CLOCK_SKEW_MS;

const secret =
  'offline-accounting-service-test-secret-with-sufficient-diversity-001';

function createService() {
  process.env.POS_OFFLINE_TICKET_KEYS = `offline-test=${secret}`;
  process.env.POS_OFFLINE_TICKET_TTL_MS = '3600000';
  process.env.POS_OFFLINE_CLOCK_SKEW_MS = '300000';
  return new OfflineAccountingTicketService();
}

const identity = {
  user_id: '11111111-1111-4111-8111-111111111111',
  role: 'cashier' as const,
  branch_id: '22222222-2222-4222-8222-222222222222',
  terminal_id: '33333333-3333-4333-8333-333333333333',
  shift_id: '44444444-4444-4444-8444-444444444444',
  server_last_sale_sequence: 7n,
};

describe('OfflineAccountingTicketService', () => {
  afterEach(() => {
    if (originalKeys === undefined) delete process.env.POS_OFFLINE_TICKET_KEYS;
    else process.env.POS_OFFLINE_TICKET_KEYS = originalKeys;
    if (originalTtl === undefined) delete process.env.POS_OFFLINE_TICKET_TTL_MS;
    else process.env.POS_OFFLINE_TICKET_TTL_MS = originalTtl;
    if (originalSkew === undefined) delete process.env.POS_OFFLINE_CLOCK_SKEW_MS;
    else process.env.POS_OFFLINE_CLOCK_SKEW_MS = originalSkew;
  });

  it('issues and verifies a cashier, branch, terminal and shift-bound context', () => {
    const service = createService();
    const now = Date.parse('2026-07-22T10:00:00.000Z');
    const context = service.issue(identity, now);

    expect(context.server_last_sale_sequence).toBe('7');
    const verified = service.verifySaleContext({
      token: context.token,
      offline_session_id: context.session_id,
      origin_cashier_id: identity.user_id,
      branch_id: identity.branch_id,
      terminal_id: identity.terminal_id,
      shift_id: identity.shift_id,
      occurred_at: new Date('2026-07-22T10:30:00.000Z'),
      received_at: new Date('2026-07-23T10:30:00.000Z'),
    });
    expect(verified.user_id).toBe(identity.user_id);
  });

  it('rejects changing the original cashier even when the token is otherwise valid', () => {
    const service = createService();
    const now = Date.parse('2026-07-22T10:00:00.000Z');
    const context = service.issue(identity, now);

    expect(() =>
      service.verifySaleContext({
        token: context.token,
        offline_session_id: context.session_id,
        origin_cashier_id: '55555555-5555-4555-8555-555555555555',
        branch_id: identity.branch_id,
        terminal_id: identity.terminal_id,
        shift_id: identity.shift_id,
        occurred_at: new Date('2026-07-22T10:30:00.000Z'),
      }),
    ).toThrow(UnprocessableEntityException);
  });

  it('treats the ticket expiry as an exclusive payment boundary', () => {
    const service = createService();
    const now = Date.parse('2026-07-22T10:00:00.000Z');
    const context = service.issue(identity, now);

    expect(() =>
      service.verifySaleContext({
        token: context.token,
        offline_session_id: context.session_id,
        origin_cashier_id: identity.user_id,
        branch_id: identity.branch_id,
        terminal_id: identity.terminal_id,
        shift_id: identity.shift_id,
        occurred_at: new Date(context.expires_at),
      }),
    ).toThrow(UnprocessableEntityException);
  });
});
