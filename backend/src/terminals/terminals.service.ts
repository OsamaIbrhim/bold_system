import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/authenticated-user';
import {
  CreateTerminalEnrollmentDto,
  EnrollTerminalDto,
  TerminalHeartbeatDto,
  UpdateTerminalDto,
} from './dto/terminal.dto';
import { assertBranchAccess } from '../auth/branch-access';

@Injectable()
export class TerminalsService {
  constructor(private prisma: PrismaService) {}

  async createEnrollment(dto: CreateTerminalEnrollmentDto, actor: AuthenticatedUser) {
    const branchId = actor.role === 'owner' ? dto.branch_id || actor.branch_id : actor.branch_id;
    if (!branchId) throw new BadRequestException('branch_id is required for terminal enrollment');
    if (actor.role !== 'owner' && dto.branch_id && dto.branch_id !== actor.branch_id) {
      throw new ForbiddenException('You cannot enroll a terminal for another branch');
    }
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, is_active: true } });
    if (!branch) throw new NotFoundException('Active branch not found');

    const code = randomBytes(9).toString('base64url').toUpperCase();
    const expiresAt = new Date(Date.now() + Number(process.env.POS_ENROLLMENT_TTL_MS || 10 * 60 * 1000));
    await this.prisma.posTerminalEnrollment.create({
      data: {
        code_hash: this.hash(code),
        branch_id: branchId,
        terminal_name: dto.name?.trim() || null,
        created_by: actor.sub,
        expires_at: expiresAt,
      },
    });
    return {
      enrollment_code: code,
      expires_at: expiresAt.toISOString(),
      branch: { id: branch.id, code: branch.code, name_ar: branch.name_ar, name_en: branch.name_en },
    };
  }

  async enroll(dto: EnrollTerminalDto) {
    const codeHash = this.hash(dto.enrollment_code.trim().toUpperCase());
    const enrollment = await this.prisma.posTerminalEnrollment.findUnique({
      where: { code_hash: codeHash },
      include: { branch: true },
    });
    if (!enrollment || enrollment.used_at || enrollment.expires_at <= new Date()) {
      throw new UnauthorizedException('Enrollment code is invalid or expired');
    }
    const existing = await this.prisma.posTerminal.findUnique({ where: { device_id: dto.device_id } });
    if (existing?.is_revoked) throw new ForbiddenException('This POS terminal has been revoked');
    if (existing && existing.branch_id !== enrollment.branch_id) {
      throw new ConflictException('This POS terminal is registered to another branch');
    }

    const deviceToken = randomBytes(48).toString('base64url');
    const now = new Date();
    const terminal = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.posTerminalEnrollment.updateMany({
        where: { id: enrollment.id, used_at: null, expires_at: { gt: now } },
        data: { used_at: now },
      });
      if (claimed.count !== 1) throw new UnauthorizedException('Enrollment code was already used');
      return tx.posTerminal.upsert({
        where: { device_id: dto.device_id },
        create: {
          device_id: dto.device_id,
          terminal_code: `POS-${dto.device_id.slice(0, 8).toUpperCase()}`,
          name: dto.name?.trim() || enrollment.terminal_name || `POS ${dto.device_id.slice(0, 8)}`,
          branch_id: enrollment.branch_id,
          app_version: dto.app_version,
          device_token_hash: this.hash(deviceToken),
          enrolled_by: enrollment.created_by,
          enrolled_at: now,
        },
        update: {
          name: dto.name?.trim() || enrollment.terminal_name || existing?.name,
          app_version: dto.app_version,
          device_token_hash: this.hash(deviceToken),
          enrolled_by: enrollment.created_by,
          enrolled_at: now,
        },
        include: { branch: { select: { id: true, code: true, name_ar: true, name_en: true } } },
      });
    });
    return {
      terminal: {
        id: terminal.id,
        device_id: terminal.device_id,
        terminal_code: terminal.terminal_code,
        name: terminal.name,
        branch: terminal.branch,
      },
      device_token: deviceToken,
    };
  }

  async heartbeat(dto: TerminalHeartbeatDto, deviceToken: string | undefined, actor: AuthenticatedUser) {
    const existing = await this.authenticate(dto.device_id, deviceToken, actor);
    const now = new Date();
    const terminal = await this.prisma.posTerminal.update({
      where: { id: existing.id },
      data: {
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

  async authenticate(deviceId: string | undefined, deviceToken: string | undefined, actor: AuthenticatedUser) {
    if (!actor.branch_id) throw new ForbiddenException('POS user must be linked to a branch');
    if (!deviceId) throw new UnauthorizedException('This POS terminal must be enrolled before use');
    const existing = await this.prisma.posTerminal.findUnique({ where: { device_id: deviceId } });
    if (!existing || !existing.device_token_hash) {
      throw new UnauthorizedException('This POS terminal must be enrolled before use');
    }
    if (!deviceToken || !this.matches(deviceToken, existing.device_token_hash)) {
      throw new UnauthorizedException('Invalid POS terminal credential');
    }
    if (existing.is_revoked) throw new ForbiddenException('This POS terminal has been revoked');
    if (existing.branch_id !== actor.branch_id) {
      throw new ConflictException('This POS terminal is registered to another branch');
    }
    return existing;
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
        device_token_hash: undefined,
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
        // Revocation also invalidates the device credential. Re-enabling a
        // terminal therefore requires a new manager-issued enrollment code.
        ...(dto.revoked === true ? { device_token_hash: null } : {}),
      },
    });
  }

  private hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private matches(token: string, expectedHash: string) {
    const actual = Buffer.from(this.hash(token));
    const expected = Buffer.from(expectedHash);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}
