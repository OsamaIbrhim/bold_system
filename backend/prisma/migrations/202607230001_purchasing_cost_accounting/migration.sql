-- Problem 4: global moving weighted-average purchasing cost accounting.
-- This migration preserves historical receipts as accounting_version=1 and
-- applies fully reproducible cost snapshots to every new receipt (version 2).

CREATE TYPE "PurchaseInvoiceStatus" AS ENUM ('posted', 'reversed');
CREATE TYPE "InventoryCostMovementType" AS ENUM (
  'opening_balance',
  'purchase_receipt',
  'purchase_reversal',
  'supplier_return',
  'customer_return',
  'adjustment'
);

-- UUIDs and millisecond timestamps do not provide deterministic ledger order.
-- A database sequence makes replay, reversal guards and reconciliation stable.
ALTER TABLE "InventoryMovement"
  ADD COLUMN "sequence" BIGSERIAL NOT NULL;
CREATE UNIQUE INDEX "InventoryMovement_sequence_key"
  ON "InventoryMovement"("sequence");
CREATE INDEX "InventoryMovement_variant_sequence_idx"
  ON "InventoryMovement"("variant_id", "sequence");

ALTER TABLE "PurchaseInvoice"
  ADD COLUMN "normalized_invoice_number" VARCHAR(100),
  ADD COLUMN "status" "PurchaseInvoiceStatus" NOT NULL DEFAULT 'posted',
  ADD COLUMN "accounting_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "idempotency_key" VARCHAR(191)
    DEFAULT gen_random_uuid()::text,
  ADD COLUMN "command_fingerprint" VARCHAR(64),
  ADD COLUMN "received_at" TIMESTAMP(3),
  ADD COLUMN "reversal_idempotency_key" VARCHAR(191),
  ADD COLUMN "reversal_command_fingerprint" VARCHAR(64),
  ADD COLUMN "reversal_reason" TEXT,
  ADD COLUMN "reversed_at" TIMESTAMP(3),
  ADD COLUMN "reversed_by" UUID;

ALTER TABLE "PurchaseInvoice"
  ALTER COLUMN "subtotal" TYPE DECIMAL(18, 2),
  ALTER COLUMN "discount_amount" TYPE DECIMAL(18, 2),
  ALTER COLUMN "total" TYPE DECIMAL(18, 2);

ALTER TABLE "PurchaseInvoiceItem"
  ALTER COLUMN "unit_cost" TYPE DECIMAL(18, 6),
  ADD COLUMN "line_subtotal" DECIMAL(18, 2),
  ADD COLUMN "allocated_discount" DECIMAL(18, 2),
  ADD COLUMN "net_line_total" DECIMAL(18, 2),
  ADD COLUMN "net_unit_cost" DECIMAL(18, 6),
  ADD COLUMN "global_qty_before" INTEGER,
  ADD COLUMN "global_qty_after" INTEGER,
  ADD COLUMN "cost_before" DECIMAL(12, 2),
  ADD COLUMN "cost_after" DECIMAL(12, 2);

WITH normalized AS (
  SELECT
    invoice."id",
    NULLIF(
      UPPER(
        REGEXP_REPLACE(
          BTRIM(invoice."invoice_number"),
          '[[:space:]]+',
          ' ',
          'g'
        )
      ),
      ''
    ) AS "value"
  FROM "PurchaseInvoice" invoice
)
UPDATE "PurchaseInvoice" invoice
SET
  "accounting_version" = 1,
  "normalized_invoice_number" = CASE
    WHEN CHAR_LENGTH(normalized."value") <= 100
      THEN normalized."value"
    ELSE NULL
  END,
  "idempotency_key" = 'legacy-purchase:' || invoice."id"::text,
  "command_fingerprint" =
    md5('legacy-purchase:' || invoice."id"::text) ||
    md5(invoice."id"::text || ':legacy-purchase'),
  "received_at" = invoice."created_at"
FROM normalized
WHERE normalized."id" = invoice."id";

-- Historical duplicate supplier invoice numbers are preserved but excluded
-- from the new uniqueness contract because their original intent is unknown.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "supplier_id", "normalized_invoice_number"
      ORDER BY "created_at", "id"
    ) AS row_number
  FROM "PurchaseInvoice"
  WHERE "normalized_invoice_number" IS NOT NULL
)
UPDATE "PurchaseInvoice" invoice
SET "normalized_invoice_number" = NULL
FROM ranked
WHERE ranked."id" = invoice."id"
  AND ranked.row_number > 1;

DO $$
DECLARE
  orphan_invoice UUID;
BEGIN
  SELECT invoice."id"
  INTO orphan_invoice
  FROM "PurchaseInvoice" invoice
  LEFT JOIN "Branch" branch
    ON branch."id" = invoice."branch_id"
  WHERE branch."id" IS NULL
  LIMIT 1;

  IF orphan_invoice IS NOT NULL THEN
    RAISE EXCEPTION
      'PurchaseInvoice % references a missing branch; repair the data before deploying purchasing accounting',
      orphan_invoice;
  END IF;
