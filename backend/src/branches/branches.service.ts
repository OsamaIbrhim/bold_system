import { Injectable, InternalServerErrorException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBranchDto } from './dto/create-branch.dto';

@Injectable()
export class BranchesService {
  private readonly logger = new Logger(BranchesService.name);

  constructor(private prisma: PrismaService) {}

  async findAll() {
    try {
      return await this.prisma.branch.findMany({ where: { is_active: true } });
    } catch (error) {
      this.logger.error('Failed to fetch branches', error instanceof Error ? error.stack : error);
      throw new InternalServerErrorException('Failed to fetch branches');
    }
  }

  async create(data: CreateBranchDto) {
    try {
      return await this.prisma.branch.create({ data });
    } catch (error: any) {
      this.logger.error('Failed to create branch', error instanceof Error ? error.stack : error);
      
      if (error?.code === 'P2002') {
        throw new ConflictException('A branch with this ID already exists');
      }

      throw new InternalServerErrorException('Failed to create branch');
    }
  }
}
