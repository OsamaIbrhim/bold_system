export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32 || secret.startsWith('change-me')) {
    throw new Error('JWT_SECRET must be configured with at least 32 non-default characters');
  }
  return secret;
}
