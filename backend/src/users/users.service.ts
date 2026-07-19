import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { CreateUserDto } from './dto/create-user.dto';
@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}
  findAll() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        branch_id: true,
        name: true,
        phone: true,
        email: true,
        role: true,
        is_active: true,
        created_at: true,
      },
      orderBy: { created_at: 'desc' },
    });
  }
  async create(data: CreateUserDto) {
    const { password, ...rest } = data;
    const password_hash = await bcrypt.hash(password, 12);
    return this.prisma.user.create({
      data: { ...rest, password_hash },
      select: {
        id: true,
        branch_id: true,
        name: true,
        phone: true,
        email: true,
        role: true,
        is_active: true,
        created_at: true,
      },
    });
  }
}
