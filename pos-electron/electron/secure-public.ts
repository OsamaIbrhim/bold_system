import {
  isValidOfflineAccountingContext,
  toOfflineAccountingSummary,
} from './offline-accounting'

export function publicDevice(device: any) {
  if (!device) return null
  const { device_token: _credential, ...metadata } =
    device
  return metadata
}

export function publicSession(auth: any) {
  return auth?.session?.user
    ? { user: auth.session.user }
    : null
}

export function publicAccounting(context: any) {
  return context &&
    isValidOfflineAccountingContext(context)
    ? toOfflineAccountingSummary(context)
    : null
}

export function sanitizeSecureState(state: any) {
  return {
    device: publicDevice(state?.device),
    auth: state?.auth
      ? {
          session: publicSession(state.auth),
          offline_valid_until:
            state.auth.offline_valid_until,
        }
      : null,
    accounting: publicAccounting(
      state?.accounting,
    ),
  }
}

export function sanitizeBootstrapState(
  state: any,
) {
  const projected = sanitizeSecureState(state)
  return {
    ...projected,
    auth: null,
    accounting: null,
  }
}
