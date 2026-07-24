import { Controller, Get, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { SellersService } from './sellers.service';
import { RequireCapabilities } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { resolveBranchScope } from '../auth/branch-access';

@Controller('sellers')
export class SellersController {
  constructor(private service: SellersService) {}

  @Get('report')
  @RequireCapabilities('seller_reports.read')
  report(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('branch_id') branchId: string | undefined,
    @Query('seller_id') sellerId: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.service.report(
      from,
      to,
      resolveBranchScope(req.user, branchId, ['owner']),
      sellerId,
    );
  }
}
