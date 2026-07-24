import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { ReportsService } from './reports.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RequireCapabilities, Roles } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { resolveBranchScope } from '../auth/branch-access';
@Controller('reports')
@Roles('owner', 'branch_manager')
@RequireCapabilities('reports.read')
export class ReportsController {
  constructor(private svc: ReportsService, private notify: NotificationsService) {}

  @Roles('owner', 'branch_manager', 'warehouse_manager')
  @Get('sales') sales(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('branch_id') branch_id: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.svc.sales(
      from,
      to,
      resolveBranchScope(req.user, branch_id, ['owner', 'warehouse_manager']),
    );
  }
  @Roles('owner', 'branch_manager', 'warehouse_manager')
  @Get('best-sellers') best(
    @Query('branch_id') branch_id: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.svc.bestSellers(
      resolveBranchScope(req.user, branch_id, ['owner', 'warehouse_manager']),
    );
  }
  @Roles('owner', 'branch_manager', 'warehouse_manager')
  @Get('profit-by-item') profitByItem(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('branch_id') branch_id: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.svc.profitByItem(
      from,
      to,
      resolveBranchScope(req.user, branch_id, ['owner', 'warehouse_manager']),
    );
  }
  @Roles('owner', 'branch_manager', 'warehouse_manager')
  @Get('inventory-valuation') inventoryValuation(
    @Query('branch_id') branch_id: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.svc.inventoryValuation(
      resolveBranchScope(req.user, branch_id, ['owner', 'warehouse_manager']),
    );
  }
  @RequireCapabilities('reports.send')
  @Post('send') async send(
    @Body() dto: { from: string, to: string, branch_id?: string, channels: string[] },
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    const report = await this.svc.sales(dto.from, dto.to, resolveBranchScope(req.user, dto.branch_id));
    return this.notify.sendReport(report, dto.channels || ['email']);
  }
}
