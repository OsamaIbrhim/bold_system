import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { NotificationsService } from '../notifications/notifications.service';
@Controller('reports')
export class ReportsController {
  constructor(private svc: ReportsService, private notify: NotificationsService) {}
  @Get('sales') sales(@Query('from') from: string, @Query('to') to: string, @Query('branch_id') branch_id?: string) {
    return this.svc.sales(from, to, branch_id);
  }
  @Get('best-sellers') best(@Query('branch_id') branch_id?: string) { return this.svc.bestSellers(branch_id); }
  @Post('send') async send(@Body() dto: { from: string, to: string, branch_id?: string, channels: string[] }) {
    const report = await this.svc.sales(dto.from, dto.to, dto.branch_id);
    return this.notify.sendReport(report, dto.channels || ['email']);
  }
}
