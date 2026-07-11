import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
@Injectable()
export class ShiftsService {
  // Shift module is built-in but disabled by default – enable via Settings
  // Provides: open shift, close shift with cash count, variance report
  constructor(private prisma: PrismaService) {}
  async open(branch_id: string, opened_by: string, opening_cash = 0) {
    const existing = await this.prisma.shift.findFirst({ where: { branch_id, status: 'open' }});
    if (existing) return existing; // one open shift per branch
    return this.prisma.shift.create({ data: { branch_id, opened_by, opening_cash, status: 'open' }});
  }
  async close(id: string, closed_by: string, closing_cash: number) {
    const shift = await this.prisma.shift.findUnique({ where: { id }});
    if (!shift || shift.status === 'closed') throw new Error('Shift not open');
    // expected_cash = opening_cash + sales_total during shift – simplified for now
    const expected_cash = Number(shift.opening_cash);
    const difference = closing_cash - expected_cash;
    return this.prisma.shift.update({
      where: { id },
      data: { closed_by, closing_cash, expected_cash, difference, closed_at: new Date(), status: 'closed' }
    });
  }
  list(branch_id?: string) {
    return this.prisma.shift.findMany({
      where: branch_id ? { branch_id } : {},
      orderBy: { opened_at: 'desc' },
      take: 50
    });
  }
  current(branch_id: string) {
    return this.prisma.shift.findFirst({ where: { branch_id, status: 'open' }});
  }
}
