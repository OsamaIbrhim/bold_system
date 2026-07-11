import { Body, Controller, Get, Post } from '@nestjs/common';
import { UsersService } from './users.service';
@Controller('users')
export class UsersController {
  constructor(private svc: UsersService) {}
  @Get() list() { return this.svc.findAll(); }
  @Post() create(@Body() dto: any) { return this.svc.create(dto); }
}
