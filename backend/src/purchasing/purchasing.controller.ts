import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { PurchasingService } from './purchasing.service';
import { RequireCapabilities, Roles } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/authenticated-user';
import {
  assertBranchAccess,
  resolveBranchScope,
} from '../auth/branch-access';
import {
  CreateSupplierReturnDto,
  OcrImportDto,
  ReceivePurchaseDto,
  ReversePurchaseDto,
} from './dto/receive-purchase.dto';

@Controller('purchasing')
@Roles('owner', 'branch_manager', 'warehouse_manager')
@RequireCapabilities('purchasing.read')
export class PurchasingController {
  constructor(private svc: PurchasingService) {}

  @Get('invoices')
  list(
    @Query('branch_id') branch_id: string | undefined,
    @Query('take') take: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.svc.list(
      resolveBranchScope(
        req.user,
        branch_id,
        ['owner', 'warehouse_manager'],
      ),
      Number(take) || 50,
    );
  }

  @Get('invoices/:id')
  async get(
    @Param('id') id: string,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    const invoice = await this.svc.get(id);
    if (!invoice) {
      throw new NotFoundException('Purchase invoice not found');
    }
    assertBranchAccess(
      req.user,
      invoice.branch_id,
      ['owner', 'warehouse_manager'],
    );
    return invoice;
  }

  @RequireCapabilities('purchasing.manage')
  @Post('receive')
  receive(
    @Body() dto: ReceivePurchaseDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    assertBranchAccess(
      req.user,
      dto.branch_id,
      ['owner', 'warehouse_manager'],
    );
    return this.svc.receive(dto, req.user);
  }


  @RequireCapabilities('purchasing.manage')
  @Post('invoices/:id/supplier-returns')
  async returnToSupplier(
    @Param('id') id: string,
    @Body() dto: CreateSupplierReturnDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    const invoice = await this.svc.get(id);
    if (!invoice) {
      throw new NotFoundException('Purchase invoice not found');
    }
    assertBranchAccess(
      req.user,
      invoice.branch_id,
      ['owner', 'warehouse_manager'],
    );
    return this.svc.returnToSupplier(id, dto, req.user);
  }

  @Get('supplier-returns')
  listSupplierReturns(
    @Query('branch_id') branch_id: string | undefined,
    @Query('take') take: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    const branch = resolveBranchScope(
      req.user,
      branch_id,
      ['owner', 'warehouse_manager'],
    );
    return this.svc.listSupplierReturns(
      branch,
      Number(take) || 100,
    );
  }

  @RequireCapabilities('purchasing.manage')
  @Post('invoices/:id/reverse')
  async reverse(
    @Param('id') id: string,
    @Body() dto: ReversePurchaseDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    const invoice = await this.svc.get(id);
    if (!invoice) {
      throw new NotFoundException('Purchase invoice not found');
    }
    assertBranchAccess(
      req.user,
      invoice.branch_id,
      ['owner', 'warehouse_manager'],
    );
    return this.svc.reverse(id, dto, req.user);
  }

  @Get('cost-movements')
  listCostMovements(
    @Query('branch_id') branch_id: string | undefined,
    @Query('variant_id') variant_id: string | undefined,
    @Query('take') take: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    const branch = resolveBranchScope(
      req.user,
      branch_id,
      ['owner', 'warehouse_manager'],
    );
    return this.svc.listCostMovements(
      branch,
      variant_id,
      Number(take) || 100,
    );
  }

  @Roles('owner', 'warehouse_manager')
  @Get('cost-reconciliation')
  costReconciliation(
    @Query('variant_id') variant_id: string | undefined,
  ) {
    return this.svc.costReconciliation(variant_id);
  }

  @RequireCapabilities('purchasing.manage')
  @Post('ocr-import')
  ocr(@Body() dto: OcrImportDto) {
    return this.svc.ocrImport(dto.fileUrl);
  }
}
