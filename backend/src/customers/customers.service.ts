import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';
@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}
  findAll(q?: string, take = 50) {
    return this.prisma.customer.findMany({
      where: q ? { OR: [
        { phone: { contains: q }},
        { name: { contains: q, mode: 'insensitive' }},
        { email: { contains: q, mode: 'insensitive' }}
      ]} : {},
      take, orderBy: { total_spent: 'desc' }
    });
  }
  findOne(id: string) {
    return this.prisma.customer.findUnique({ 
      where: { id },
      include: { sales: { take: 20, orderBy: { created_at: 'desc' }}} 
    });
  }
  searchByPhone(phone: string) { return this.prisma.customer.findUnique({ where: { phone }}); }
  create(data: CreateCustomerDto) { return this.prisma.customer.create({ data }); }
  update(id: string, data: UpdateCustomerDto) { return this.prisma.customer.update({ where: { id }, data }); }
  setVip(id: string, is_vip: boolean, vip_price_tier = 'cost_plus_overhead') {
    return this.prisma.customer.update({ where: { id }, data: { is_vip, vip_price_tier }});
  }
  async loyaltyStatus(phone: string) {
    const c = await this.prisma.customer.findUnique({ where: { phone }});
    if (!c) return { eligible: false };
    // Example rule: 5+ invoices OR 2000+ EGP spent
    const eligible = c.total_invoices >= 5 || Number(c.total_spent) >= 2000;
    return { eligible, total_invoices: c.total_invoices, total_spent: c.total_spent, customer: c };
  }
  remove(id: string) { return this.prisma.customer.delete({ where: { id }}); }
}
