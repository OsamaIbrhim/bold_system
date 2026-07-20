import { BadRequestException, Body, Controller, Get, Param, Post, Query, Res, Header, Headers, Req } from '@nestjs/common';
import { Request, Response } from 'express';
import { SalesService } from './sales.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { Roles } from '../auth/roles.guard';
import { CreateSaleDto } from './dto/create-sale.dto';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { CreateReturnDto } from './dto/create-return.dto';
import { ListSalesDto } from './dto/list-sales.dto';
import { resolveBranchScope } from '../auth/branch-access';
import { TerminalsService } from '../terminals/terminals.service';
import { ListReturnsDto } from './dto/list-returns.dto'

@Controller()
export class SalesController {
  constructor(
    private svc: SalesService,
    private pdfService: InvoicePdfService,
    private terminals: TerminalsService,
  ) { }

  @Roles('owner', 'branch_manager')
  @Get('sales')
  listSales(
    @Query() dto: ListSalesDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    const branchId = resolveBranchScope(req.user, dto.branch_id, ['owner']);
    return this.svc.listSales(dto, branchId);
  }

  @Roles('owner', 'branch_manager')
  @Get('sales/:id')
  getSale(
    @Param('id') id: string,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.svc.getInvoice(id, req.user);
  }

  @Roles('branch_manager', 'cashier')
  @Post('pos/sale')
  async sale(
    @Body() dto: CreateSaleDto,
    @Headers('x-pos-device-id') deviceId: string | undefined,
    @Headers('x-pos-device-token') deviceToken: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    const terminal = await this.terminals.authenticate(deviceId, deviceToken, req.user);
    return this.svc.createSale(dto, req.user, terminal.id);
  }
  @Roles('owner', 'branch_manager', 'cashier')
  @Post('pos/return')
  async ret(
    @Body() dto: CreateReturnDto,
    @Headers('x-pos-device-id') deviceId: string | undefined,
    @Headers('x-pos-device-token') deviceToken: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    if (req.user.role !== 'owner') await this.terminals.authenticate(deviceId, deviceToken, req.user);
    return this.svc.createReturn(dto, req.user);
  }

  @Roles('owner', 'branch_manager', 'cashier')
  @Get('pos/invoices/lookup')
  async lookupInvoice(
    @Query('reference') reference: string,
    @Headers('x-pos-device-id') deviceId: string | undefined,
    @Headers('x-pos-device-token') deviceToken: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    if (!reference?.trim()) throw new BadRequestException('reference is required');
    if (req.user.role !== 'owner') await this.terminals.authenticate(deviceId, deviceToken, req.user);
    return this.svc.findReturnableInvoice(reference.trim(), req.user);
  }

  @Get('sales/:id/pdf')
  @Roles('owner', 'branch_manager', 'cashier')
  @Header('Content-Type', 'application/pdf')
  async getPdf(
    @Param('id') id: string,
    @Query('lang') lang: 'ar' | 'en' = 'ar',
    @Req() req: Request & { user: AuthenticatedUser },
    @Res() res: Response,
  ) {
    const invoice = await this.svc.getInvoice(id, req.user);
    const buf = await this.pdfService.render(invoice, lang);
    res.set({ 'Content-Disposition': `inline; filename="bold-${invoice.invoice_number}-${lang}.pdf"` });
    res.send(buf);
  }

  @Roles('owner', 'branch_manager')
  @Get('returns')
  listReturns(
    @Query() dto: ListReturnsDto,
    @Req() req: Request & {
      user: AuthenticatedUser
    },
  ) {
    const branchId = resolveBranchScope(
      req.user,
      dto.branch_id,
      ['owner'],
    )

    return this.svc.listReturns(
      dto,
      branchId,
    )
  }
}
