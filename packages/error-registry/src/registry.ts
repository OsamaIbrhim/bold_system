/**
 * The stable error-code registry — Error Catalog v1.0 §29.
 *
 * `getErrorMetadata` is the single seam every Backend error-mapping path must
 * go through: it throws a developer-time error for any code that was thrown
 * without first being registered here, which is what prevents silent drift
 * between thrown codes and the catalog.
 */

import type { ErrorCategory } from './categories';
import type { RetryMode } from './retry-modes';
import type { OutcomeCertainty } from './outcomes';
import { COMMON_ERROR_CODES } from './codes/common';
import { AUTH_ERROR_CODES } from './codes/auth';
import { INTERNAL_ERROR_CODES } from './codes/internal';
import { IDENTITY_ERROR_CODES } from './codes/identity';
import { CATALOG_ERROR_CODES } from './codes/catalog';
import { PRICING_ERROR_CODES } from './codes/pricing';

export const ERROR_SEVERITIES = ['info', 'warning', 'error', 'critical'] as const;
export type ErrorSeverity = (typeof ERROR_SEVERITIES)[number];

/** Error Catalog §29 metadata every registered code must declare. */
export interface ErrorMetadata {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly defaultHttpStatus: number;
  readonly retryable: boolean;
  readonly retryMode: RetryMode;
  readonly outcome: OutcomeCertainty;
  readonly severity: ErrorSeverity;
  readonly auditRequired: boolean;
}

const REGISTERED_DEFINITIONS = [
  ...COMMON_ERROR_CODES,
  ...AUTH_ERROR_CODES,
  ...INTERNAL_ERROR_CODES,
  ...IDENTITY_ERROR_CODES,
  ...CATALOG_ERROR_CODES,
  ...PRICING_ERROR_CODES,
] as const;

export type ErrorCode =
  | (typeof COMMON_ERROR_CODES)[number]['code']
  | (typeof AUTH_ERROR_CODES)[number]['code']
  | (typeof INTERNAL_ERROR_CODES)[number]['code']
  | (typeof IDENTITY_ERROR_CODES)[number]['code']
  | (typeof CATALOG_ERROR_CODES)[number]['code']
  | (typeof PRICING_ERROR_CODES)[number]['code'];

export const ERROR_REGISTRY: Readonly<Record<ErrorCode, ErrorMetadata>> = Object.freeze(
  Object.fromEntries(REGISTERED_DEFINITIONS.map((definition) => [definition.code, definition])),
) as Readonly<Record<ErrorCode, ErrorMetadata>>;

/**
 * Throws if `code` was never registered — call this instead of reading
 * `ERROR_REGISTRY` directly so unregistered codes fail loudly at throw time,
 * not silently at the HTTP boundary.
 */
export function getErrorMetadata(code: string): ErrorMetadata {
  const metadata = (ERROR_REGISTRY as Record<string, ErrorMetadata | undefined>)[code];
  if (!metadata) {
    throw new Error(
      `Unregistered ATHR error code "${code}". Add it to @athr/error-registry (packages/error-registry/src/codes/*.ts) before throwing or mapping it.`,
    );
  }
  return metadata;
}
