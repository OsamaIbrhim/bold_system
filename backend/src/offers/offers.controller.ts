import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { OffersService } from './offers.service';
@Controller('offers')
export class OffersController {
  constructor(private svc: OffersService) {}
  @Get('suggestions') list(@Query('branch_id') branch_id?: string) { return this.svc.suggestions(branch_id); }
  @Post(':id/review') review(@Param('id') id: string, @Body() dto: any) { return this.svc.review(id, dto.status, dto.reviewed_by); }
}
