/**
 * Express-scoped JSON fallback for database counters and cursors. API services
 * should still expose BigInt values explicitly as decimal strings; this guard
 * prevents an unexpected future BigInt field from turning a valid request into
 * an HTTP 500 without mutating the global BigInt prototype.
 */
export function apiJsonReplacer(_key: string, value: unknown) {
  return typeof value === 'bigint' ? value.toString() : value;
}