END
$$;

UPDATE "PurchaseInvoice" invoice
SET "created_by" = NULL
WHERE invoice."created_by" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "User" actor
    WHERE actor."id" = invoice."created_by"
  );

ALTER TABLE "PurchaseInvoice"
  ALTER COLUMN "idempotency_key" SET NOT NULL,
  ALTER COLUMN "received_at" SET NOT NULL,
  ALTER COLUMN "received_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "PurchaseInvoice"
  ADD CONSTRAINT "PurchaseInvoice_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "Branch"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "PurchaseInvoice_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL,
  ADD CONSTRAINT "PurchaseInvoice_reversed_by_fkey"
    FOREIGN KEY ("reversed_by") REFERENCES "User"("id") ON DELETE SET NULL,
  ADD CONSTRAINT "PurchaseInvoice_nonnegative_amounts"
    CHECK (
      "subtotal" >= 0
      AND "discount_amount" >= 0
      AND "discount_amount" <= "subtotal"
      AND "total" >= 0
    ),
  ADD CONSTRAINT "PurchaseInvoice_accounting_contract"
    CHECK (
      "accounting_version" >= 1
      AND CHAR_LENGTH("idempotency_key") > 0
      AND (
        "accounting_version" = 1
        OR (
          CHAR_LENGTH("command_fingerprint") = 64
          AND "total" = "subtotal" - "discount_amount"
        )
      )
    ),
  ADD CONSTRAINT "PurchaseInvoice_reversal_fields"
    CHECK (
      ("status" = 'posted'
        AND "reversal_idempotency_key" IS NULL
        AND "reversal_command_fingerprint" IS NULL
        AND "reversed_at" IS NULL
        AND "reversed_by" IS NULL
        AND "reversal_reason" IS NULL)
      OR
      ("status" = 'reversed'
        AND "reversal_idempotency_key" IS NOT NULL
        AND "reversal_command_fingerprint" IS NOT NULL
        AND "reversed_at" IS NOT NULL
        AND "reversal_reason" IS NOT NULL)
    );

ALTER TABLE "PurchaseInvoiceItem"
  ADD CONSTRAINT "PurchaseInvoiceItem_positive_qty"
    CHECK ("qty" > 0),
  ADD CONSTRAINT "PurchaseInvoiceItem_nonnegative_costs"
    CHECK (
      "unit_cost" >= 0
      AND ("line_subtotal" IS NULL OR "line_subtotal" >= 0)
      AND ("allocated_discount" IS NULL OR "allocated_discount" >= 0)
      AND ("net_line_total" IS NULL OR "net_line_total" >= 0)
      AND ("net_unit_cost" IS NULL OR "net_unit_cost" >= 0)
      AND ("cost_before" IS NULL OR "cost_before" >= 0)
      AND ("cost_after" IS NULL OR "cost_after" >= 0)
    ),
  ADD CONSTRAINT "PurchaseInvoiceItem_financial_snapshot"
    CHECK (
      (
        "line_subtotal" IS NULL
        AND "allocated_discount" IS NULL
        AND "net_line_total" IS NULL
        AND "net_unit_cost" IS NULL
      )
      OR
      (
        "line_subtotal" IS NOT NULL
        AND "allocated_discount" IS NOT NULL
        AND "net_line_total" IS NOT NULL
        AND "net_unit_cost" IS NOT NULL
        AND "allocated_discount" <= "line_subtotal"
        AND "net_line_total" =
          "line_subtotal" - "allocated_discount"
      )
    ),
  ADD CONSTRAINT "PurchaseInvoiceItem_cost_snapshot"
    CHECK (
      (
        "global_qty_before" IS NULL
        AND "global_qty_after" IS NULL
        AND "cost_before" IS NULL
        AND "cost_after" IS NULL
      )
      OR
      (
        "global_qty_before" IS NOT NULL
        AND "global_qty_after" IS NOT NULL
        AND "cost_before" IS NOT NULL
        AND "cost_after" IS NOT NULL
        AND "global_qty_before" >= 0
        AND "global_qty_after" =
          "global_qty_before" + "qty"
      )
    );

CREATE UNIQUE INDEX "PurchaseInvoice_supplier_normalized_number_key"
  ON "PurchaseInvoice"("supplier_id", "normalized_invoice_number");
CREATE UNIQUE INDEX "PurchaseInvoice_idempotency_key_key"
  ON "PurchaseInvoice"("idempotency_key");
CREATE UNIQUE INDEX "PurchaseInvoice_reversal_idempotency_key_key"
  ON "PurchaseInvoice"("reversal_idempotency_key");
CREATE INDEX "PurchaseInvoice_branch_received_at_idx"
  ON "PurchaseInvoice"("branch_id", "received_at");
