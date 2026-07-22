import { validateSecret } from '../config/environment';

export function getJwtSecret(): string {
  return validateSecret('JWT_SECRET', process.env.JWT_SECRET);
}
