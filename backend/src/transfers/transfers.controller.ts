import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { TransfersService } from './transfers.service';
import { Roles } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { resolveBranchScope } from '../auth/branch-access';
import { CreateTransferDto } from './dto/transfer.dto';
@Controller('transfers')
@Roles('owner', 'branch_manager', 'warehouse_manager')
export class TransfersController {
  constructor(private svc: TransfersService) {}
  @Get()
  list(
    @Query('branch_id') branch_id: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.svc.list(resolveBranchScope(req.user, branch_id, ['owner', 'warehouse_manager']));
  }
  @Get(':id') get(@Param('id') id: string, @Req() req: Request & { user: AuthenticatedUser }) {
    return this.svc.get(id, req.user);
  }
  @Post() create(@Body() dto: CreateTransferDto, @Req() req: Request & { user: AuthenticatedUser }) {
    return this.svc.create(dto, req.user);
  }
  @Post(':id/ship') ship(@Param('id') id: string, @Req() req: Request & { user: AuthenticatedUser }) {
    return this.svc.ship(id, req.user);
  }
  @Post(':id/receive') receive(@Param('id') id: string, @Req() req: Request & { user: AuthenticatedUser }) {
    return this.svc.receive(id, req.user);
  }
}
