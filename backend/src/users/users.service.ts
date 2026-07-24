import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { CreateUserDto, EGYPTIAN_MOBILE_PATTERN } from './dto/create-user.dto';
import { AuthenticatedUser } from '../auth/authenticated-user';
import {
  Capability, effectiveCapabilities,
} from '../auth/permissions';
import { UpdateUserPermissionsDto } from './dto/update-user-permissions.dto';
@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}
  findAll(actor: AuthenticatedUser) {
    if (actor.role !== 'owner' && !actor.branch_id) return Promise.resolve([]);
    return this.prisma.user.findMany({
      where: actor.role === 'owner'
        ? { role: { not: 'owner' } }
        : {
            branch_id: actor.branch_id || undefined,
            role: { in: ['cashier', 'warehouse_manager', 'seller'] },
          },
      select: {
        id: true,
        branch_id: true,
        name: true,
        phone: true,
        email: true,
        role: true,
        granted_capabilities: true,
        revoked_capabilities: true,
        is_active: true,
        created_at: true,
      },
      orderBy: { created_at: 'desc' },
    });
  }
  async create(data: CreateUserDto, actor: AuthenticatedUser) {
    this.assertCanManageRole(actor, data.role, data.branch_id || null);
    const phone = typeof data.phone === 'string'
      ? data.phone.replace(/\s+/g, '')
      : '';
    if (!EGYPTIAN_MOBILE_PATTERN.test(phone)) {
      throw new BadRequestException('phone must be a valid Egyptian mobile number');
    }

    const { password, ...rest } = data;
    const password_hash = await bcrypt.hash(password, 12);
    return this.prisma.user.create({
      data: { ...rest, phone, password_hash },
      select: {
        id: true,
        branch_id: true,
        name: true,
        phone: true,
        email: true,
        role: true,
        granted_capabilities: true,
        revoked_capabilities: true,
        is_active: true,
        created_at: true,
      },
    });
  }

  async updatePermissions(
    userId: string,
    data: UpdateUserPermissionsDto,
    actor: AuthenticatedUser,
  ) {
    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target) throw new NotFoundException('User not found');
    this.assertCanManageRole(actor, target.role, target.branch_id);

    const overlap = data.granted_capabilities.find((capability) =>
      data.revoked_capabilities.includes(capability));
    if (overlap) {
      throw new BadRequestException(`Capability cannot be granted and revoked: ${overlap}`);
    }
    const actorCapabilities = new Set(actor.capabilities || []);
    const invalidGrant = data.granted_capabilities.find((capability) =>
      !actorCapabilities.has(capability as Capability));
    if (invalidGrant) {
      throw new ForbiddenException(`You cannot grant capability: ${invalidGrant}`);
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        granted_capabilities: data.granted_capabilities,
        revoked_capabilities: data.revoked_capabilities,
      },
      select: {
        id: true, branch_id: true, name: true, phone: true, email: true,
        role: true, granted_capabilities: true, revoked_capabilities: true,
        is_active: true, created_at: true,
      },
    });
    return { ...updated, capabilities: effectiveCapabilities(updated) };
  }

  private assertCanManageRole(
    actor: AuthenticatedUser,
    targetRole: string,
    targetBranchId: string | null,
  ) {
    if (targetRole === 'owner') {
      throw new ForbiddenException('The owner account cannot be managed here');
    }
    if (actor.role === 'owner') return;
    if (
      actor.role !== 'branch_manager' ||
      !actor.branch_id ||
      targetBranchId !== actor.branch_id ||
      !['cashier', 'warehouse_manager', 'seller'].includes(targetRole)
    ) {
      throw new ForbiddenException('You can only manage subordinate users in your branch');
    }
  }
}
