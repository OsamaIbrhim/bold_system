-- WP-008 Phase B (BR-PRB-102/103, BR-PSL-1xx): effective-dated, versioned
-- Price Book entries. Same immutable-once-created pattern as Phase A's
-- "UomConversion" -- no UPDATE path, only "create" (first version) and
-- "supersede" (new version + marks the previous row "superseded").
CREATE TYPE "PriceEntryScopeType" AS ENUM ('variant', 'product', 'brand', 'category', 'global');
CREATE TYPE "PriceEntryStatus" AS ENUM ('active', 'superseded');

CREATE TABLE "PriceBookEntry" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "price_book_id" UUID NOT NULL,
    "scope_type" "PriceEntryScopeType" NOT NULL,
    "scope_id" UUID,
    "min_qty" DECIMAL(12,3) NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "allow_zero_price" BOOLEAN NOT NULL DEFAULT false,
    "tax_percent" DECIMAL(5,2) NOT NULL DEFAULT 14,
    "floor_price" DECIMAL(12,2),
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_to" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "PriceEntryStatus" NOT NULL DEFAULT 'active',
    "superseded_by_id" UUID,
    "superseded_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceBookEntry_pkey" PRIMARY KEY ("id"),
    -- BR-PSL-103: negative price is never valid. BR-PSL-102: zero requires
    -- the explicit "allow_zero_price" allowance.
    CONSTRAINT "PriceBookEntry_unit_price_not_negative" CHECK ("unit_price" >= 0),
    CONSTRAINT "PriceBookEntry_zero_price_requires_allowance" CHECK ("unit_price" > 0 OR "allow_zero_price" = true),
    CONSTRAINT "PriceBookEntry_min_qty_positive" CHECK ("min_qty" > 0)
);

CREATE UNIQUE INDEX "PriceBookEntry_tenant_id_id_key" ON "PriceBookEntry"("tenant_id", "id");
CREATE INDEX "PriceBookEntry_tenant_id_idx" ON "PriceBookEntry"("tenant_id");
CREATE INDEX "PriceBookEntry_tenant_id_price_book_id_scope_type_scope_id_status_idx" ON "PriceBookEntry"("tenant_id", "price_book_id", "scope_type", "scope_id", "status");

-- BR-PRB-102: entries at the same (book, scope, qty-break) must not overlap
-- while active -- editing an active entry supersedes it and inserts a new
-- version instead (BR-PRB-103), so at most one "active" row can ever exist
-- per (price_book_id, scope_type, scope_id, min_qty).
CREATE UNIQUE INDEX "PriceBookEntry_one_active_per_scope_qty" ON "PriceBookEntry"(
    "price_book_id",
    "scope_type",
    COALESCE("scope_id", '00000000-0000-0000-0000-000000000000'::uuid),
    "min_qty"
) WHERE "status" = 'active';

ALTER TABLE "PriceBookEntry" ADD CONSTRAINT "PriceBookEntry_tenant_id_price_book_id_fkey" FOREIGN KEY ("tenant_id", "price_book_id") REFERENCES "PriceBook"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
