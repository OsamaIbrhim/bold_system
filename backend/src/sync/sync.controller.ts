import { BadRequestException, Controller, Get, NotImplementedException, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { SyncService } from './sync.service';
import { Roles } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { resolveBranchScope } from '../auth/branch-access';
@Controller('sync')
@Roles('owner', 'branch_manager', 'cashier')
export class SyncController {
  constructor(private svc: SyncService) {}
  @Post('push') push() {
    throw new NotImplementedException('Batch push is disabled; use the idempotent command endpoints');
  }
  @Get('pull')
  pull(
    @Query('branch_id') branch_id: string,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    const effectiveBranch = resolveBranchScope(req.user, branch_id);
    if (!effectiveBranch) throw new BadRequestException('branch_id is required');
    return this.svc.pull(effectiveBranch);
  }
}
