import { Controller, Get, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { InventoryService } from './inventory.service';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { RequireCapabilities, Roles } from '../auth/roles.guard';
import { resolveBranchScope } from '../auth/branch-access';

@Controller('inventory')
@RequireCapabilities('inventory.read')
export class InventoryController {
  constructor(private svc: InventoryService) {}

  @Get('lookup')
  lookup(
    @Query('variant_id') variant_id: string,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    const canSeeAllBranches = ['owner', 'warehouse_manager'].includes(
      req.user.role,
    );
    return this.svc.lookup(
      variant_id,
      canSeeAllBranches ? undefined : req.user.branch_id || undefined,
    );
  }

  @Get('movements')
  @Roles('owner', 'warehouse_manager', 'branch_manager')
  movements(
    @Query('variant_id') variant_id: string,
    @Query('branch_id') branch_id: string | undefined,
    @Query('take') take: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    const effectiveBranch = resolveBranchScope(
      req.user,
      branch_id,
      ['owner', 'warehouse_manager'],
    );
    const parsedTake = Number(take || 100);
    return this.svc.movements(
      variant_id,
      effectiveBranch,
      Number.isInteger(parsedTake) ? parsedTake : 100,
    );
  }

  @Get('reconciliation')
  @Roles('owner', 'warehouse_manager')
  reconciliation(
    @Query('branch_id') branch_id: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.svc.reconcile(
      resolveBranchScope(
        req.user,
        branch_id,
        ['owner', 'warehouse_manager'],
      ),
    );
  }
}
