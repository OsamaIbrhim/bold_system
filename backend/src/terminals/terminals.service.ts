import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { TerminalHeartbeatDto, UpdateTerminalDto } from './dto/terminal.dto';
import { assertBranchAccess } from '../auth/branch-access';

@Injectable()
export class TerminalsService {
  constructor(private prisma: PrismaService) {}

  async heartbeat(dto: TerminalHeartbeatDto, actor: AuthenticatedUser) {
    if (!actor.branch_id) throw new ForbiddenException('POS user must be linked to a branch');
    const existing = await this.prisma.posTerminal.findUnique({ where: { device_id: dto.device_id } });
    if (existing?.is_revoked) throw new ForbiddenException('This POS terminal has been revoked');
    if (existing && existing.branch_id !== actor.branch_id) {
      throw new ConflictException('This POS terminal is registered to another branch');
    }
    const now = new Date();
    const terminal = await this.prisma.posTerminal.upsert({
      where: { device_id: dto.device_id },
      create: {
        device_id: dto.device_id,
        terminal_code: `POS-${dto.device_id.slice(0, 8).toUpperCase()}`,
        name: dto.name?.trim() || `POS ${dto.device_id.slice(0, 8)}`,
        branch_id: actor.branch_id,
        app_version: dto.app_version,
        last_seen_at: now,
        last_sync_at: dto.last_sync_at ? new Date(dto.last_sync_at) : undefined,
        last_sync_status: dto.sync_status || 'never',
        last_error: dto.last_error || null,
        pending_count: dto.pending_count || 0,
      },
      update: {
        ...(dto.name?.trim() ? { name: dto.name.trim() } : {}),
        app_version: dto.app_version,
        last_seen_at: now,
        ...(dto.last_sync_at ? { last_sync_at: new Date(dto.last_sync_at) } : {}),
        ...(dto.sync_status ? { last_sync_status: dto.sync_status } : {}),
        last_error: dto.last_error || null,
        ...(dto.pending_count !== undefined ? { pending_count: dto.pending_count } : {}),
      },
      include: { branch: { select: { code: true, name_ar: true, name_en: true } } },
    });
    return { terminal, online: true, server_time: now.toISOString() };
  }

  async list(actor: AuthenticatedUser) {
    const terminals = await this.prisma.posTerminal.findMany({
      where: actor.role === 'owner' ? {} : { branch_id: actor.branch_id || undefined },
      include: { branch: { select: { code: true, name_ar: true, name_en: true } } },
      orderBy: [{ last_seen_at: 'desc' }, { created_at: 'desc' }],
    });
    const now = Date.now();
    const onlineThreshold = Number(process.env.POS_ONLINE_THRESHOLD_MS || 90000);
    return {
      items: terminals.map((terminal) => ({
        ...terminal,
        online: !terminal.is_revoked && !!terminal.last_seen_at
          && now - terminal.last_seen_at.getTime() <= onlineThreshold,
      })),
      server_time: new Date(now).toISOString(),
      online_threshold_ms: onlineThreshold,
    };
  }

  async update(id: string, dto: UpdateTerminalDto, actor: AuthenticatedUser) {
    const terminal = await this.prisma.posTerminal.findUnique({ where: { id } });
    if (!terminal) throw new NotFoundException('POS terminal not found');
    assertBranchAccess(actor, terminal.branch_id, ['owner']);
    return this.prisma.posTerminal.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.revoked !== undefined ? { is_revoked: dto.revoked } : {}),
      },
    });
  }
}
