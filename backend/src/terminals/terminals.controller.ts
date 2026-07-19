import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { Roles } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { TerminalHeartbeatDto, UpdateTerminalDto } from './dto/terminal.dto';
import { TerminalsService } from './terminals.service';

@Controller('terminals')
export class TerminalsController {
  constructor(private service: TerminalsService) {}

  @Roles('owner', 'branch_manager', 'cashier')
  @Post('heartbeat')
  heartbeat(
    @Body() dto: TerminalHeartbeatDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.service.heartbeat(dto, req.user);
  }

  @Roles('owner', 'branch_manager')
  @Get()
  list(@Req() req: Request & { user: AuthenticatedUser }) {
    return this.service.list(req.user);
  }

  @Roles('owner', 'branch_manager')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTerminalDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.service.update(id, dto, req.user);
  }
}
