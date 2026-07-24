import { Body, Controller, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { PricingService } from './pricing.service';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { CalculatePriceDto } from './dto/calculate-price.dto';
import { RequireCapabilities } from '../auth/roles.guard';
@Controller('pricing')
@RequireCapabilities('products.read')
export class PricingController {
  constructor(private pricing: PricingService) {}
  @Post('calculate')
  async calculate(
    @Body() dto: CalculatePriceDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    const quote = await this.pricing.calculate(dto.variant_id);
    if (req.user.role !== 'cashier') return quote;
    return {
      selling_price: quote.selling_price,
      net_price: quote.net_price,
      tax_amount: quote.tax_amount,
      tax_percent: quote.tax_percent,
    };
  }
}
