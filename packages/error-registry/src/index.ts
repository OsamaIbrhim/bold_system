export { ERROR_CATEGORIES } from './categories';
export type { ErrorCategory } from './categories';

export { RETRY_MODES } from './retry-modes';
export type { RetryMode } from './retry-modes';

export { OUTCOME_CERTAINTIES } from './outcomes';
export type { OutcomeCertainty } from './outcomes';

export { COMMON_ERROR_CODES } from './codes/common';
export { AUTH_ERROR_CODES } from './codes/auth';
export { INTERNAL_ERROR_CODES } from './codes/internal';
export { IDENTITY_ERROR_CODES } from './codes/identity';
export { CATALOG_ERROR_CODES } from './codes/catalog';
export { PRICING_ERROR_CODES } from './codes/pricing';

export { ERROR_SEVERITIES, ERROR_REGISTRY, getErrorMetadata } from './registry';
export type { ErrorSeverity, ErrorMetadata, ErrorCode } from './registry';
