BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "InventoryStock"
    WHERE "qty_on_hand" < 0
       OR "qty_reserved" < 0
       OR "qty_reserved" > "qty_on_hand"
  ) THEN
    RAISE EXCEPTION 'Inventory ledger migration blocked: invalid InventoryStock balances exist';
  END IF;
END
$$;

CREATE TYPE "InventoryMovementType" AS ENUM (
  'opening_balance',
  'sale',
  'return',
  'purchase_receipt',
  'transfer_out',
  'transfer_in',
  'adjustment',
  'stock_count',
  'reservation',
  'reservation_release',
  'cancellation',
  'reversal'
);

CREATE TABLE "InventoryMovement" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "branch_id" UUID NOT NULL,
  "variant_id" UUID NOT NULL,
  "movement_type" "InventoryMovementType" NOT NULL,
  "on_hand_delta" INTEGER NOT NULL,
  "reserved_delta" INTEGER NOT NULL DEFAULT 0,
  "on_hand_after" INTEGER NOT NULL,
  "reserved_after" INTEGER NOT NULL,
  "reference_type" VARCHAR(64) NOT NULL,
  "reference_id" VARCHAR(128) NOT NULL,
  "reference_line_id" VARCHAR(128),
  "idempotency_key" VARCHAR(191) NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  "metadata" JSONB,

  CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryMovement_idempotency_key_key" UNIQUE ("idempotency_key"),
  CONSTRAINT "InventoryMovement_nonzero_delta" CHECK (
    "on_hand_delta" <> 0 OR "reserved_delta" <> 0
  ),
  CONSTRAINT "InventoryMovement_nonnegative_balances" CHECK (
    "on_hand_after" >= 0 AND "reserved_after" >= 0
  ),
  CONSTRAINT "InventoryMovement_reserved_not_above_on_hand" CHECK (
    "reserved_after" <= "on_hand_after"
  )
);

ALTER TABLE "InventoryMovement"
  ADD CONSTRAINT "InventoryMovement_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "Branch"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryMovement_variant_id_fkey"
    FOREIGN KEY ("variant_id") REFERENCES "ProductVariant"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryMovement_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "InventoryMovement_branch_id_variant_id_occurred_at_idx"
  ON "InventoryMovement"("branch_id", "variant_id", "occurred_at");
CREATE INDEX "InventoryMovement_reference_type_reference_id_idx"
  ON "InventoryMovement"("reference_type", "reference_id");
CREATE INDEX "InventoryMovement_movement_type_occurred_at_idx"
  ON "InventoryMovement"("movement_type", "occurred_at");
CREATE INDEX "InventoryMovement_recorded_at_idx"
  ON "InventoryMovement"("recorded_at");
CREATE INDEX "InventoryMovement_created_by_occurred_at_idx"
  ON "InventoryMovement"("created_by", "occurred_at");

ALTER TABLE "InventoryStock"
  ADD CONSTRAINT "InventoryStock_qty_on_hand_nonnegative"
    CHECK ("qty_on_hand" >= 0),
  ADD CONSTRAINT "InventoryStock_qty_reserved_nonnegative"
    CHECK ("qty_reserved" >= 0),
  ADD CONSTRAINT "InventoryStock_reserved_not_above_on_hand"
    CHECK ("qty_reserved" <= "qty_on_hand");

INSERT INTO "InventoryMovement" (
  "branch_id",
  "variant_id",
  "movement_type",
  "on_hand_delta",
  "reserved_delta",
  "on_hand_after",
  "reserved_after",
  "reference_type",
  "reference_id",
  "idempotency_key",
  "occurred_at",
  "metadata"
)
SELECT
  stock."branch_id",
  stock."variant_id",
  'opening_balance'::"InventoryMovementType",
  stock."qty_on_hand",
  stock."qty_reserved",
  stock."qty_on_hand",
  stock."qty_reserved",
  'InventoryStock',
  stock."branch_id"::text || ':' || stock."variant_id"::text,
  'migration-opening:' || stock."branch_id"::text || ':' || stock."variant_id"::text,
  COALESCE(stock."last_sold_at", CURRENT_TIMESTAMP),
  jsonb_build_object(
    'source', '202607220002_inventory_movement_ledger',
    'reason', 'pre-ledger balance snapshot'
  )
