import { Body, Controller, Post } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
@Controller('notifications')
export class NotificationsController {
  constructor(private svc: NotificationsService) {}
  @Post('send-report') send(@Body() dto: { report: any, channels: string[] }) { return this.svc.sendReport(dto.report, dto.channels); }
}
