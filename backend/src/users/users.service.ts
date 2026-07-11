import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as argon2 from 'argon2';
@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}
  findAll() { return this.prisma.user.findMany(); }
  async create(data: any) {
    const { password, ...rest } = data;
    const password_hash = await argon2.hash(password);
    return this.prisma.user.create({ data: { ...rest, password_hash }});
  }
}
