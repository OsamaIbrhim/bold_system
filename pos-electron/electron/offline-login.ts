import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'crypto'

export type OfflineLoginVerifier = {
  phone: string
  salt: string
  hash: string
}

export function normalizeLoginPhone(value: unknown) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '')
}

function derive(password: string, salt: Buffer) {
  return scryptSync(password, salt, 32)
}

export function createOfflineLoginVerifier(
  phone: string,
  password: string,
): OfflineLoginVerifier {
  const normalizedPhone = normalizeLoginPhone(phone)
  if (!normalizedPhone || password.length < 8) {
    throw new Error(
      'A valid phone and password are required for offline login',
    )
  }
  const salt = randomBytes(16)
  return {
    phone: normalizedPhone,
    salt: salt.toString('base64'),
    hash: derive(password, salt).toString('base64'),
  }
}

export function verifyOfflineLogin(
  verifier: OfflineLoginVerifier | null | undefined,
  phone: string,
  password: string,
) {
  if (
    !verifier ||
    normalizeLoginPhone(phone) !== verifier.phone ||
    password.length < 8
  ) {
    return false
  }
  try {
    const salt = Buffer.from(verifier.salt, 'base64')
    const expected = Buffer.from(
      verifier.hash,
      'base64',
    )
    const actual = derive(password, salt)
    return (
      expected.length === actual.length &&
      timingSafeEqual(expected, actual)
    )
  } catch {
    return false
  }
}
