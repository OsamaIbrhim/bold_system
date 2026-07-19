import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { Roles } from '../auth/roles.guard';
import { CreateSupplierDto, UpdateSupplierDto } from './dto/supplier.dto';
@Controller('suppliers')
@Roles('owner', 'branch_manager', 'warehouse_manager')
export class SuppliersController {
  constructor(private svc: SuppliersService) {}
  @Get() list(@Query('q') q?: string) { return this.svc.findAll(q); }
  @Get('resolve/alias')
  resolve(@Query('name') name: string) { return this.svc.resolveAlias(name); }
  @Get(':id') get(@Param('id') id: string) { return this.svc.findOne(id); }
  @Post() create(@Body() dto: CreateSupplierDto) { return this.svc.create(dto); }
  @Patch(':id') update(@Param('id') id: string, @Body() dto: UpdateSupplierDto) { return this.svc.update(id, dto); }
  @Delete(':id') remove(@Param('id') id: string) { return this.svc.remove(id); }
}
