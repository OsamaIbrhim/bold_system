import { Role } from '@prisma/client';
import { Capability } from './permissions';

export interface AuthenticatedUser {
  sub: string;
  role: Role;
  branch_id: string | null;
  capabilities?: Capability[];
}
