const DECIMAL_SEQUENCE = /^(0|[1-9]\d*)$/

function nonEmptyString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value !== 'undefined' &&
    value !== 'null'
  )
}

export type OfflineAccountingContext = {
  v: 1
  purpose: 'pos-offline-accounting'
  key_id: string
  token: string
  session_id: string
  user_id: string
  role: 'branch_manager' | 'cashier'
  branch_id: string
  terminal_id: string
  shift_id: string
  issued_at: string
  expires_at: string
  server_last_sale_sequence: string
}

export function isTerminalSequence(value: unknown): value is string {
  return typeof value === 'string' && DECIMAL_SEQUENCE.test(value)
}

export function parseTerminalSequence(value: unknown): bigint {
  if (!isTerminalSequence(value)) {
    throw new Error('Terminal sequence must be a non-negative decimal integer')
  }
  return BigInt(value)
}

export function maxTerminalSequence(...values: unknown[]): string {
  let maximum = 0n
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue
    const parsed = parseTerminalSequence(String(value))
    if (parsed > maximum) maximum = parsed
  }
  return maximum.toString()
}

export function nextTerminalSequence(...values: unknown[]): string {
  return (BigInt(maxTerminalSequence(...values)) + 1n).toString()
}

export function isValidOfflineAccountingContext(
  value: unknown,
  nowMs = Date.now(),
  minimumRemainingMs = 0,
): value is OfflineAccountingContext {
  const context = value as Partial<OfflineAccountingContext> | null
  if (!context || typeof context !== 'object') return false

  const issuedAt = Date.parse(String(context.issued_at || ''))
  const expiresAt = Date.parse(String(context.expires_at || ''))
  const tokenParts = String(context.token || '').split('.')

  return (
    context.v === 1 &&
    context.purpose === 'pos-offline-accounting' &&
    nonEmptyString(context.key_id) &&
    tokenParts.length === 3 &&
    tokenParts[0] === context.key_id &&
    nonEmptyString(context.session_id) &&
    nonEmptyString(context.user_id) &&
    ['cashier', 'branch_manager'].includes(String(context.role)) &&
    nonEmptyString(context.branch_id) &&
    nonEmptyString(context.terminal_id) &&
    nonEmptyString(context.shift_id) &&
    Number.isFinite(issuedAt) &&
    Number.isFinite(expiresAt) &&
    expiresAt > issuedAt &&
    expiresAt - nowMs > minimumRemainingMs &&
    isTerminalSequence(context.server_last_sale_sequence)
  )
}

export function offlineAccountingContextMatches(
  context: unknown,
  expected: {
    session: {
      user: {
        id: string
        role: 'branch_manager' | 'cashier'
        branch_id: string
      }
    }
    device: { branch_id: string; terminal_id: string }
    shift: { id: string; branch_id: string }
  },
  nowMs = Date.now(),
  minimumRemainingMs = 0,
): context is OfflineAccountingContext {
  if (
    !isValidOfflineAccountingContext(
      context,
      nowMs,
      minimumRemainingMs,
    )
  ) {
    return false
  }

  return (
    context.user_id === expected.session.user.id &&
    context.role === expected.session.user.role &&
    context.branch_id === expected.session.user.branch_id &&
    context.branch_id === expected.device.branch_id &&
    context.branch_id === expected.shift.branch_id &&
    context.terminal_id === expected.device.terminal_id &&
    context.shift_id === expected.shift.id
  )
}
