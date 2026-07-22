import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { loadOfflineAccountingConfiguration } from '../config/environment';
import {
  OfflineAccountingClaims,
  OfflineAccountingRole,
  signOfflineAccountingTicket,
  verifyOfflineAccountingTicket,
} from './offline-accounting-ticket';

export type IssuedOfflineAccountingContext = OfflineAccountingClaims & {
  key_id: string;
  token: string;
  server_last_sale_sequence: string;
};

@Injectable()
export class OfflineAccountingTicketService {
  private readonly configuration = loadOfflineAccountingConfiguration();

  issue(input: {
    user_id: string;
    role: OfflineAccountingRole;
    branch_id: string;
    terminal_id: string;
    shift_id: string;
    server_last_sale_sequence: bigint;
  }, nowMs = Date.now()): IssuedOfflineAccountingContext {
    const issuedAt = new Date(nowMs).toISOString();
    const expiresAt = new Date(
      nowMs + this.configuration.ttlMs,
    ).toISOString();
    const signed = signOfflineAccountingTicket(
      this.configuration.activeKey,
      {
        session_id: randomUUID(),
        user_id: input.user_id,
        role: input.role,
        branch_id: input.branch_id,
        terminal_id: input.terminal_id,
        shift_id: input.shift_id,
        issued_at: issuedAt,
        expires_at: expiresAt,
      },
    );
    return {
      ...signed,
      server_last_sale_sequence: input.server_last_sale_sequence.toString(),
    };
  }

  verifySaleContext(input: {
    token: string;
    offline_session_id: string;
    origin_cashier_id: string;
    branch_id: string;
    terminal_id: string;
    shift_id: string;
    occurred_at: Date;
    received_at?: Date;
  }) {
    let claims: OfflineAccountingClaims;
    try {
      claims = verifyOfflineAccountingTicket(
        this.configuration.keysById,
        input.token,
      );
    } catch {
      throw new UnprocessableEntityException({
        code: 'OFFLINE_ACCOUNTING_TICKET_INVALID',
        message_ar:
          'هوية الكاشير أو الوردية المحفوظة مع العملية غير صحيحة. لا يمكن نسب العملية إلى مستخدم أو وردية أخرى.',
        message: 'Invalid offline accounting ticket',
      });
    }

    if (
      claims.session_id !== input.offline_session_id ||
      claims.user_id !== input.origin_cashier_id ||
      claims.branch_id !== input.branch_id ||
      claims.terminal_id !== input.terminal_id ||
      claims.shift_id !== input.shift_id
    ) {
      throw new UnprocessableEntityException({
        code: 'OFFLINE_ACCOUNTING_CONTEXT_MISMATCH',
        message_ar:
          'بيانات العملية لا تطابق هوية الكاشير والجهاز والوردية الموقعة وقت البيع.',
        message: 'Offline accounting context does not match the sale',
      });
    }

    const occurredAtMs = input.occurred_at.getTime();
    const receivedAtMs = (input.received_at || new Date()).getTime();
    const issuedAtMs = Date.parse(claims.issued_at);
    const expiresAtMs = Date.parse(claims.expires_at);
    const skew = this.configuration.clockSkewMs;
    if (
      !Number.isFinite(occurredAtMs) ||
      occurredAtMs < issuedAtMs - skew ||
      occurredAtMs >= expiresAtMs ||
      occurredAtMs > receivedAtMs + skew
    ) {
      throw new UnprocessableEntityException({
        code: 'OFFLINE_SALE_TIME_INVALID',
        message_ar:
          'وقت البيع خارج فترة صلاحية جلسة الكاشير الموقعة أو متقدم عن وقت الخادم.',
        message: 'Offline sale time is outside the signed session window',
      });
    }

    return claims;
  }

  get clockSkewMs() {
    return this.configuration.clockSkewMs;
  }
}
