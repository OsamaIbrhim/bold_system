import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { ShiftsService } from './shifts.service';
import { Roles } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { resolveBranchScope } from '../auth/branch-access';
import { CloseShiftDto, OpenShiftDto } from './dto/shift.dto';
@Controller('shifts')
@Roles('owner', 'branch_manager', 'cashier')
export class ShiftsController {
  constructor(private svc: ShiftsService) {}
  // Disabled by default – enable in Settings → Shifts
  @Get()
  list(
    @Query('branch_id') branch_id: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) { return this.svc.list(resolveBranchScope(req.user, branch_id)); }
  @Get('current')
  current(
    @Query('branch_id') branch_id: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    const effectiveBranch = resolveBranchScope(req.user, branch_id);
    return effectiveBranch ? this.svc.current(effectiveBranch) : null;
  }
  @Post('open')
  open(@Body() dto: OpenShiftDto, @Req() req: Request & { user: AuthenticatedUser }) {
    return this.svc.open(dto.branch_id, req.user, dto.opening_cash || 0);
  }
  @Post(':id/close')
  close(
    @Param('id') id: string,
    @Body() dto: CloseShiftDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) { return this.svc.close(id, req.user, dto.closing_cash); }
}
