import { Body, Controller, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import type { MembershipRole } from '@prisma/client';
import { OverridesService } from './overrides.service';
import { RequireCapabilities } from '../auth/roles.guard';
import { RequirePermission } from '../identity/permission.guard';
import { TenantCtx } from '../identity/tenant-context.decorator';
import type { TenantContext } from '../identity/tenant-context.type';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { ApplyOverrideDto, PriceOverridePolicyDto } from './dto/override.dto';
import { ApplyDiscountDto } from './dto/discount.dto';

type AuthedRequest = Request & { user: AuthenticatedUser };

/** WP-008 Phase B (BR-OVP-1xx, BR-DSC-2xx): manual override and discount as distinct, audited entities. */
@Controller('pricing')
@RequireCapabilities('products.read')
export class OverridesController {
  constructor(private readonly svc: OverridesService) {}

  @RequirePermission('pricing.floor.configure')
  @Put('override-policy/:role')
  savePolicy(
    @TenantCtx() ctx: TenantContext,
    @Param('role') role: MembershipRole,
    @Body() dto: PriceOverridePolicyDto,
  ) {
    return this.svc.savePolicy(ctx, role, dto);
  }

  @RequirePermission('pricing.manual-override.apply')
  @Post('overrides')
  applyOverride(@TenantCtx() ctx: TenantContext, @Body() dto: ApplyOverrideDto, @Req() req: AuthedRequest) {
    return this.svc.applyOverride(ctx, req.user, dto);
  }

  /**
   * BR-OVP-102, Permission Matrix §17/§63: the independent approval step for a
   * below-floor override. `pricing.manual-override.approve` guarded nothing
   * but two list endpoints before this — the applying actor approved their own
   * below-floor override.
   */
  @RequirePermission('pricing.manual-override.approve')
  @Post('overrides/:id/approve')
  approveOverride(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Req() req: AuthedRequest,
  ) {
    return this.svc.approveOverride(ctx, req.user, id);
  }

  @RequirePermission('pricing.manual-override.approve')
  @Get('overrides')
  listOverrides(
    @TenantCtx() ctx: TenantContext,
    @Req() req: AuthedRequest,
    @Query('variant_id') variantId?: string,
  ) {
    return this.svc.listOverrides(ctx, req.user, variantId);
  }

  @RequirePermission('pricing.manual-override.apply')
  @Post('discounts')
  applyDiscount(@TenantCtx() ctx: TenantContext, @Body() dto: ApplyDiscountDto, @Req() req: AuthedRequest) {
    return this.svc.applyDiscount(ctx, req.user, dto);
  }

  @RequirePermission('pricing.manual-override.approve')
  @Get('discounts')
  listDiscounts(@TenantCtx() ctx: TenantContext, @Query('variant_id') variantId?: string) {
    return this.svc.listDiscounts(ctx, variantId);
  }
}
