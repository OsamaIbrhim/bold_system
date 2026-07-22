import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { loadPriceSnapshotConfiguration } from '../config/environment';
import { PriceQuote } from './pricing.service';
import {
  priceSnapshotKeyId,
  signPriceSnapshot,
  verifyLegacyPriceSnapshot,
  verifyPriceSnapshot,
} from './price-snapshot';

@Injectable()
export class PriceSnapshotService {
  private readonly configuration = loadPriceSnapshotConfiguration();

  issue(
    branchId: string,
    variantId: string,
    quote: Pick<PriceQuote, 'net_price' | 'tax_amount'>,
    issuedAt?: string,
  ) {
    return signPriceSnapshot(this.configuration.activeKey, {
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
    const keyId = priceSnapshotKeyId(input.price_token);
    try {
      if (keyId) {
        const key = this.configuration.keysById.get(keyId);
        if (!key) throw new Error('Unknown price snapshot key id');
        return verifyPriceSnapshot(key, input.price_token, input);
      }

      if (
        !this.configuration.legacyAcceptUntilMs ||
        Date.now() > this.configuration.legacyAcceptUntilMs
      ) {
        throw new Error('Legacy price snapshots are not accepted');
      }
      for (const secret of this.configuration.legacySecrets) {
        try {
          return verifyLegacyPriceSnapshot(secret, input.price_token, input);
        } catch {
          // Try the next explicitly configured legacy key during the bounded migration window.
        }
      }
      throw new Error('Legacy price snapshot verification failed');
    } catch {
      throw new UnprocessableEntityException({
        code: 'PRICE_SNAPSHOT_INVALID',
        message_ar: 'بيانات السعر المحلية غير صحيحة أو تم تعديلها. أعد مزامنة الكتالوج.',
        message: 'Invalid, expired, or unknown price snapshot',
      });
    }
  }
}