FROM "InventoryStock" stock
WHERE stock."qty_on_hand" <> 0
   OR stock."qty_reserved" <> 0;

CREATE OR REPLACE FUNCTION "record_inventory_movement"(
  p_branch_id UUID,
  p_variant_id UUID,
  p_movement_type "InventoryMovementType",
  p_on_hand_delta INTEGER,
  p_reserved_delta INTEGER,
  p_reference_type TEXT,
  p_reference_id TEXT,
  p_reference_line_id TEXT,
  p_idempotency_key TEXT,
  p_occurred_at TIMESTAMP(3),
  p_created_by UUID,
  p_metadata JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  existing "InventoryMovement"%ROWTYPE;
  existing_found BOOLEAN := false;
  current_on_hand INTEGER;
  current_reserved INTEGER;
  movement_count BIGINT;
  ledger_on_hand BIGINT;
  ledger_reserved BIGINT;
  previous_on_hand BIGINT;
  previous_reserved BIGINT;
  movement_id UUID;
BEGIN
  IF p_on_hand_delta = 0 AND p_reserved_delta = 0 THEN
    RAISE EXCEPTION 'Inventory movement must change on-hand or reserved quantity';
  END IF;

  SELECT *
  INTO existing
  FROM "InventoryMovement"
  WHERE "idempotency_key" = p_idempotency_key;
  existing_found := FOUND;

  SELECT stock."qty_on_hand", stock."qty_reserved"
  INTO current_on_hand, current_reserved
  FROM "InventoryStock" stock
  WHERE stock."branch_id" = p_branch_id
    AND stock."variant_id" = p_variant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'InventoryStock row does not exist for branch % and variant %', p_branch_id, p_variant_id;
  END IF;

  SELECT
    COUNT(*),
    COALESCE(SUM(movement."on_hand_delta"), 0),
    COALESCE(SUM(movement."reserved_delta"), 0)
  INTO movement_count, ledger_on_hand, ledger_reserved
  FROM "InventoryMovement" movement
  WHERE movement."branch_id" = p_branch_id
    AND movement."variant_id" = p_variant_id;

  IF existing_found THEN
    IF existing."branch_id" <> p_branch_id
       OR existing."variant_id" <> p_variant_id
       OR existing."movement_type" <> p_movement_type
       OR existing."on_hand_delta" <> p_on_hand_delta
       OR existing."reserved_delta" <> p_reserved_delta
       OR existing."reference_type" <> p_reference_type
       OR existing."reference_id" <> p_reference_id
       OR existing."reference_line_id" IS DISTINCT FROM p_reference_line_id THEN
      RAISE EXCEPTION 'Inventory movement idempotency key belongs to a different command: %', p_idempotency_key;
    END IF;

    IF ledger_on_hand <> current_on_hand OR ledger_reserved <> current_reserved THEN
      RAISE EXCEPTION
        'Inventory ledger mismatch after idempotent replay for branch % variant %: ledger=(%,%), stock=(%,%)',
        p_branch_id,
        p_variant_id,
        ledger_on_hand,
        ledger_reserved,
        current_on_hand,
        current_reserved;
    END IF;
    RETURN existing."id";
  END IF;

  IF movement_count = 0 THEN
    previous_on_hand := current_on_hand::BIGINT - p_on_hand_delta::BIGINT;
    previous_reserved := current_reserved::BIGINT - p_reserved_delta::BIGINT;

    IF previous_on_hand < 0
       OR previous_reserved < 0
       OR previous_reserved > previous_on_hand
       OR previous_on_hand > 2147483647
       OR previous_reserved > 2147483647 THEN
      RAISE EXCEPTION 'Cannot infer a valid opening inventory balance for branch % and variant %', p_branch_id, p_variant_id;
    END IF;

    IF previous_on_hand <> 0 OR previous_reserved <> 0 THEN
      INSERT INTO "InventoryMovement" (
        "branch_id",
        "variant_id",
        "movement_type",
        "on_hand_delta",
        "reserved_delta",
        "on_hand_after",
        "reserved_after",
        "reference_type",
        "reference_id",
        "idempotency_key",
        "occurred_at",
        "metadata"
      ) VALUES (
        p_branch_id,
        p_variant_id,
        'opening_balance',
        previous_on_hand::INTEGER,
        previous_reserved::INTEGER,
        previous_on_hand::INTEGER,
        previous_reserved::INTEGER,
        'InventoryStock',
        p_branch_id::text || ':' || p_variant_id::text,
        'auto-opening:' || p_branch_id::text || ':' || p_variant_id::text,
        p_occurred_at,
        jsonb_build_object(
          'reason', 'first post-ledger movement on an uninitialized stock row'
        )
      )
      ON CONFLICT ("idempotency_key") DO NOTHING;
    END IF;

    ledger_on_hand := previous_on_hand;
    ledger_reserved := previous_reserved;
  END IF;

  IF ledger_on_hand + p_on_hand_delta <> current_on_hand
     OR ledger_reserved + p_reserved_delta <> current_reserved THEN
    RAISE EXCEPTION
      'Inventory ledger mismatch for branch % variant %: ledger=(%,%), delta=(%,%), stock=(%,%)',
      p_branch_id,
      p_variant_id,
      ledger_on_hand,
      ledger_reserved,
      p_on_hand_delta,
      p_reserved_delta,
      current_on_hand,
      current_reserved;
  END IF;

  INSERT INTO "InventoryMovement" (
    "branch_id",
    "variant_id",
    "movement_type",
    "on_hand_delta",
    "reserved_delta",
    "on_hand_after",
    "reserved_after",
    "reference_type",
    "reference_id",
    "reference_line_id",
    "idempotency_key",
    "occurred_at",
    "created_by",
    "metadata"
  ) VALUES (
    p_branch_id,
    p_variant_id,
    p_movement_type,
    p_on_hand_delta,
    p_reserved_delta,
    current_on_hand,
    current_reserved,
    p_reference_type,
    p_reference_id,
    p_reference_line_id,
    p_idempotency_key,
    p_occurred_at,
    p_created_by,
    p_metadata
  )
  RETURNING "id" INTO movement_id;

  RETURN movement_id;
END
$$;

CREATE OR REPLACE FUNCTION "record_sale_inventory_movement"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  invoice_branch_id UUID;
  invoice_number TEXT;
  invoice_sync_id UUID;
  invoice_occurred_at TIMESTAMP(3);
  invoice_cashier_id UUID;
BEGIN
  SELECT
    invoice."branch_id",
    invoice."invoice_number",
    invoice."sync_id",
    invoice."occurred_at",
    invoice."cashier_id"
  INTO
    invoice_branch_id,
    invoice_number,
    invoice_sync_id,
    invoice_occurred_at,
    invoice_cashier_id
  FROM "SalesInvoice" invoice
  WHERE invoice."id" = NEW."sales_invoice_id";

  -- Historical/imported invoices without a sync id did not mutate stock through
  -- the current POS command path and are represented by the migration opening balance.
  IF invoice_sync_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM "record_inventory_movement"(
    invoice_branch_id,
    NEW."variant_id",
    'sale',
    -NEW."qty",
    0,
    'SalesInvoice',
    NEW."sales_invoice_id"::text,
    NEW."id"::text,
    'sale:' || NEW."id"::text,
    invoice_occurred_at,
    invoice_cashier_id,
    jsonb_build_object(
      'invoice_number', invoice_number,
      'sync_id', invoice_sync_id
    )
  );

  RETURN NEW;
END
$$;

CREATE CONSTRAINT TRIGGER "SalesInvoiceItem_inventory_movement"
AFTER INSERT ON "SalesInvoiceItem"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "record_sale_inventory_movement"();

CREATE OR REPLACE FUNCTION "record_return_inventory_movement"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  return_branch_id UUID;
  return_number TEXT;
  return_status "ReturnStatus";
  return_created_at TIMESTAMP(3);
  return_created_by UUID;
  original_invoice_id UUID;
BEGIN
  SELECT
    return_record."branch_id",
    return_record."return_invoice_number",
    return_record."status",
    return_record."created_at",
    return_record."created_by",
    return_record."original_invoice_id"
  INTO
    return_branch_id,
    return_number,
    return_status,
    return_created_at,
    return_created_by,
    original_invoice_id
  FROM "Return" return_record
  WHERE return_record."id" = NEW."return_id";

  IF return_status <> 'completed' THEN
    RETURN NEW;
  END IF;

  PERFORM "record_inventory_movement"(
    return_branch_id,
    NEW."variant_id",
    'return',
    NEW."qty",
    0,
    'Return',
    NEW."return_id"::text,
    NEW."id"::text,
    'return:' || NEW."id"::text,
    return_created_at,
    return_created_by,
    jsonb_build_object(
      'return_invoice_number', return_number,
      'original_invoice_id', original_invoice_id
    )
  );

  RETURN NEW;
END
$$;

CREATE CONSTRAINT TRIGGER "ReturnItem_inventory_movement"
AFTER INSERT ON "ReturnItem"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "record_return_inventory_movement"();

CREATE OR REPLACE FUNCTION "record_transfer_inventory_movement"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  item RECORD;
BEGIN
  IF OLD."status" = 'pending' AND NEW."status" = 'shipped' THEN
    FOR item IN
      SELECT transfer_item."id", transfer_item."variant_id", transfer_item."qty"
      FROM "TransferItem" transfer_item
      WHERE transfer_item."transfer_id" = NEW."id"
    LOOP
      PERFORM "record_inventory_movement"(
        NEW."from_branch_id",
        item."variant_id",
        'transfer_out',
        -item."qty",
        0,
        'Transfer',
        NEW."id"::text,
        item."id"::text,
        'transfer-out:' || item."id"::text,
        COALESCE(NEW."shipped_at", CURRENT_TIMESTAMP),
        NEW."shipped_by",
        jsonb_build_object(
          'transfer_number', NEW."transfer_number",
          'from_branch_id', NEW."from_branch_id",
          'to_branch_id', NEW."to_branch_id"
        )
      );
    END LOOP;
  ELSIF OLD."status" = 'shipped' AND NEW."status" = 'received' THEN
    FOR item IN
      SELECT transfer_item."id", transfer_item."variant_id", transfer_item."qty"
      FROM "TransferItem" transfer_item
      WHERE transfer_item."transfer_id" = NEW."id"
    LOOP
      PERFORM "record_inventory_movement"(
        NEW."to_branch_id",
        item."variant_id",
        'transfer_in',
        item."qty",
        0,
        'Transfer',
        NEW."id"::text,
        item."id"::text,
        'transfer-in:' || item."id"::text,
        COALESCE(NEW."received_at", CURRENT_TIMESTAMP),
        NEW."received_by",
        jsonb_build_object(
          'transfer_number', NEW."transfer_number",
          'from_branch_id', NEW."from_branch_id",
          'to_branch_id', NEW."to_branch_id"
        )
      );
    END LOOP;
  END IF;

  RETURN NEW;
END
$$;

CREATE CONSTRAINT TRIGGER "Transfer_inventory_movement"
AFTER UPDATE ON "Transfer"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "record_transfer_inventory_movement"();

CREATE OR REPLACE FUNCTION "protect_inventory_movement_append_only"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('bold.inventory_ledger_maintenance', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'InventoryMovement is append-only; create a reversal movement instead';
END
$$;

CREATE TRIGGER "InventoryMovement_append_only"
BEFORE UPDATE OR DELETE ON "InventoryMovement"
FOR EACH ROW
EXECUTE FUNCTION "protect_inventory_movement_append_only"();

COMMIT;
