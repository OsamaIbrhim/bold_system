/**
 * Pricing codes — WP-008 Phase B (Price Books and Pricing Evaluation).
 *
 * `RESOURCE_NOT_FOUND` (auth.ts) already covers every "not found or not in
 * this tenant" case for the new tables (PriceBook/PriceBookEntry/
 * PriceOverride/Discount/PriceOverridePolicy), matching the `brands`/`uom`
 * precedent — nothing new is registered for that. The codes below are for
 * business-rule invariants specific to this phase (BR §13–16).
 */

import type { ErrorMetadata } from '../registry';

export const PRICING_ERROR_CODES = [
  {
    // BR-PSL-101/BR-CERR-200: no resolvable Price Book entry at any priority
    // level blocks the sale by default — never a silent zero.
    code: 'PRICING_NO_PRICE_AVAILABLE',
    category: 'business_rule',
    defaultHttpStatus: 422,
    retryable: false,
    retryMode: 'after_user_action',
    outcome: 'no_effect',
    severity: 'error',
    auditRequired: true,
  },
  {
    // BR-PSL-102: a zero-price entry requires `allow_zero_price`; BR-PSL-103:
    // negative is never valid regardless of allowance.
    code: 'PRICING_ZERO_OR_NEGATIVE_PRICE_NOT_ALLOWED',
    category: 'request_invalid',
    defaultHttpStatus: 400,
    retryable: false,
    retryMode: 'after_user_action',
    outcome: 'no_effect',
    severity: 'warning',
    auditRequired: false,
  },
  {
    // BR-PRB-100/OD-CAT-005: Phase B is single-currency — a Price Book's
    // currency must equal the owning Tenant's `default_currency`.
    code: 'PRICING_CURRENCY_MISMATCH',
    category: 'request_invalid',
    defaultHttpStatus: 400,
    retryable: false,
    retryMode: 'after_user_action',
    outcome: 'no_effect',
    severity: 'warning',
    auditRequired: false,
  },
  {
    // BR-PRB-101: draft -> submitted -> approved -> scheduled -> active ->
    // ended is a strict sequence; any other transition is rejected.
    code: 'PRICING_PRICE_BOOK_INVALID_TRANSITION',
    category: 'state_conflict',
    defaultHttpStatus: 409,
    retryable: false,
    retryMode: 'never',
    outcome: 'no_effect',
    severity: 'error',
    auditRequired: true,
  },
  {
    // Permission Matrix §17 "Separation": the Price Book's creator/submitter
    // cannot also approve it under a P2 (independent approver) policy.
    code: 'PRICING_PRICE_BOOK_SELF_APPROVAL_FORBIDDEN',
    category: 'authorization',
    defaultHttpStatus: 403,
    retryable: false,
    retryMode: 'never',
    outcome: 'no_effect',
    severity: 'error',
    auditRequired: true,
  },
  {
    // BR-PRB-104: only one *active* default Price Book may exist per
    // (currency, scope, scope_ref_id). Raised instead of leaking the raw
    // Prisma P2002 when a caller flags a second book default for a scope
    // that already has a live default.
    code: 'PRICING_DEFAULT_PRICE_BOOK_CONFLICT',
    category: 'state_conflict',
    defaultHttpStatus: 409,
    retryable: false,
    retryMode: 'after_user_action',
    outcome: 'no_effect',
    severity: 'error',
    auditRequired: true,
  },
  {
    // BR-PRB-105: an in-use (active, or referenced by any PriceOverride/
    // Discount evidence) Price Book cannot be hard-deleted — archive it.
    code: 'PRICING_PRICE_BOOK_DELETE_FORBIDDEN',
    category: 'business_rule',
    defaultHttpStatus: 409,
    retryable: false,
    retryMode: 'never',
    outcome: 'no_effect',
    severity: 'error',
    auditRequired: true,
  },
  {
    // BR-PRB-102/103: there is no update path for an active entry — a new
    // version is created and the previous row is superseded instead.
    code: 'PRICING_ENTRY_IMMUTABLE',
    category: 'state_conflict',
    defaultHttpStatus: 409,
    retryable: false,
    retryMode: 'never',
    outcome: 'no_effect',
    severity: 'error',
    auditRequired: true,
  },
  {
    // BR-OVP-101: the override exceeds the calling role's configured
    // PriceOverridePolicy limit (max discount %/amount, or a disallowed
    // price increase).
    code: 'PRICING_OVERRIDE_LIMIT_EXCEEDED',
    category: 'business_rule',
    defaultHttpStatus: 422,
    retryable: false,
    retryMode: 'after_approval',
    outcome: 'no_effect',
    severity: 'warning',
    auditRequired: true,
  },
  {
    // BR-OVP-102: an override below the resolved floor requires
    // `pricing.manual-override.above-threshold` / a recorded approval —
    // never implied by `pricing.manual-override.apply` alone.
    code: 'PRICING_OVERRIDE_BELOW_FLOOR_REQUIRES_APPROVAL',
    category: 'authorization',
    defaultHttpStatus: 403,
    retryable: false,
    retryMode: 'after_approval',
    outcome: 'no_effect',
    severity: 'error',
    auditRequired: true,
  },
  {
    // BR-OVP-102 + Permission Matrix §17/§63/§64: a below-floor override is
    // approved by an identity other than the one that applied it. Different
    // sessions of the same identity never satisfy the separation.
    code: 'PRICING_OVERRIDE_SELF_APPROVAL_FORBIDDEN',
    category: 'authorization',
    defaultHttpStatus: 403,
    retryable: false,
    retryMode: 'never',
    outcome: 'no_effect',
    severity: 'error',
    auditRequired: true,
  },
  {
    // BR-OVP-102: the override is already approved (or was never a
    // below-floor override needing approval) — approving again is a no-op
    // that must not silently overwrite the recorded approver.
    code: 'PRICING_OVERRIDE_NOT_PENDING_APPROVAL',
    category: 'state_conflict',
    defaultHttpStatus: 409,
    retryable: false,
    retryMode: 'never',
    outcome: 'no_effect',
    severity: 'error',
    auditRequired: true,
  },
  {
    // BR-DSC-202: a discount can never take a line's value negative.
    code: 'PRICING_DISCOUNT_EXCEEDS_BASE_PRICE',
    category: 'request_invalid',
    defaultHttpStatus: 400,
    retryable: false,
    retryMode: 'after_user_action',
    outcome: 'no_effect',
    severity: 'warning',
    auditRequired: false,
  },
] as const satisfies readonly ErrorMetadata[];
