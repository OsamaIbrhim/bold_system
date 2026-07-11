import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
@Controller('suppliers')
export class SuppliersController {
  constructor(private svc: SuppliersService) {}
  @Get() list(@Query('q') q?: string) { return this.svc.findAll(q); }
  @Get(':id') get(@Param('id') id: string) { return this.svc.findOne(id); }
  @Post() create(@Body() dto: any) { return this.svc.create(dto); }
  @Patch(':id') update(@Param('id') id: string, @Body() dto: any) { return this.svc.update(id, dto); }
  @Delete(':id') remove(@Param('id') id: string) { return this.svc.remove(id); }
  @Get('resolve/alias')
  resolve(@Query('name') name: string) { return this.svc.resolveAlias(name); }
}
