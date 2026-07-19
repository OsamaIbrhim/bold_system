import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSupplierDto, UpdateSupplierDto } from './dto/supplier.dto';
@Injectable()
export class SuppliersService {
  constructor(private prisma: PrismaService) {}
  findAll(q?: string) {
    return this.prisma.supplier.findMany({
      where: q ? {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { company_name: { contains: q, mode: 'insensitive' } },
          { alias_names: { has: q } }
        ]
      } : {},
      orderBy: { name: 'asc' }
    });
  }
  findOne(id: string) { return this.prisma.supplier.findUnique({ where: { id }, include: { purchases: { take: 10, orderBy: { created_at: 'desc' } } } }); }
  create(data: CreateSupplierDto) { return this.prisma.supplier.create({ data: { name: data.name, company_name: data.company_name, phone: data.phone, alias_names: data.alias_names || [] }}); }
  update(id: string, data: UpdateSupplierDto) { return this.prisma.supplier.update({ where: { id }, data }); }
  remove(id: string) { return this.prisma.supplier.delete({ where: { id } }); }
  // alias resolver for OCR – "Mohamed Trading Co." -> Supplier Mohamed
  async resolveAlias(name: string) {
    const all = await this.prisma.supplier.findMany()
    return all.find(s => s.name === name || s.company_name === name || s.alias_names.includes(name)) || null
  }
}
