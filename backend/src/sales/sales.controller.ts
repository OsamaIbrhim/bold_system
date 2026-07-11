import { Body, Controller, Get, Param, Post, Query, Res, Header } from '@nestjs/common';
import { Response } from 'express';
import { SalesService } from './sales.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller()
export class SalesController {
  constructor(
    private svc: SalesService,
    private pdfService: InvoicePdfService,
    private prisma: PrismaService
  ) {}

  @Post('pos/sale') sale(@Body() dto: any) { return this.svc.createSale(dto); }
  @Post('pos/return') ret(@Body() dto: { original_invoice_id: string, items: any[], created_by: string }) {
    return this.svc.createReturn(dto.original_invoice_id, dto.items, dto.created_by);
  }

  @Get('sales/:id/pdf')
  @Header('Content-Type', 'application/pdf')
  async getPdf(@Param('id') id: string, @Query('lang') lang: 'ar'|'en' = 'ar', @Res() res: Response) {
    const invoice = await this.prisma.salesInvoice.findUnique({
      where: { id },
      include: { items: { include: { variant: { include: { product: true }}}}, branch: true, customer: true }
    });
    if (!invoice) { res.status(404).send('Not found'); return; }
    const buf = await this.pdfService.render(invoice, lang);
    res.set({ 'Content-Disposition': `inline; filename="bold-${invoice.invoice_number}-${lang}.pdf"` });
    res.send(buf);
  }
}