CREATE INDEX "PurchaseInvoice_supplier_invoice_date_idx"
  ON "PurchaseInvoice"("supplier_id", "invoice_date");
CREATE INDEX "PurchaseInvoice_status_received_at_idx"
  ON "PurchaseInvoice"("status", "received_at");
CREATE INDEX "PurchaseInvoiceItem_purchase_invoice_id_idx"
  ON "PurchaseInvoiceItem"("purchase_invoice_id");
CREATE INDEX "PurchaseInvoiceItem_variant_id_idx"
  ON "PurchaseInvoiceItem"("variant_id");


CREATE TYPE "SupplierReturnStatus" AS ENUM ('posted');

CREATE TABLE "SupplierReturn" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "purchase_invoice_id" UUID NOT NULL,
  "supplier_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "return_number" VARCHAR(100) NOT NULL,
  "status" "SupplierReturnStatus" NOT NULL DEFAULT 'posted',
  "idempotency_key" VARCHAR(191) NOT NULL,
  "command_fingerprint" VARCHAR(64) NOT NULL,
  "reason" TEXT NOT NULL,
  "credit_total" DECIMAL(18, 2) NOT NULL,
  "inventory_value_removed" DECIMAL(18, 2) NOT NULL,
  "purchase_price_variance" DECIMAL(18, 2) NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "created_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SupplierReturn_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupplierReturn_purchase_invoice_id_fkey"
    FOREIGN KEY ("purchase_invoice_id") REFERENCES "PurchaseInvoice"("id") ON DELETE CASCADE,
  CONSTRAINT "SupplierReturn_supplier_id_fkey"
    FOREIGN KEY ("supplier_id") REFERENCES "Supplier"("id") ON DELETE RESTRICT,
  CONSTRAINT "SupplierReturn_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "Branch"("id") ON DELETE RESTRICT,
  CONSTRAINT "SupplierReturn_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL,
  CONSTRAINT "SupplierReturn_nonnegative_values"
    CHECK ("credit_total" >= 0 AND "inventory_value_removed" >= 0),
  CONSTRAINT "SupplierReturn_accounting_contract"
    CHECK (
      CHAR_LENGTH("idempotency_key") > 0
      AND CHAR_LENGTH("command_fingerprint") = 64
      AND "purchase_price_variance" =
        "credit_total" - "inventory_value_removed"
    )
);

CREATE UNIQUE INDEX "SupplierReturn_return_number_key"
  ON "SupplierReturn"("return_number");
CREATE UNIQUE INDEX "SupplierReturn_idempotency_key_key"
  ON "SupplierReturn"("idempotency_key");
CREATE INDEX "SupplierReturn_purchase_invoice_id_occurred_at_idx"
  ON "SupplierReturn"("purchase_invoice_id", "occurred_at");
CREATE INDEX "SupplierReturn_supplier_id_occurred_at_idx"
  ON "SupplierReturn"("supplier_id", "occurred_at");
CREATE INDEX "SupplierReturn_branch_id_occurred_at_idx"
  ON "SupplierReturn"("branch_id", "occurred_at");

CREATE TABLE "SupplierReturnItem" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "supplier_return_id" UUID NOT NULL,
  "purchase_invoice_item_id" UUID NOT NULL,
  "variant_id" UUID NOT NULL,
  "qty" INTEGER NOT NULL,
  "credit_unit_cost" DECIMAL(18, 6) NOT NULL,
  "credit_total" DECIMAL(18, 2) NOT NULL,
  "inventory_unit_cost" DECIMAL(12, 2) NOT NULL,
  "inventory_value_removed" DECIMAL(18, 2) NOT NULL,
  "purchase_price_variance" DECIMAL(18, 2) NOT NULL,

  CONSTRAINT "SupplierReturnItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupplierReturnItem_supplier_return_id_fkey"
    FOREIGN KEY ("supplier_return_id") REFERENCES "SupplierReturn"("id") ON DELETE CASCADE,
  CONSTRAINT "SupplierReturnItem_purchase_invoice_item_id_fkey"
    FOREIGN KEY ("purchase_invoice_item_id") REFERENCES "PurchaseInvoiceItem"("id") ON DELETE CASCADE,
  CONSTRAINT "SupplierReturnItem_variant_id_fkey"
    FOREIGN KEY ("variant_id") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT,
  CONSTRAINT "SupplierReturnItem_positive_qty"
    CHECK ("qty" > 0),
  CONSTRAINT "SupplierReturnItem_nonnegative_values"
    CHECK (
      "credit_unit_cost" >= 0
      AND "credit_total" >= 0
      AND "inventory_unit_cost" >= 0
      AND "inventory_value_removed" >= 0
    ),
  CONSTRAINT "SupplierReturnItem_accounting_contract"
    CHECK (
      "purchase_price_variance" =
        "credit_total" - "inventory_value_removed"
    )
);

