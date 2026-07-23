const ALLOWED_API_ROUTES = [
  ['GET', /^\/auth\/me$/],
  ['GET', /^\/products\/search\?/],
  ['POST', /^\/pos\/sale$/],
  ['POST', /^\/pricing\/calculate$/],
  ['GET', /^\/customers\/lookup\?/],
  ['GET', /^\/customers\/loyalty\?/],
  ['GET', /^\/customers(?:\?|$)/],
  ['POST', /^\/customers$/],
  ['GET', /^\/sales(?:\?|$)/],
  ['GET', /^\/sales\/[^/?]+$/],
  ['GET', /^\/pos\/invoices\/lookup\?/],
  ['POST', /^\/pos\/return$/],
  ['GET', /^\/shifts\/current\?/],
  ['POST', /^\/shifts\/open$/],
  ['POST', /^\/shifts\/[^/?]+\/close$/],
  ['GET', /^\/sync\/pull\?/],
  ['POST', /^\/terminals\/heartbeat$/],
  ['GET', /^\/returns(?:\?|$)/],
] as const

export class PosApiPolicyError extends Error {
  readonly code = 'POS_API_OPERATION_DENIED'

  constructor() {
    super('The requested POS API operation is not allowed')
    this.name = 'PosApiPolicyError'
  }
}

export function assertAllowedApiRequest(
  pathname: unknown,
  method: unknown,
) {
  const pathValue = String(pathname || '')
  const methodValue =
    String(method || 'GET').toUpperCase()
  const allowed = ALLOWED_API_ROUTES.some(
    ([allowedMethod, pattern]) =>
      methodValue === allowedMethod &&
      pattern.test(pathValue),
  )
  if (!allowed) throw new PosApiPolicyError()
  return {
    pathname: pathValue,
    method: methodValue,
  }
}
