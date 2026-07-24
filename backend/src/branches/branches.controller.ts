import { Body, Controller, Get, Post } from '@nestjs/common';
import { BranchesService } from './branches.service';
import { RequireCapabilities, Roles } from '../auth/roles.guard';
import { CreateBranchDto } from './dto/create-branch.dto';
@Controller('branches')
@RequireCapabilities('branches.manage')
export class BranchesController {
  constructor(private svc: BranchesService) {}
  @Get() list() { return this.svc.findAll(); }
  @Roles('owner')
  @Post() create(@Body() dto: CreateBranchDto) { return this.svc.create(dto); }
}
