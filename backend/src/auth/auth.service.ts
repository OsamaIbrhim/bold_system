import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}
  async login(phone: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { phone }});
    if (!user || !await argon2.verify(user.password_hash, password)) throw new UnauthorizedException('Invalid credentials');
    const payload = { sub: user.id, role: user.role, branch_id: user.branch_id };
    return { access_token: await this.jwt.signAsync(payload), user: { id: user.id, name: user.name, role: user.role }};
  }
  async hash(p: string) { return argon2.hash(p); }
}
