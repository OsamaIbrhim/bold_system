import { Controller, Get, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { InventoryService } from './inventory.service';
import { AuthenticatedUser } from '../auth/authenticated-user';
@Controller('inventory')
export class InventoryController {
  constructor(private svc: InventoryService) {}
  @Get('lookup')
  lookup(
    @Query('variant_id') variant_id: string,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    const canSeeAllBranches = ['owner', 'warehouse_manager'].includes(req.user.role);
    return this.svc.lookup(variant_id, canSeeAllBranches ? undefined : req.user.branch_id || undefined);
  }
}
