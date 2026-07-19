import { Body, Controller, Get, NotFoundException, Param, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { PurchasingService } from './purchasing.service';
import { Roles } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { assertBranchAccess, resolveBranchScope } from '../auth/branch-access';
import { OcrImportDto, ReceivePurchaseDto } from './dto/receive-purchase.dto';
@Controller('purchasing')
@Roles('owner', 'branch_manager', 'warehouse_manager')
export class PurchasingController {
  constructor(private svc: PurchasingService) {}
  @Get('invoices')
  list(
    @Query('branch_id') branch_id: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.svc.list(resolveBranchScope(req.user, branch_id, ['owner', 'warehouse_manager']));
  }
  @Get('invoices/:id')
  async get(@Param('id') id: string, @Req() req: Request & { user: AuthenticatedUser }) {
    const invoice = await this.svc.get(id);
    if (!invoice) throw new NotFoundException('Purchase invoice not found');
    assertBranchAccess(req.user, invoice.branch_id, ['owner', 'warehouse_manager']);
    return invoice;
  }
  @Post('receive')
  receive(@Body() dto: ReceivePurchaseDto, @Req() req: Request & { user: AuthenticatedUser }) {
    assertBranchAccess(req.user, dto.branch_id, ['owner', 'warehouse_manager']);
    return this.svc.receive(dto, req.user);
  }
  @Post('ocr-import') ocr(@Body() dto: OcrImportDto) { return this.svc.ocrImport(dto.fileUrl); }
}
