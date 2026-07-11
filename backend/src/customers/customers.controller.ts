import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CustomersService } from './customers.service';
@Controller('customers')
export class CustomersController {
  constructor(private svc: CustomersService) {}
  @Get() list(@Query('q') q?: string) { return q && q.startsWith('01') ? this.svc.searchByPhone(q) : this.svc.findAll(q); }
  @Get('lookup') byPhone(@Query('phone') phone: string) { return this.svc.searchByPhone(phone); }
  @Get('loyalty') loyalty(@Query('phone') phone: string) { return this.svc.loyaltyStatus(phone); }
  @Get(':id') get(@Param('id') id: string) { return this.svc.findOne(id); }
  @Post() create(@Body() dto: any) { return this.svc.create(dto); }
  @Patch(':id') update(@Param('id') id: string, @Body() dto: any) { return this.svc.update(id, dto); }
  @Post(':id/vip') setVip(@Param('id') id: string, @Body() dto: { is_vip: boolean, vip_price_tier?: string }) { return this.svc.setVip(id, dto.is_vip, dto.vip_price_tier); }
  @Delete(':id') remove(@Param('id') id: string) { return this.svc.remove(id); }
}
