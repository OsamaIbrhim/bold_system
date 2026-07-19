import { BadRequestException, Controller, Get, Headers, NotImplementedException, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { SyncService } from './sync.service';
import { Roles } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { resolveBranchScope } from '../auth/branch-access';
import { TerminalsService } from '../terminals/terminals.service';
@Controller('sync')
@Roles('owner', 'branch_manager', 'cashier')
export class SyncController {
  constructor(private svc: SyncService, private terminals: TerminalsService) {}
  @Post('push') push() {
    throw new NotImplementedException('Batch push is disabled; use the idempotent command endpoints');
  }
  @Get('pull')
  async pull(
    @Query('branch_id') branch_id: string,
    @Query('cursor') cursor: string | undefined,
    @Headers('x-pos-device-id') deviceId: string | undefined,
    @Headers('x-pos-device-token') deviceToken: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    const effectiveBranch = resolveBranchScope(req.user, branch_id);
    if (!effectiveBranch) throw new BadRequestException('branch_id is required');
    // Owners may call this endpoint for support/performance diagnostics. Every
    // branch-bound POS user must also prove that the physical till is enrolled.
    if (req.user.role !== 'owner') await this.terminals.authenticate(deviceId, deviceToken, req.user);
    return this.svc.pull(effectiveBranch, cursor);
  }
}
