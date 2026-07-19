import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { Roles } from '../auth/roles.guard';
import { CreateCustomerDto, SetCustomerVipDto, UpdateCustomerDto } from './dto/customer.dto';
@Controller('customers')
export class CustomersController {
  constructor(private svc: CustomersService) {}
  @Get() list(@Query('q') q?: string) { return q && q.startsWith('01') ? this.svc.searchByPhone(q) : this.svc.findAll(q); }
  @Get('lookup') byPhone(@Query('phone') phone: string) { return this.svc.searchByPhone(phone); }
  @Get('loyalty') loyalty(@Query('phone') phone: string) { return this.svc.loyaltyStatus(phone); }
  @Get(':id') get(@Param('id') id: string) { return this.svc.findOne(id); }
  @Post() create(@Body() dto: CreateCustomerDto) { return this.svc.create(dto); }
  @Roles('owner', 'branch_manager')
  @Patch(':id') update(@Param('id') id: string, @Body() dto: UpdateCustomerDto) { return this.svc.update(id, dto); }
  @Roles('owner', 'branch_manager')
  @Post(':id/vip') setVip(@Param('id') id: string, @Body() dto: SetCustomerVipDto) { return this.svc.setVip(id, dto.is_vip, dto.vip_price_tier); }
  @Roles('owner', 'branch_manager')
  @Delete(':id') remove(@Param('id') id: string) { return this.svc.remove(id); }
}
