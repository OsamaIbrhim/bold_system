import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { NotificationsModule } from '../notifications/notifications.module';
@Module({ imports: [NotificationsModule], providers: [ReportsService], controllers: [ReportsController] })
export class ReportsModule {}
