import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PurchasingService } from './purchasing.service';
@Controller('purchasing')
export class PurchasingController {
  constructor(private svc: PurchasingService) {}
  @Get('invoices') list(@Query('branch_id') branch_id?: string) { return this.svc.list(branch_id); }
  @Get('invoices/:id') get(@Param('id') id: string) { return this.svc.get(id); }
  @Post('receive') receive(@Body() dto: any) { return this.svc.receive(dto); }
  @Post('ocr-import') ocr(@Body() dto: { fileUrl: string }) { return this.svc.ocrImport(dto.fileUrl); }
}
