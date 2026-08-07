-- WP-008 Phase B (BR-OVP-101): per-role manual-override limits, configured
-- by "pricing.floor.configure". No row for a role means no tenant-configured
-- limit; the below-floor/approval invariants are still enforced in the
-- service layer regardless.
CREATE TABLE "PriceOverridePolicy" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "max_discount_percent" DECIMAL(5,2),
    "max_discount_amount" DECIMAL(12,2),
    "allow_price_increase" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceOverridePolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PriceOverridePolicy_tenant_id_id_key" ON "PriceOverridePolicy"("tenant_id", "id");
CREATE UNIQUE INDEX "PriceOverridePolicy_tenant_id_role_key" ON "PriceOverridePolicy"("tenant_id", "role");
CREATE INDEX "PriceOverridePolicy_tenant_id_idx" ON "PriceOverridePolicy"("tenant_id");
