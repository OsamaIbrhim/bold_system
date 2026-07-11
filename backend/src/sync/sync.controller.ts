import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { SyncService } from './sync.service';
@Controller('sync')
export class SyncController {
  constructor(private svc: SyncService) {}
  @Post('push') push(@Body() dto: { batch: any[] }) { return this.svc.push(dto.batch); }
  @Get('pull') pull(@Query('since') since: string, @Query('branch_id') branch_id: string) { return this.svc.pull(since, branch_id); }
}
