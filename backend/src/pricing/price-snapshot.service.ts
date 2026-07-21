import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { PriceQuote } from './pricing.service';
import { signPriceSnapshot, verifyPriceSnapshot } from './price-snapshot';

@Injectable()
export class PriceSnapshotService {
  private readonly secrets: string[];

  constructor() {
    const configured = (process.env.PRICE_SNAPSHOT_SECRETS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const fallback = process.env.PRICE_SNAPSHOT_SECRET || process.env.JWT_SECRET || '';
    this.secrets = configured.length ? configured : [fallback];
    if (this.secrets.some((secret) => secret.length < 32)) {
      throw new Error('Every price snapshot secret must be at least 32 characters');
    }
  }

  issue(branchId: string, variantId: string, quote: Pick<PriceQuote, 'net_price' | 'tax_amount'>, issuedAt?: string) {
    return signPriceSnapshot(this.secrets[0], {
      branch_id: branchId,
      variant_id: variantId,
      unit_price: quote.net_price,
      unit_tax: quote.tax_amount,
      issued_at: issuedAt,
    });
  }

  verify(input: {
    branch_id: string;
    variant_id: string;
    unit_price: number;
    unit_tax: number;
    price_version: string;
    price_token: string;
  }) {
    for (const secret of this.secrets) {
      try {
        return verifyPriceSnapshot(secret, input.price_token, input);
      } catch {
        // Try the previous key during a controlled secret rotation.
      }
    }
    {
      throw new UnprocessableEntityException({
        code: 'PRICE_SNAPSHOT_INVALID',
        message_ar: 'بيانات السعر المحلية غير صحيحة أو تم تعديلها. أعد مزامنة الكتالوج.',
        message: 'Invalid or tampered price snapshot',
      });
    }
  }
}
