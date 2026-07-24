import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { UsersService } from './users.service';
import { RequireCapabilities } from '../auth/roles.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserPermissionsDto } from './dto/update-user-permissions.dto';
import { AuthenticatedUser } from '../auth/authenticated-user';
@Controller('users')
@RequireCapabilities('users.manage')
export class UsersController {
  constructor(private svc: UsersService) {}
  @Get() list(@Req() req: Request & { user: AuthenticatedUser }) {
    return this.svc.findAll(req.user);
  }
  @Post() create(
    @Body() dto: CreateUserDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.svc.create(dto, req.user);
  }
  @Patch(':id/permissions') updatePermissions(
    @Param('id') id: string,
    @Body() dto: UpdateUserPermissionsDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.svc.updatePermissions(id, dto, req.user);
  }
}
