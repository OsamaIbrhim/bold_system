import { Body, Controller, Get, Post } from '@nestjs/common';
import { UsersService } from './users.service';
import { Roles } from '../auth/roles.guard';
import { CreateUserDto } from './dto/create-user.dto';
@Controller('users')
@Roles('owner')
export class UsersController {
  constructor(private svc: UsersService) {}
  @Get() list() { return this.svc.findAll(); }
  @Post() create(@Body() dto: CreateUserDto) { return this.svc.create(dto); }
}