CREATE INDEX "SupplierReturnItem_supplier_return_id_idx"
  ON "SupplierReturnItem"("supplier_return_id");
CREATE INDEX "SupplierReturnItem_purchase_invoice_item_id_idx"
  ON "SupplierReturnItem"("purchase_invoice_item_id");
CREATE INDEX "SupplierReturnItem_variant_id_idx"
  ON "SupplierReturnItem"("variant_id");

CREATE TABLE "InventoryCostMovement" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sequence" BIGSERIAL NOT NULL,
  "variant_id" UUID NOT NULL,
  "branch_id" UUID,
  "movement_type" "InventoryCostMovementType" NOT NULL,
  "quantity_delta" INTEGER NOT NULL,
  "global_quantity_before" INTEGER NOT NULL,
  "global_quantity_after" INTEGER NOT NULL,
  "unit_cost" DECIMAL(18, 6) NOT NULL,
  "cost_before" DECIMAL(12, 2) NOT NULL,
  "cost_after" DECIMAL(12, 2) NOT NULL,
  "inventory_value_before" DECIMAL(18, 2) NOT NULL,
  "movement_value" DECIMAL(18, 2) NOT NULL,
  "inventory_value_after" DECIMAL(18, 2) NOT NULL,
  "rounding_adjustment" DECIMAL(18, 2) NOT NULL DEFAULT 0,
  "reference_type" VARCHAR(64) NOT NULL,
  "reference_id" VARCHAR(128) NOT NULL,
  "reference_line_id" VARCHAR(128),
  "purchase_invoice_id" UUID,
  "purchase_invoice_item_id" UUID,
  "supplier_return_id" UUID,
  "supplier_return_item_id" UUID,
  "idempotency_key" VARCHAR(191) NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  "metadata" JSONB,

  CONSTRAINT "InventoryCostMovement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryCostMovement_variant_id_fkey"
    FOREIGN KEY ("variant_id") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT,
  CONSTRAINT "InventoryCostMovement_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "Branch"("id") ON DELETE RESTRICT,
  CONSTRAINT "InventoryCostMovement_purchase_invoice_id_fkey"
    FOREIGN KEY ("purchase_invoice_id") REFERENCES "PurchaseInvoice"("id") ON DELETE RESTRICT,
  CONSTRAINT "InventoryCostMovement_purchase_invoice_item_id_fkey"
    FOREIGN KEY ("purchase_invoice_item_id") REFERENCES "PurchaseInvoiceItem"("id") ON DELETE RESTRICT,
  CONSTRAINT "InventoryCostMovement_supplier_return_id_fkey"
    FOREIGN KEY ("supplier_return_id") REFERENCES "SupplierReturn"("id") ON DELETE RESTRICT,
  CONSTRAINT "InventoryCostMovement_supplier_return_item_id_fkey"
    FOREIGN KEY ("supplier_return_item_id") REFERENCES "SupplierReturnItem"("id") ON DELETE RESTRICT,
  CONSTRAINT "InventoryCostMovement_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL,
  CONSTRAINT "InventoryCostMovement_quantity_consistency"
    CHECK (
      "quantity_delta" <> 0
      AND "global_quantity_before" >= 0
      AND "global_quantity_after" >= 0
      AND "global_quantity_before" + "quantity_delta" = "global_quantity_after"
    ),
  CONSTRAINT "InventoryCostMovement_nonnegative_costs"
    CHECK (
      "unit_cost" >= 0
      AND "cost_before" >= 0
      AND "cost_after" >= 0
      AND "inventory_value_before" >= 0
      AND "inventory_value_after" >= 0
    ),
  CONSTRAINT "InventoryCostMovement_value_equation"
    CHECK (
      "inventory_value_after" =
        "inventory_value_before"
        + "movement_value"
        + "rounding_adjustment"
    ),
  CONSTRAINT "InventoryCostMovement_type_direction"
    CHECK (
      (
        "movement_type" = 'opening_balance'
        AND "quantity_delta" > 0
        AND "movement_value" >= 0
        AND "global_quantity_before" = 0
        AND "cost_before" = 0
      )
      OR
      (
        "movement_type" IN (
          'purchase_receipt',
          'customer_return'
        )
        AND "quantity_delta" > 0
        AND "movement_value" >= 0
      )
      OR
      (
        "movement_type" IN (
          'purchase_reversal',
          'supplier_return'
        )
        AND "quantity_delta" < 0
        AND "movement_value" <= 0
      )
      OR "movement_type" = 'adjustment'
    )
);

CREATE UNIQUE INDEX "InventoryCostMovement_sequence_key"
  ON "InventoryCostMovement"("sequence");
CREATE UNIQUE INDEX "InventoryCostMovement_idempotency_key_key"
  ON "InventoryCostMovement"("idempotency_key");
