import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Post, Query, Res, Header, Req } from '@nestjs/common';
import { Request, Response } from 'express';
import { SalesService } from './sales.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { PrismaService } from '../prisma/prisma.service';
import { Roles } from '../auth/roles.guard';
import { CreateSaleDto } from './dto/create-sale.dto';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { CreateReturnDto } from './dto/create-return.dto';

@Controller()
export class SalesController {
  constructor(
    private svc: SalesService,
    private pdfService: InvoicePdfService,
    private prisma: PrismaService
  ) {}

  @Roles('owner', 'branch_manager', 'cashier')
  @Post('pos/sale')
  sale(@Body() dto: CreateSaleDto, @Req() req: Request & { user: AuthenticatedUser }) {
    return this.svc.createSale(dto, req.user);
  }
  @Roles('owner', 'branch_manager', 'cashier')
  @Post('pos/return')
  ret(@Body() dto: CreateReturnDto, @Req() req: Request & { user: AuthenticatedUser }) {
    return this.svc.createReturn(dto, req.user);
  }

  @Roles('owner', 'branch_manager', 'cashier')
  @Get('pos/invoices/lookup')
  lookupInvoice(
    @Query('reference') reference: string,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    if (!reference?.trim()) throw new BadRequestException('reference is required');
    return this.svc.findReturnableInvoice(reference.trim(), req.user);
  }

  @Get('sales/:id/pdf')
  @Roles('owner', 'branch_manager', 'cashier')
  @Header('Content-Type', 'application/pdf')
  async getPdf(
    @Param('id') id: string,
    @Query('lang') lang: 'ar'|'en' = 'ar',
    @Req() req: Request & { user: AuthenticatedUser },
    @Res() res: Response,
  ) {
    const invoice = await this.prisma.salesInvoice.findUnique({
      where: { id },
      include: { items: { include: { variant: { include: { product: true }}}}, branch: true, customer: true }
    });
    if (!invoice) { res.status(404).send('Not found'); return; }
    if (req.user.role !== 'owner' && req.user.branch_id !== invoice.branch_id) {
      throw new ForbiddenException('You cannot access an invoice from another branch');
    }
    const buf = await this.pdfService.render(invoice, lang);
    res.set({ 'Content-Disposition': `inline; filename="bold-${invoice.invoice_number}-${lang}.pdf"` });
    res.send(buf);
  }
}
