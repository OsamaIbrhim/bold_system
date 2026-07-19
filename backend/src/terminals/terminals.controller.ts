import { Body, Controller, Get, Headers, Param, Patch, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { Roles } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { CreateTerminalEnrollmentDto, EnrollTerminalDto, TerminalHeartbeatDto, UpdateTerminalDto } from './dto/terminal.dto';
import { TerminalsService } from './terminals.service';
import { Public } from '../auth/public.decorator';

@Controller('terminals')
export class TerminalsController {
  constructor(private service: TerminalsService) {}

  @Roles('owner', 'branch_manager')
  @Post('enrollment-codes')
  createEnrollment(
    @Body() dto: CreateTerminalEnrollmentDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.service.createEnrollment(dto, req.user);
  }

  @Public()
  @Post('enroll')
  enroll(@Body() dto: EnrollTerminalDto) {
    return this.service.enroll(dto);
  }

  @Roles('branch_manager', 'cashier')
  @Post('heartbeat')
  heartbeat(
    @Body() dto: TerminalHeartbeatDto,
    @Headers('x-pos-device-token') deviceToken: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.service.heartbeat(dto, deviceToken, req.user);
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