CREATE INDEX "InventoryCostMovement_variant_sequence_idx"
  ON "InventoryCostMovement"("variant_id", "sequence");
CREATE INDEX "InventoryCostMovement_branch_occurred_at_idx"
  ON "InventoryCostMovement"("branch_id", "occurred_at");
CREATE INDEX "InventoryCostMovement_reference_idx"
  ON "InventoryCostMovement"("reference_type", "reference_id");
CREATE INDEX "InventoryCostMovement_purchase_invoice_recorded_at_idx"
  ON "InventoryCostMovement"("purchase_invoice_id", "recorded_at");
CREATE INDEX "InventoryCostMovement_supplier_return_sequence_idx"
  ON "InventoryCostMovement"("supplier_return_id", "sequence");
CREATE INDEX "InventoryCostMovement_supplier_return_item_idx"
  ON "InventoryCostMovement"("supplier_return_item_id");
CREATE INDEX "InventoryCostMovement_created_by_occurred_at_idx"
  ON "InventoryCostMovement"("created_by", "occurred_at");

DO $$
DECLARE
  oversized_variant UUID;
BEGIN
  SELECT stock."variant_id"
  INTO oversized_variant
  FROM "InventoryStock" stock
  GROUP BY stock."variant_id"
  HAVING SUM(stock."qty_on_hand") > 2147483647
  LIMIT 1;

  IF oversized_variant IS NOT NULL THEN
    RAISE EXCEPTION
      'Global inventory quantity exceeds supported INTEGER range for variant %',
      oversized_variant;
  END IF;

  SELECT variant."id"
  INTO oversized_variant
  FROM "ProductVariant" variant
  JOIN (
    SELECT
      stock."variant_id",
      SUM(stock."qty_on_hand")::numeric AS "qty"
    FROM "InventoryStock" stock
    GROUP BY stock."variant_id"
  ) totals
    ON totals."variant_id" = variant."id"
  WHERE totals."qty" * variant."cost_price"
        > 9999999999999999.99
  LIMIT 1;

  IF oversized_variant IS NOT NULL THEN
    RAISE EXCEPTION
      'Inventory value exceeds DECIMAL(18,2) range for variant %',
      oversized_variant;
  END IF;
END
$$;

INSERT INTO "InventoryCostMovement" (
  "variant_id",
  "movement_type",
  "quantity_delta",
  "global_quantity_before",
  "global_quantity_after",
  "unit_cost",
  "cost_before",
  "cost_after",
  "inventory_value_before",
  "movement_value",
  "inventory_value_after",
  "rounding_adjustment",
  "reference_type",
  "reference_id",
  "idempotency_key",
  "occurred_at",
  "metadata"
)
SELECT
  variant."id",
  'opening_balance'::"InventoryCostMovementType",
  totals."qty_on_hand"::integer,
  0,
  totals."qty_on_hand"::integer,
  variant."cost_price"::numeric(18, 6),
  0,
  variant."cost_price",
  0,
  ROUND(totals."qty_on_hand" * variant."cost_price", 2),
  ROUND(totals."qty_on_hand" * variant."cost_price", 2),
  0,
  'InventoryStock',
  variant."id"::text,
  'cost-opening:' || variant."id"::text,
  CURRENT_TIMESTAMP,
  jsonb_build_object(
    'source', '202607230001_purchasing_cost_accounting',
    'reason', 'pre-cost-ledger global moving-average snapshot'
  )
FROM "ProductVariant" variant
JOIN (
  SELECT
    stock."variant_id",
    SUM(stock."qty_on_hand")::bigint AS "qty_on_hand"
  FROM "InventoryStock" stock
  GROUP BY stock."variant_id"
) totals
  ON totals."variant_id" = variant."id"
WHERE totals."qty_on_hand" > 0;

