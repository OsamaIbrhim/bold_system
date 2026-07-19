import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthenticatedUser } from './authenticated-user';

export function assertBranchAccess(
  user: AuthenticatedUser,
  branchId: string,
  globalRoles: Role[] = ['owner'],
) {
  if (globalRoles.includes(user.role)) return;
  if (!user.branch_id || user.branch_id !== branchId) {
    throw new ForbiddenException('You cannot access another branch');
  }
}

export function resolveBranchScope(
  user: AuthenticatedUser,
  requestedBranchId?: string,
  globalRoles: Role[] = ['owner'],
) {
  if (globalRoles.includes(user.role)) return requestedBranchId;
  if (!user.branch_id || (requestedBranchId && requestedBranchId !== user.branch_id)) {
    throw new ForbiddenException('You cannot access another branch');
  }
  return user.branch_id;
}
