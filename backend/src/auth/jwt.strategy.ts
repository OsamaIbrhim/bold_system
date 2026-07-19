import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { getJwtSecret } from './jwt.config';
import { PrismaService } from '../prisma/prisma.service';
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: getJwtSecret()
    });
  }
  async validate(payload: { sub?: string }) {
    if (!payload.sub) throw new UnauthorizedException();
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, branch_id: true, is_active: true },
    });
    if (!user?.is_active) throw new UnauthorizedException();
    // Rehydrate authorization data on every request so role, branch, and active
    // state changes take effect immediately rather than waiting for token expiry.
    return { sub: user.id, role: user.role, branch_id: user.branch_id };
  }
}
