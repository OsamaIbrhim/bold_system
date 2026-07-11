import { Body, Controller, Get, Post } from '@nestjs/common';
import { BranchesService } from './branches.service';
@Controller('branches')
export class BranchesController {
  constructor(private svc: BranchesService) {}
  @Get() list() { return this.svc.findAll(); }
  @Post() create(@Body() dto: any) { return this.svc.create(dto); }
}
