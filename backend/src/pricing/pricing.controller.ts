import { Body, Controller, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { PricingService } from './pricing.service';
import { CostVisibilityService } from './cost-visibility.service';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { CalculatePriceDto } from './dto/calculate-price.dto';
import { RequireCapabilities } from '../auth/roles.guard';
import { RequirePermission } from '../identity/permission.guard';
import { TenantCtx } from '../identity/tenant-context.decorator';
import type { TenantContext } from '../identity/tenant-context.type';

@Controller('pricing')
@RequireCapabilities('products.read')
export class PricingController {
  constructor(
    private pricing: PricingService,
    private costVisibility: CostVisibilityService,
  ) {}

  /**
   * BR-CST-101 / Permission Matrix §17: the floor in `min_allowed_price` is
   * the variant's cost whenever the resolved entry carries no explicit
   * `floor_price`, so it is masked by *permission*
   * (`pricing.cost.view`/`pricing.margin.view`), not by role name. The
   * previous `role !== 'cashier'` test was the same defect in another
   * costume — it hard-coded one legacy role name and said nothing about
   * whichever role a tenant actually gives its tills.
   */
  @RequirePermission('pricing.price-book.view')
  @Post('calculate')
  async calculate(
    @TenantCtx() ctx: TenantContext,
    @Body() dto: CalculatePriceDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    const quote = await this.pricing.calculate(ctx, dto.variant_id, undefined, dto.qty);
    return this.costVisibility.projectQuote(req.user, quote);
  }
}
