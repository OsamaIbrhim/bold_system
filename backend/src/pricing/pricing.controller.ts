import { Body, Controller, Post } from '@nestjs/common';
import { PricingService } from './pricing.service';
@Controller('pricing')
export class PricingController {
  constructor(private pricing: PricingService) {}
  @Post('calculate')
  calculate(@Body() dto: { variant_id: string }) { return this.pricing.calculate(dto.variant_id); }
}
