-- WP-008 Phase B (BR-DSC-200/205): a calculated adjustment, distinct from a
-- "PriceOverride" -- never mutates the Price Book. "source" is a plain
-- string (not an enum) so Phase D can add 'promotion' without a migration;
-- only 'manual' is produced in this phase (Promotions are out of scope,
-- WP-008 §B.5).
CREATE TYPE "DiscountBasis" AS ENUM ('percentage', 'fixed_amount');

CREATE TABLE "Discount" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "reference" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "basis" "DiscountBasis" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "base_price" DECIMAL(12,2) NOT NULL,
    "final_price" DECIMAL(12,2) NOT NULL,
    "reason" TEXT,
    "applied_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Discount_pkey" PRIMARY KEY ("id"),
    -- BR-DSC-202: a discount never makes the line value negative.
    CONSTRAINT "Discount_final_price_not_negative" CHECK ("final_price" >= 0),
    CONSTRAINT "Discount_amount_not_negative" CHECK ("amount" >= 0)
);

CREATE UNIQUE INDEX "Discount_tenant_id_id_key" ON "Discount"("tenant_id", "id");
CREATE INDEX "Discount_tenant_id_idx" ON "Discount"("tenant_id");
CREATE INDEX "Discount_tenant_id_variant_id_idx" ON "Discount"("tenant_id", "variant_id");

ALTER TABLE "Discount" ADD CONSTRAINT "Discount_tenant_id_variant_id_fkey" FOREIGN KEY ("tenant_id", "variant_id") REFERENCES "ProductVariant"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
