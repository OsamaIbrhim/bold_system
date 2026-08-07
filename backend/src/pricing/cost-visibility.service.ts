import { Injectable } from '@nestjs/common';
import type { MembershipRole } from '@prisma/client';
import { PermissionPolicyService } from '../identity/permission-policy.service';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import type { PriceQuote } from './pricing.service';

/**
 * WP-008 Phase B — the enforcement point for Permission Matrix §17's
 * `pricing.cost.view` / `pricing.margin.view` keys (BR-CST-101: an
 * unauthorized user does not see cost; Matrix §51: a cashier gets no
 * cost/margin visibility).
 *
 * Why this exists at all: `PriceQuote.min_allowed_price` is the BR-OVP-102
 * floor, and when an entry carries no explicit `floor_price` that floor **is**
 * the variant's `cost_price`. Post-migration no entry has an explicit floor,
 * so the field is cost for the entire catalog. A cashier holds
 * `pricing.manual-override.apply`, so `POST /pricing/overrides` was returning
 * cost verbatim — and the below-floor rejection message quoted it even when
 * the override was refused.
 *
 * The masking is deliberately **unconditional on the permission**, not
 * conditional on `floor_is_cost_derived`: whether the floor is cost-derived is
 * itself an inference channel, and the two are identical in practice today
 * anyway. Internal callers (`sales`/`offers`/`sync`, and `OverridesService`'s
 * own enforcement) keep the true floor — only what crosses an HTTP boundary to
 * a specific actor is masked. The persisted `PriceOverride.floor_price` also
 * keeps the true value: audit is not disclosure.
 */
@Injectable()
export class CostVisibilityService {
  constructor(private readonly permissionPolicy: PermissionPolicyService) {}

  /** Either key grants it — Matrix §17 lists them separately, both imply cost-derived visibility. */
  async canViewCostDerivedValues(actor: Pick<AuthenticatedUser, 'membership_role'>): Promise<boolean> {
    const role: MembershipRole | null = actor.membership_role ?? null;
    if (!role) return false;
    const [cost, margin] = await Promise.all([
      this.permissionPolicy.hasPermission(role, 'pricing.cost.view'),
      this.permissionPolicy.hasPermission(role, 'pricing.margin.view'),
    ]);
    return cost || margin;
  }

  /**
   * The projection `POST /pricing/calculate` returns. A caller without
   * cost/margin visibility gets the sellable numbers only — no floor, and no
   * price-source identifiers that would let them enumerate entries.
   */
  async projectQuote(
    actor: Pick<AuthenticatedUser, 'membership_role'>,
    quote: PriceQuote,
  ): Promise<PriceQuote | Omit<PriceQuote, 'min_allowed_price' | 'floor_is_cost_derived' | 'source'>> {
    if (await this.canViewCostDerivedValues(actor)) return quote;
    const { min_allowed_price: _floor, floor_is_cost_derived: _derived, source: _source, ...visible } = quote;
    return visible;
  }

  /** Strips `floor_price` from a persisted override/list row before it leaves the API. */
  async maskFloor<T extends { floor_price?: unknown }>(
    actor: Pick<AuthenticatedUser, 'membership_role'>,
    row: T,
  ): Promise<T | Omit<T, 'floor_price'>> {
    if (await this.canViewCostDerivedValues(actor)) return row;
    const { floor_price: _floor, ...visible } = row;
    return visible;
  }

  async maskFloors<T extends { floor_price?: unknown }>(
    actor: Pick<AuthenticatedUser, 'membership_role'>,
    rows: readonly T[],
  ): Promise<(T | Omit<T, 'floor_price'>)[]> {
    if (await this.canViewCostDerivedValues(actor)) return [...rows];
    return rows.map(({ floor_price: _floor, ...visible }) => visible);
  }
}
