import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ShiftsService } from './shifts.service';
@Controller('shifts')
export class ShiftsController {
  constructor(private svc: ShiftsService) {}
  // Disabled by default – enable in Settings → Shifts
  @Get() list(@Query('branch_id') branch_id?: string) { return this.svc.list(branch_id); }
  @Get('current') current(@Query('branch_id') branch_id: string) { return this.svc.current(branch_id); }
  @Post('open') open(@Body() dto: { branch_id: string, opened_by: string, opening_cash?: number }) { return this.svc.open(dto.branch_id, dto.opened_by, dto.opening_cash || 0); }
  @Post(':id/close') close(@Param('id') id: string, @Body() dto: { closed_by: string, closing_cash: number }) { return this.svc.close(id, dto.closed_by, dto.closing_cash); }
}
