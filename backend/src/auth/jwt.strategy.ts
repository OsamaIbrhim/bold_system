import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { getJwtSecret } from './jwt.config';
import { PrismaService } from '../prisma/prisma.service';

type EffectiveUser = { sub: string; role: string; branch_id: string | null };

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly cache = new Map<string, { expiresAt: number; user: EffectiveUser }>();
  private readonly inFlight = new Map<string, Promise<EffectiveUser>>();

  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: getJwtSecret()
    });
  }
  async validate(payload: { sub?: string }) {
    if (!payload.sub) throw new UnauthorizedException();
    const now = Date.now();
    const cached = this.cache.get(payload.sub);
    if (cached && cached.expiresAt > now) return cached.user;

    let lookup = this.inFlight.get(payload.sub);
    if (!lookup) {
      lookup = this.loadEffectiveUser(payload.sub);
      this.inFlight.set(payload.sub, lookup);
    }
    try {
      const user = await lookup;
      const ttl = Math.min(5_000, Math.max(0, Number(process.env.AUTH_RECHECK_TTL_MS || 1_000)));
      if (ttl > 0) {
        if (this.cache.size >= 1_000) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(payload.sub, { expiresAt: Date.now() + ttl, user });
      }
      return user;
    } finally {
      if (this.inFlight.get(payload.sub) === lookup) this.inFlight.delete(payload.sub);
    }
  }

  private async loadEffectiveUser(userId: string): Promise<EffectiveUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, branch_id: true, is_active: true },
    });
    if (!user?.is_active) throw new UnauthorizedException();
    // The very short cache coalesces bursts from one logged-in user while role,
    // branch, disable, and revocation changes still take effect within 1 second.
    return { sub: user.id, role: user.role, branch_id: user.branch_id };
  }
}
