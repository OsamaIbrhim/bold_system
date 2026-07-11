import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { TransfersService } from './transfers.service';
@Controller('transfers')
export class TransfersController {
  constructor(private svc: TransfersService) {}
  @Get() list(@Query('branch_id') branch_id?: string) { return this.svc.list(branch_id); }
  @Get(':id') get(@Param('id') id: string) { return this.svc.get(id); }
  @Post() create(@Body() dto: any) { return this.svc.create(dto); }
  @Post(':id/ship') ship(@Param('id') id: string) { return this.svc.ship(id); }
  @Post(':id/receive') receive(@Param('id') id: string, @Body() dto: { items: { variant_id: string, qty: number }[] }) { return this.svc.receive(id, dto.items); }
}