CREATE OR REPLACE FUNCTION "record_inventory_cost_movement"(
  p_variant_id UUID,
  p_branch_id UUID,
  p_movement_type "InventoryCostMovementType",
  p_quantity_delta INTEGER,
  p_movement_value NUMERIC(18, 2),
  p_reference_type TEXT,
  p_reference_id TEXT,
  p_reference_line_id TEXT,
  p_purchase_invoice_id UUID,
  p_purchase_invoice_item_id UUID,
  p_supplier_return_id UUID,
  p_supplier_return_item_id UUID,
  p_idempotency_key TEXT,
  p_occurred_at TIMESTAMP(3),
  p_created_by UUID,
  p_restore_cost NUMERIC(12, 2),
  p_metadata JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  existing "InventoryCostMovement"%ROWTYPE;
  existing_found BOOLEAN := false;
  latest "InventoryCostMovement"%ROWTYPE;
  current_cost NUMERIC(12, 2);
  current_quantity_big BIGINT;
  current_quantity INTEGER;
  previous_quantity BIGINT;
  calculated_cost NUMERIC;
  next_cost NUMERIC(12, 2);
  value_before NUMERIC(18, 2);
  value_after NUMERIC(18, 2);
  rounding_delta NUMERIC(18, 2);
  movement_id UUID;
BEGIN
  IF p_quantity_delta = 0 THEN
    RAISE EXCEPTION 'Inventory cost movement quantity delta cannot be zero';
  END IF;

  SELECT variant."cost_price"
  INTO current_cost
  FROM "ProductVariant" variant
  WHERE variant."id" = p_variant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ProductVariant % does not exist', p_variant_id;
  END IF;

  SELECT *
  INTO existing
  FROM "InventoryCostMovement"
  WHERE "idempotency_key" = p_idempotency_key;
  existing_found := FOUND;

  IF existing_found THEN
    IF existing."variant_id" <> p_variant_id
       OR existing."branch_id" IS DISTINCT FROM p_branch_id
       OR existing."movement_type" <> p_movement_type
       OR existing."quantity_delta" <> p_quantity_delta
       OR existing."movement_value" <> p_movement_value
       OR existing."reference_type" <> p_reference_type
       OR existing."reference_id" <> p_reference_id
       OR existing."reference_line_id" IS DISTINCT FROM p_reference_line_id
       OR existing."purchase_invoice_id" IS DISTINCT FROM p_purchase_invoice_id
       OR existing."purchase_invoice_item_id" IS DISTINCT FROM p_purchase_invoice_item_id
       OR existing."supplier_return_id" IS DISTINCT FROM p_supplier_return_id
       OR existing."supplier_return_item_id" IS DISTINCT FROM p_supplier_return_item_id
       OR (
         p_movement_type = 'purchase_reversal'
         AND existing."cost_after" IS DISTINCT FROM p_restore_cost
       ) THEN
      RAISE EXCEPTION
        'Inventory cost movement idempotency key belongs to a different command: %',
        p_idempotency_key;
    END IF;
  END IF;

  SELECT COALESCE(SUM(stock."qty_on_hand"), 0)
  INTO current_quantity_big
  FROM "InventoryStock" stock
  WHERE stock."variant_id" = p_variant_id;

  IF current_quantity_big < 0
     OR current_quantity_big > 2147483647 THEN
    RAISE EXCEPTION
      'Invalid global inventory quantity for variant %: %',
      p_variant_id,
      current_quantity_big;
  END IF;

  current_quantity := current_quantity_big::integer;

  SELECT *
  INTO latest
  FROM "InventoryCostMovement"
  WHERE "variant_id" = p_variant_id
  ORDER BY "sequence" DESC
  LIMIT 1;

  IF existing_found THEN
    IF latest."id" IS NULL
       OR latest."cost_after" <> current_cost THEN
      RAISE EXCEPTION
        'Inventory cost ledger mismatch after idempotent replay for variant %: ledger cost %, materialized cost %',
        p_variant_id,
        latest."cost_after",
        current_cost;
    END IF;

    RETURN existing."id";
  END IF;

  previous_quantity := current_quantity_big - p_quantity_delta::bigint;

  IF previous_quantity < 0
     OR previous_quantity > 2147483647 THEN
    RAISE EXCEPTION
      'Invalid global inventory quantity transition for variant %: previous %, delta %, current %',
      p_variant_id,
      previous_quantity,
      p_quantity_delta,
      current_quantity_big;
  END IF;

  IF latest."id" IS NULL AND previous_quantity > 0 THEN
    INSERT INTO "InventoryCostMovement" (
      "variant_id",
      "movement_type",
      "quantity_delta",
      "global_quantity_before",
      "global_quantity_after",
      "unit_cost",
      "cost_before",
      "cost_after",
      "inventory_value_before",
      "movement_value",
      "inventory_value_after",
      "rounding_adjustment",
      "reference_type",
      "reference_id",
      "idempotency_key",
      "occurred_at",
      "metadata"
    ) VALUES (
      p_variant_id,
      'opening_balance',
      previous_quantity::integer,
      0,
      previous_quantity::integer,
      current_cost::numeric(18, 6),
      0,
      current_cost,
      0,
      ROUND(previous_quantity * current_cost, 2),
      ROUND(previous_quantity * current_cost, 2),
      0,
      'InventoryStock',
      p_variant_id::text,
      'cost-auto-opening:' || p_variant_id::text,
      p_occurred_at,
      jsonb_build_object(
        'reason', 'first post-cost-ledger receipt on an uninitialized variant'
      )
    )
    ON CONFLICT ("idempotency_key") DO NOTHING;

    SELECT *
    INTO latest
    FROM "InventoryCostMovement"
    WHERE "variant_id" = p_variant_id
    ORDER BY "sequence" DESC
    LIMIT 1;
  END IF;

  -- Quantity may legitimately differ from the previous cost event because
  -- sales, customer returns, and transfers do not change the moving-average
  -- unit cost. Quantity snapshots are event-local, while cost continuity is
  -- strict across every cost event.
  IF latest."id" IS NOT NULL
     AND latest."cost_after" <> current_cost THEN
    RAISE EXCEPTION
      'Inventory cost ledger mismatch for variant %: ledger cost %, materialized cost %',
      p_variant_id,
      latest."cost_after",
      current_cost;
  END IF;

  IF p_movement_type IN ('purchase_receipt', 'customer_return') THEN
    IF p_quantity_delta <= 0 OR p_movement_value < 0 OR current_quantity <= 0 THEN
      RAISE EXCEPTION 'Invalid incoming inventory cost movement';
    END IF;

    calculated_cost :=
      (
        (current_cost * previous_quantity) + p_movement_value
      ) / current_quantity;
    IF calculated_cost < 0 OR calculated_cost > 9999999999.99 THEN
      RAISE EXCEPTION
        'Calculated moving-average cost is outside DECIMAL(12,2) range for variant %',
        p_variant_id;
    END IF;
    next_cost := ROUND(calculated_cost, 2);
  ELSIF p_movement_type = 'purchase_reversal' THEN
    IF p_quantity_delta >= 0 OR p_movement_value > 0 OR p_restore_cost IS NULL THEN
      RAISE EXCEPTION 'Invalid purchase reversal cost movement';
    END IF;

    next_cost := p_restore_cost;
  ELSIF p_movement_type = 'supplier_return' THEN
    IF p_quantity_delta >= 0
       OR p_movement_value > 0
       OR p_restore_cost IS NOT NULL
       OR p_movement_value <> ROUND(p_quantity_delta * current_cost, 2) THEN
      RAISE EXCEPTION
        'Supplier return must remove inventory at the current moving-average cost';
    END IF;

    next_cost := current_cost;
  ELSE
    RAISE EXCEPTION
      'Unsupported inventory cost movement type for posting function: %',
      p_movement_type;
  END IF;

  IF next_cost < 0 THEN
    RAISE EXCEPTION 'Inventory cost cannot become negative';
  END IF;

  IF previous_quantity * current_cost > 9999999999999999.99
     OR current_quantity_big * next_cost > 9999999999999999.99
     OR ABS(p_movement_value) > 9999999999999999.99 THEN
    RAISE EXCEPTION
      'Inventory value is outside DECIMAL(18,2) range for variant %',
      p_variant_id;
  END IF;

  value_before := ROUND(previous_quantity * current_cost, 2);
  value_after := ROUND(current_quantity_big * next_cost, 2);
  rounding_delta := value_after - (value_before + p_movement_value);

  INSERT INTO "InventoryCostMovement" (
    "variant_id",
    "branch_id",
    "movement_type",
    "quantity_delta",
    "global_quantity_before",
    "global_quantity_after",
    "unit_cost",
    "cost_before",
    "cost_after",
    "inventory_value_before",
    "movement_value",
    "inventory_value_after",
    "rounding_adjustment",
    "reference_type",
    "reference_id",
    "reference_line_id",
    "purchase_invoice_id",
    "purchase_invoice_item_id",
    "supplier_return_id",
    "supplier_return_item_id",
    "idempotency_key",
    "occurred_at",
    "created_by",
    "metadata"
  ) VALUES (
    p_variant_id,
    p_branch_id,
    p_movement_type,
    p_quantity_delta,
    previous_quantity::integer,
    current_quantity,
    CASE
      WHEN p_quantity_delta = 0 THEN 0
      ELSE ABS(p_movement_value / p_quantity_delta)::numeric(18, 6)
    END,
    current_cost,
    next_cost,
    value_before,
    p_movement_value,
    value_after,
    rounding_delta,
    p_reference_type,
    p_reference_id,
    p_reference_line_id,
    p_purchase_invoice_id,
    p_purchase_invoice_item_id,
    p_supplier_return_id,
    p_supplier_return_item_id,
    p_idempotency_key,
    p_occurred_at,
    p_created_by,
    p_metadata
  )
  RETURNING "id" INTO movement_id;

  IF p_movement_type = 'purchase_receipt' THEN
    IF p_purchase_invoice_id IS NULL
       OR p_purchase_invoice_item_id IS NULL THEN
      RAISE EXCEPTION
        'Purchase receipt cost movements require invoice and line references';
    END IF;

    PERFORM set_config(
      'bold.purchase_accounting_document_write',
      'on',
      true
    );
    UPDATE "PurchaseInvoiceItem"
    SET
      "global_qty_before" = previous_quantity::integer,
      "global_qty_after" = current_quantity,
      "cost_before" = current_cost,
      "cost_after" = next_cost
    WHERE "id" = p_purchase_invoice_item_id
      AND "purchase_invoice_id" = p_purchase_invoice_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'PurchaseInvoiceItem % does not belong to PurchaseInvoice %',
        p_purchase_invoice_item_id,
        p_purchase_invoice_id;
    END IF;

    PERFORM set_config(
      'bold.purchase_accounting_document_write',
      'off',
      true
    );
  END IF;

  PERFORM set_config(
    'bold.inventory_cost_materialization_write',
    'on',
    true
  );
  UPDATE "ProductVariant"
  SET "cost_price" = next_cost
  WHERE "id" = p_variant_id;
  PERFORM set_config(
    'bold.inventory_cost_materialization_write',
    'off',
    true
  );

  RETURN movement_id;
END
$$;




CREATE OR REPLACE FUNCTION "protect_purchase_accounting_document"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting(
       'bold.purchase_accounting_maintenance',
       true
     ) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND current_setting(
       'bold.purchase_accounting_document_write',
       true
     ) = 'on' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    '% is an immutable posted accounting document',
    TG_TABLE_NAME;
END
$$;

CREATE TRIGGER "PurchaseInvoice_immutable"
BEFORE UPDATE OR DELETE ON "PurchaseInvoice"
FOR EACH ROW
EXECUTE FUNCTION "protect_purchase_accounting_document"();

CREATE TRIGGER "PurchaseInvoiceItem_immutable"
BEFORE UPDATE OR DELETE ON "PurchaseInvoiceItem"
FOR EACH ROW
EXECUTE FUNCTION "protect_purchase_accounting_document"();

CREATE TRIGGER "SupplierReturn_immutable"
BEFORE UPDATE OR DELETE ON "SupplierReturn"
FOR EACH ROW
EXECUTE FUNCTION "protect_purchase_accounting_document"();

CREATE TRIGGER "SupplierReturnItem_immutable"
BEFORE UPDATE OR DELETE ON "SupplierReturnItem"
FOR EACH ROW
EXECUTE FUNCTION "protect_purchase_accounting_document"();

CREATE OR REPLACE FUNCTION "record_customer_return_cost_movements"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  return_record "Return"%ROWTYPE;
  item RECORD;
BEGIN
  SELECT *
  INTO return_record
  FROM "Return"
  WHERE "id" = NEW."return_id";

  IF NOT FOUND OR return_record."status" <> 'completed' THEN
    RETURN NEW;
  END IF;

  -- A deferred row trigger fires once per line. The first invocation posts the
  -- complete return in deterministic variant order; later invocations become
  -- idempotent no-ops.
  IF EXISTS (
    SELECT 1
    FROM "InventoryCostMovement" movement
    WHERE movement."movement_type" = 'customer_return'
      AND movement."reference_type" = 'Return'
      AND movement."reference_id" = return_record."id"::text
  ) THEN
    RETURN NEW;
  END IF;

  FOR item IN
    SELECT
      line."variant_id",
      SUM(line."qty")::integer AS "qty",
      ROUND(
        SUM(line."unit_cost" * line."qty"),
        2
      )::numeric(18, 2) AS "movement_value"
    FROM "ReturnItem" line
    WHERE line."return_id" = return_record."id"
    GROUP BY line."variant_id"
    ORDER BY line."variant_id"
  LOOP
    PERFORM "record_inventory_cost_movement"(
      item."variant_id",
      return_record."branch_id",
      'customer_return'::"InventoryCostMovementType",
      item."qty",
      item."movement_value",
      'Return',
      return_record."id"::text,
      item."variant_id"::text,
      NULL,
      NULL,
      NULL,
      NULL,
      'customer-return-cost:'
        || return_record."id"::text
        || ':'
        || item."variant_id"::text,
      return_record."created_at",
      return_record."created_by",
      NULL,
      jsonb_build_object(
        'original_invoice_id',
        return_record."original_invoice_id",
        'return_invoice_number',
        return_record."return_invoice_number"
      )
    );
  END LOOP;

  RETURN NEW;
END
$$;

CREATE CONSTRAINT TRIGGER "ReturnItem_cost_movement"
AFTER INSERT ON "ReturnItem"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "record_customer_return_cost_movements"();

CREATE OR REPLACE FUNCTION "protect_product_variant_cost"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."cost_price" IS DISTINCT FROM OLD."cost_price"
     AND current_setting(
       'bold.inventory_cost_materialization_write',
       true
     ) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION
      'ProductVariant.cost_price is maintained by the inventory cost ledger';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "ProductVariant_cost_ledger_guard"
BEFORE UPDATE OF "cost_price" ON "ProductVariant"
FOR EACH ROW
EXECUTE FUNCTION "protect_product_variant_cost"();

CREATE OR REPLACE FUNCTION "protect_inventory_cost_movement"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('bold.inventory_cost_ledger_maintenance', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'InventoryCostMovement is append-only';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "InventoryCostMovement_append_only"
BEFORE UPDATE OR DELETE ON "InventoryCostMovement"
FOR EACH ROW
EXECUTE FUNCTION "protect_inventory_cost_movement"();
