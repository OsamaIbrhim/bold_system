-- WP-008 Phase B (BR-OVP-100): a manual price override is a distinct,
-- audited change to the applied unit price at sale time -- never a silent
-- edit to the Price Book (BR-OVP-103). "reference" is a plain opaque string,
-- not an FK, so the pricing module stays independent of the sales module
-- (CLAUDE.md §2.2).
CREATE TABLE "PriceOverride" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "reference" TEXT,
    "base_price" DECIMAL(12,2) NOT NULL,
    "override_price" DECIMAL(12,2) NOT NULL,
    "floor_price" DECIMAL(12,2),
    "is_below_floor" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL,
    "applied_by" UUID NOT NULL,
    "approved_by" UUID,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceOverride_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PriceOverride_override_price_not_negative" CHECK ("override_price" >= 0),
    -- BR-OVP-102: below-floor requires a recorded approval.
    CONSTRAINT "PriceOverride_below_floor_requires_approval" CHECK ("is_below_floor" = false OR "approved_by" IS NOT NULL)
);

CREATE UNIQUE INDEX "PriceOverride_tenant_id_id_key" ON "PriceOverride"("tenant_id", "id");
CREATE INDEX "PriceOverride_tenant_id_idx" ON "PriceOverride"("tenant_id");
CREATE INDEX "PriceOverride_tenant_id_variant_id_idx" ON "PriceOverride"("tenant_id", "variant_id");

ALTER TABLE "PriceOverride" ADD CONSTRAINT "PriceOverride_tenant_id_variant_id_fkey" FOREIGN KEY ("tenant_id", "variant_id") REFERENCES "ProductVariant"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
