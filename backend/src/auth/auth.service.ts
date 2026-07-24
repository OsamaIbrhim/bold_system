import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { effectiveCapabilities } from './permissions';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  async login(phone: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user || !user.is_active || !await bcrypt.compare(password, user.password_hash)) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.createSession(user);
  }

  async refresh(refreshToken: string) {
    const tokenHash = this.hashToken(refreshToken);
    return this.prisma.$transaction(async (tx) => {
      const stored = await tx.refreshToken.findUnique({
        where: { token_hash: tokenHash },
        include: { user: true },
      });
      if (!stored || stored.revoked_at || stored.expires_at <= new Date() || !stored.user.is_active) {
        throw new UnauthorizedException('Invalid refresh token');
      }
      const revoked = await tx.refreshToken.updateMany({
        where: { id: stored.id, revoked_at: null },
        data: { revoked_at: new Date() },
      });
      if (revoked.count !== 1) throw new UnauthorizedException('Refresh token was already used');
      return this.createSession(stored.user, tx);
    });
  }

  async logout(refreshToken: string) {
    await this.prisma.refreshToken.updateMany({
      where: { token_hash: this.hashToken(refreshToken), revoked_at: null },
      data: { revoked_at: new Date() },
    });
    return { ok: true };
  }

  async hash(password: string) { return bcrypt.hash(password, 12); }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, name: true, role: true, branch_id: true, is_active: true,
        granted_capabilities: true, revoked_capabilities: true,
      },
    });
    if (!user?.is_active) throw new UnauthorizedException();
    return { ...user, capabilities: effectiveCapabilities(user) };
  }

  private async createSession(user: User, transaction?: Prisma.TransactionClient) {
    const db = transaction || this.prisma;
    const refreshToken = randomBytes(48).toString('base64url');
    await db.refreshToken.create({
      data: {
        user_id: user.id,
        token_hash: this.hashToken(refreshToken),
        expires_at: new Date(Date.now() + this.refreshLifetimeMs()),
      },
    });
    const payload = { sub: user.id, role: user.role, branch_id: user.branch_id };
    return {
      access_token: await this.jwt.signAsync(payload),
      refresh_token: refreshToken,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        branch_id: user.branch_id,
        capabilities: effectiveCapabilities(user),
      },
    };
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private refreshLifetimeMs() {
    const value = process.env.REFRESH_EXPIRES || '30d';
    const match = /^(\d+)([mhd])$/.exec(value);
    if (!match) throw new Error('REFRESH_EXPIRES must use m, h, or d (for example 30d)');
    const amount = Number(match[1]);
    const unit = { m: 60000, h: 3600000, d: 86400000 }[match[2]];
    return amount * unit;
  }
}
