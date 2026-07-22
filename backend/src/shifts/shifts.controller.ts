import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { ShiftsService } from './shifts.service';
import { Roles } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { resolveBranchScope } from '../auth/branch-access';
import { CloseShiftDto, OpenShiftDto } from './dto/shift.dto';
import { TerminalsService } from '../terminals/terminals.service';

@Controller('shifts')
@Roles('owner', 'branch_manager', 'cashier')
export class ShiftsController {
  constructor(
    private svc: ShiftsService,
    private terminals: TerminalsService,
  ) {}

  @Get()
  list(
    @Query('branch_id') branch_id: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.svc.list(resolveBranchScope(req.user, branch_id));
  }

  @Get('current')
  current(
    @Query('branch_id') branch_id: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    const effectiveBranch = resolveBranchScope(req.user, branch_id);
    return effectiveBranch ? this.svc.current(effectiveBranch) : null;
  }

  @Post('open')
  open(
    @Body() dto: OpenShiftDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.svc.open(dto.branch_id, req.user, dto.opening_cash || 0);
  }

  @Post(':id/offline-context')
  @Roles('branch_manager', 'cashier')
  async offlineContext(
    @Param('id') id: string,
    @Headers('x-pos-device-id') deviceId: string | undefined,
    @Headers('x-pos-device-token') deviceToken: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    const terminal = await this.terminals.authenticate(
      deviceId,
      deviceToken,
      req.user,
    );
    return this.svc.issueOfflineContext(id, req.user, terminal);
  }

  @Post(':id/close')
  close(
    @Param('id') id: string,
    @Body() dto: CloseShiftDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.svc.close(id, req.user, dto.closing_cash);
  }
}
