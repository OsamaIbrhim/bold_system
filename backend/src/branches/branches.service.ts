import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBranchDto } from './dto/create-branch.dto';
@Injectable()
export class BranchesService {
  constructor(private prisma: PrismaService) {}
  findAll() { return this.prisma.branch.findMany({ where: { is_active: true } }); }
  create(data: CreateBranchDto) { return this.prisma.branch.create({ data }); }
}
