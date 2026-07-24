import { Body, Controller, Get, Param, Patch, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { SellersService } from './sellers.service';
import { RequireCapabilities } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { resolveBranchScope } from '../auth/branch-access';
import {
  UpdateCommissionSettingsDto,
  UpdateSellerCommissionDto,
} from './dto/commission-settings.dto';

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

  @Get('commission-settings')
  @RequireCapabilities('seller_reports.read')
  settings(@Req() req: Request & { user: AuthenticatedUser }) {
    return this.service.settings(req.user);
  }

  @Patch('commission-settings')
  @RequireCapabilities('seller_settings.manage')
  updateSettings(
    @Body() dto: UpdateCommissionSettingsDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.service.updateSettings(dto, req.user);
  }

  @Patch(':id/commission-settings')
  @RequireCapabilities('seller_settings.manage')
  updateSellerSettings(
    @Param('id') sellerId: string,
    @Body() dto: UpdateSellerCommissionDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.service.updateSellerSettings(sellerId, dto, req.user);
  }
}
