-- This migration intentionally does not use an explicit transaction.
-- PostgreSQL requires a newly added enum value to be committed before
-- it can be referenced by later statements in the same migration.


-- Problem 5: immutable transfer commands, explicit in-transit custody and
-- deterministic partial receipt resolution.
DO $$
DECLARE
  invalid_transfer UUID;
BEGIN
  SELECT transfer."id"
  INTO invalid_transfer
  FROM "Transfer" transfer
  WHERE transfer."from_branch_id" = transfer."to_branch_id"
  LIMIT 1;

  IF invalid_transfer IS NOT NULL THEN
    RAISE EXCEPTION
      'Transfer state migration blocked: transfer % uses the same source and destination branch',
      invalid_transfer;
  END IF;

  SELECT item."transfer_id"
  INTO invalid_transfer
  FROM "TransferItem" item
  WHERE item."qty" <= 0
  LIMIT 1;

  IF invalid_transfer IS NOT NULL THEN
    RAISE EXCEPTION
      'Transfer state migration blocked: transfer % contains a non-positive quantity',
      invalid_transfer;
  END IF;

  SELECT item."transfer_id"
  INTO invalid_transfer
  FROM "TransferItem" item
  GROUP BY item."transfer_id", item."variant_id"
  HAVING COUNT(*) > 1
  LIMIT 1;

  IF invalid_transfer IS NOT NULL THEN
    RAISE EXCEPTION
      'Transfer state migration blocked: transfer % contains duplicate variant lines',
      invalid_transfer;
  END IF;
END
$$;

ALTER TYPE "TransferStatus" ADD VALUE IF NOT EXISTS 'partially_received';

CREATE TYPE "TransferCommandType" AS ENUM ('ship', 'receive', 'cancel');
CREATE TYPE "TransferTransitMovementType" AS ENUM (
  'shipped',
  'received',
  'damaged',
  'missing',
  'correction'
);

CREATE SEQUENCE IF NOT EXISTS "TransferNumberSequence" START 1;

ALTER TABLE "Transfer"
  ADD COLUMN "idempotency_key" VARCHAR(191),
  ADD COLUMN "command_fingerprint" VARCHAR(64),
  ADD COLUMN "cancelled_by" UUID,
  ADD COLUMN "cancelled_at" TIMESTAMP(3),
  ADD COLUMN "cancellation_reason" VARCHAR(500),
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "Transfer"
SET
  "updated_at" = COALESCE("received_at", "shipped_at", "created_at"),
  "cancelled_by" = CASE
    WHEN "status" = 'cancelled' THEN COALESCE("cancelled_by", "created_by")
    ELSE NULL
  END,
  "cancelled_at" = CASE
    WHEN "status" = 'cancelled' THEN COALESCE("cancelled_at", "created_at")
    ELSE NULL
  END,
  "cancellation_reason" = CASE
    WHEN "status" = 'cancelled' THEN COALESCE(
      NULLIF(BTRIM("cancellation_reason"), ''),
      'Legacy cancellation migrated without an original reason'
    )
    ELSE NULL
  END;

ALTER TABLE "Transfer"
  ADD CONSTRAINT "Transfer_distinct_branches"
    CHECK ("from_branch_id" <> "to_branch_id"),
  ADD CONSTRAINT "Transfer_creation_identity"
    CHECK (
      (
        "idempotency_key" IS NULL
        AND "command_fingerprint" IS NULL
      )
      OR
      (
        "idempotency_key" IS NOT NULL
        AND CHAR_LENGTH("idempotency_key") > 0
        AND CHAR_LENGTH("command_fingerprint") = 64
      )
    ),
  ADD CONSTRAINT "Transfer_cancellation_fields"
    CHECK (
      (
        "status" = 'cancelled'
        AND "cancelled_at" IS NOT NULL
        AND "cancellation_reason" IS NOT NULL
        AND CHAR_LENGTH(BTRIM("cancellation_reason")) > 0
      )
      OR
      (
        "status" <> 'cancelled'
        AND "cancelled_by" IS NULL
        AND "cancelled_at" IS NULL
        AND "cancellation_reason" IS NULL
      )
    );

CREATE INDEX "Transfer_status_updated_at_idx"
  ON "Transfer"("status", "updated_at");

CREATE UNIQUE INDEX "Transfer_idempotency_key_key"
  ON "Transfer"("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

ALTER TABLE "Transfer"
  ADD CONSTRAINT "Transfer_cancelled_by_fkey"
  FOREIGN KEY ("cancelled_by") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TransferItem"
  ADD COLUMN "shipped_qty" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "received_qty" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "damaged_qty" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "missing_qty" INTEGER NOT NULL DEFAULT 0;

UPDATE "TransferItem" item
SET "shipped_qty" = item."qty"
FROM "Transfer" transfer
WHERE transfer."id" = item."transfer_id"
  AND transfer."status" IN ('shipped', 'received');

UPDATE "TransferItem" item
SET "received_qty" = item."qty"
FROM "Transfer" transfer
WHERE transfer."id" = item."transfer_id"
  AND transfer."status" = 'received';

ALTER TABLE "TransferItem"
  ADD CONSTRAINT "TransferItem_qty_positive" CHECK ("qty" > 0),
  ADD CONSTRAINT "TransferItem_shipped_qty_range"
    CHECK ("shipped_qty" >= 0 AND "shipped_qty" <= "qty"),
  ADD CONSTRAINT "TransferItem_resolution_nonnegative"
    CHECK (
      "received_qty" >= 0 AND "damaged_qty" >= 0 AND "missing_qty" >= 0
    ),
  ADD CONSTRAINT "TransferItem_resolution_not_above_shipped"
    CHECK (
      "received_qty" + "damaged_qty" + "missing_qty" <= "shipped_qty"
    );

CREATE UNIQUE INDEX "TransferItem_transfer_id_variant_id_key"
  ON "TransferItem"("transfer_id", "variant_id");

CREATE TABLE "TransferCommand" (
  "id" UUID NOT NULL,
  "transfer_id" UUID NOT NULL,
  "command_type" "TransferCommandType" NOT NULL,
  "idempotency_key" VARCHAR(191) NOT NULL,
  "command_fingerprint" VARCHAR(64) NOT NULL,
  "result_status" VARCHAR(32) NOT NULL,
  "created_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TransferCommand_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TransferCommand_idempotency_key_key"
    UNIQUE ("idempotency_key"),
  CONSTRAINT "TransferCommand_transfer_id_fkey"
    FOREIGN KEY ("transfer_id") REFERENCES "Transfer"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TransferCommand_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "TransferCommand_identity_contract"
    CHECK (
      CHAR_LENGTH("idempotency_key") > 0
      AND CHAR_LENGTH("command_fingerprint") = 64
      AND CHAR_LENGTH("result_status") > 0
    )
);

CREATE INDEX "TransferCommand_transfer_id_created_at_idx"
  ON "TransferCommand"("transfer_id", "created_at");

CREATE TABLE "TransferTransitMovement" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sequence" BIGSERIAL NOT NULL,
  "transfer_id" UUID NOT NULL,
  "transfer_item_id" UUID NOT NULL,
  "variant_id" UUID NOT NULL,
  "movement_type" "TransferTransitMovementType" NOT NULL,
  "quantity_delta" INTEGER NOT NULL,
  "in_transit_after" INTEGER NOT NULL,
  "idempotency_key" VARCHAR(191) NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  "metadata" JSONB,
  CONSTRAINT "TransferTransitMovement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TransferTransitMovement_sequence_key" UNIQUE ("sequence"),
  CONSTRAINT "TransferTransitMovement_idempotency_key_key"
    UNIQUE ("idempotency_key"),
  CONSTRAINT "TransferTransitMovement_nonzero_delta"
    CHECK ("quantity_delta" <> 0),
  CONSTRAINT "TransferTransitMovement_nonnegative_balance"
    CHECK ("in_transit_after" >= 0),
  CONSTRAINT "TransferTransitMovement_identity_contract"
    CHECK (CHAR_LENGTH("idempotency_key") > 0),
  CONSTRAINT "TransferTransitMovement_transfer_id_fkey"
    FOREIGN KEY ("transfer_id") REFERENCES "Transfer"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TransferTransitMovement_transfer_item_id_fkey"
    FOREIGN KEY ("transfer_item_id") REFERENCES "TransferItem"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TransferTransitMovement_variant_id_fkey"
    FOREIGN KEY ("variant_id") REFERENCES "ProductVariant"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TransferTransitMovement_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "TransferTransitMovement_transfer_sequence_idx"
  ON "TransferTransitMovement"("transfer_id", "sequence");
CREATE INDEX "TransferTransitMovement_item_sequence_idx"
  ON "TransferTransitMovement"("transfer_item_id", "sequence");
CREATE INDEX "TransferTransitMovement_variant_sequence_idx"
  ON "TransferTransitMovement"("variant_id", "sequence");

DROP TRIGGER IF EXISTS "Transfer_inventory_movement" ON "Transfer";
DROP FUNCTION IF EXISTS "record_transfer_inventory_movement"();

CREATE OR REPLACE FUNCTION "record_transfer_item_movements"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  transfer_record "Transfer"%ROWTYPE;
  shipped_delta INTEGER;
  received_delta INTEGER;
  damaged_delta INTEGER;
  missing_delta INTEGER;
  transit_cursor INTEGER;
  final_transit INTEGER;
BEGIN
  SELECT * INTO transfer_record
  FROM "Transfer"
  WHERE "id" = NEW."transfer_id";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer % does not exist', NEW."transfer_id";
  END IF;

  shipped_delta := NEW."shipped_qty" - OLD."shipped_qty";
  received_delta := NEW."received_qty" - OLD."received_qty";
  damaged_delta := NEW."damaged_qty" - OLD."damaged_qty";
  missing_delta := NEW."missing_qty" - OLD."missing_qty";

  IF shipped_delta < 0
     OR received_delta < 0
     OR damaged_delta < 0
     OR missing_delta < 0 THEN
    RAISE EXCEPTION
      'Transfer item cumulative quantities cannot decrease outside a correction workflow';
  END IF;

  IF shipped_delta > 0
     AND transfer_record."status"::text NOT IN (
       'shipped',
       'partially_received',
       'received'
     ) THEN
    RAISE EXCEPTION
      'Transfer item shipment requires a shipped transfer state';
  END IF;

  IF (received_delta > 0 OR damaged_delta > 0 OR missing_delta > 0)
     AND transfer_record."status"::text NOT IN (
       'partially_received',
       'received'
     ) THEN
    RAISE EXCEPTION
      'Transfer item resolution requires a receiving transfer state';
  END IF;

  transit_cursor :=
    OLD."shipped_qty" - OLD."received_qty" -
    OLD."damaged_qty" - OLD."missing_qty";
  final_transit :=
    NEW."shipped_qty" - NEW."received_qty" -
    NEW."damaged_qty" - NEW."missing_qty";

  IF shipped_delta > 0 THEN
    transit_cursor := transit_cursor + shipped_delta;

    PERFORM "record_inventory_movement"(
      transfer_record."from_branch_id"::uuid,
      NEW."variant_id"::uuid,
      'transfer_out'::"InventoryMovementType",
      (-shipped_delta)::integer,
      0::integer,
      'Transfer'::text,
      NEW."transfer_id"::text,
      NEW."id"::text,
      (
        'transfer-out:' || NEW."id"::text || ':' ||
        NEW."shipped_qty"::text
      )::text,
      COALESCE(
        transfer_record."shipped_at",
        CURRENT_TIMESTAMP::timestamp(3)
      )::timestamp(3),
      transfer_record."shipped_by"::uuid,
      jsonb_build_object(
        'transfer_number', transfer_record."transfer_number"
      )::jsonb
    );

    INSERT INTO "TransferTransitMovement" (
      "transfer_id", "transfer_item_id", "variant_id", "movement_type",
      "quantity_delta", "in_transit_after", "idempotency_key",
      "occurred_at", "created_by", "metadata"
    ) VALUES (
      NEW."transfer_id",
      NEW."id",
      NEW."variant_id",
      'shipped'::"TransferTransitMovementType",
      shipped_delta,
      transit_cursor,
      'transit-shipped:' || NEW."id"::text || ':' || NEW."shipped_qty"::text,
      COALESCE(
        transfer_record."shipped_at",
        CURRENT_TIMESTAMP::timestamp(3)
      )::timestamp(3),
      transfer_record."shipped_by",
      jsonb_build_object(
        'transfer_number', transfer_record."transfer_number"
      )
    );
  END IF;

  IF received_delta > 0 THEN
    transit_cursor := transit_cursor - received_delta;

    PERFORM "record_inventory_movement"(
      transfer_record."to_branch_id"::uuid,
      NEW."variant_id"::uuid,
      'transfer_in'::"InventoryMovementType",
      received_delta::integer,
      0::integer,
      'Transfer'::text,
      NEW."transfer_id"::text,
      NEW."id"::text,
      (
        'transfer-in:' || NEW."id"::text || ':' ||
        NEW."received_qty"::text
      )::text,
      CURRENT_TIMESTAMP::timestamp(3),
      transfer_record."received_by"::uuid,
      jsonb_build_object(
        'transfer_number', transfer_record."transfer_number"
      )::jsonb
    );

    INSERT INTO "TransferTransitMovement" (
      "transfer_id", "transfer_item_id", "variant_id", "movement_type",
      "quantity_delta", "in_transit_after", "idempotency_key",
      "occurred_at", "created_by"
    ) VALUES (
      NEW."transfer_id",
      NEW."id",
      NEW."variant_id",
      'received'::"TransferTransitMovementType",
      -received_delta,
      transit_cursor,
      'transit-received:' || NEW."id"::text || ':' || NEW."received_qty"::text,
      CURRENT_TIMESTAMP::timestamp(3),
      transfer_record."received_by"
    );
  END IF;

  IF damaged_delta > 0 THEN
    transit_cursor := transit_cursor - damaged_delta;

    INSERT INTO "TransferTransitMovement" (
      "transfer_id", "transfer_item_id", "variant_id", "movement_type",
      "quantity_delta", "in_transit_after", "idempotency_key",
      "occurred_at", "created_by"
    ) VALUES (
      NEW."transfer_id",
      NEW."id",
      NEW."variant_id",
      'damaged'::"TransferTransitMovementType",
      -damaged_delta,
      transit_cursor,
      'transit-damaged:' || NEW."id"::text || ':' || NEW."damaged_qty"::text,
      CURRENT_TIMESTAMP::timestamp(3),
      transfer_record."received_by"
    );
  END IF;

  IF missing_delta > 0 THEN
    transit_cursor := transit_cursor - missing_delta;

    INSERT INTO "TransferTransitMovement" (
      "transfer_id", "transfer_item_id", "variant_id", "movement_type",
      "quantity_delta", "in_transit_after", "idempotency_key",
      "occurred_at", "created_by"
    ) VALUES (
      NEW."transfer_id",
      NEW."id",
      NEW."variant_id",
      'missing'::"TransferTransitMovementType",
      -missing_delta,
      transit_cursor,
      'transit-missing:' || NEW."id"::text || ':' || NEW."missing_qty"::text,
      CURRENT_TIMESTAMP::timestamp(3),
      transfer_record."received_by"
    );
  END IF;

  IF transit_cursor <> final_transit THEN
    RAISE EXCEPTION
      'Transfer transit balance mismatch for item %: calculated %, materialized %',
      NEW."id",
      transit_cursor,
      final_transit;
  END IF;

  RETURN NEW;
END
$$;

CREATE CONSTRAINT TRIGGER "TransferItem_inventory_and_transit_movements"
AFTER UPDATE OF "shipped_qty", "received_qty", "damaged_qty", "missing_qty"
ON "TransferItem"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "record_transfer_item_movements"();

INSERT INTO "TransferTransitMovement" (
  "transfer_id", "transfer_item_id", "variant_id", "movement_type",
  "quantity_delta", "in_transit_after", "idempotency_key",
  "occurred_at", "created_by", "metadata"
)
SELECT
  item."transfer_id",
  item."id",
  item."variant_id",
  'shipped',
  item."shipped_qty",
  item."shipped_qty",
  'migration-transit-shipped:' || item."id"::text,
  COALESCE(transfer."shipped_at", transfer."created_at"),
  transfer."shipped_by",
  jsonb_build_object('source', '202607230002_transfer_state_machine')
FROM "TransferItem" item
JOIN "Transfer" transfer ON transfer."id" = item."transfer_id"
WHERE item."shipped_qty" > 0;

INSERT INTO "TransferTransitMovement" (
  "transfer_id", "transfer_item_id", "variant_id", "movement_type",
  "quantity_delta", "in_transit_after", "idempotency_key",
  "occurred_at", "created_by", "metadata"
)
SELECT
  item."transfer_id",
  item."id",
  item."variant_id",
  'received',
  -item."received_qty",
  item."shipped_qty" - item."received_qty",
  'migration-transit-received:' || item."id"::text,
  COALESCE(transfer."received_at", transfer."created_at"),
  transfer."received_by",
  jsonb_build_object('source', '202607230002_transfer_state_machine')
FROM "TransferItem" item
JOIN "Transfer" transfer ON transfer."id" = item."transfer_id"
WHERE item."received_qty" > 0;

CREATE OR REPLACE FUNCTION "protect_transfer_posted_documents"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  item_count BIGINT;
  incomplete_shipment_count BIGINT;
  resolved_quantity BIGINT;
  outstanding_quantity BIGINT;
BEGIN
  IF current_setting('bold.transfer_maintenance', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF current_setting('bold.transfer_command', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION
      'Transfer documents are immutable outside the transfer command service';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'Transfer documents cannot be deleted by a transfer command';
  END IF;

  IF TG_TABLE_NAME = 'Transfer' THEN
    IF OLD."from_branch_id" IS DISTINCT FROM NEW."from_branch_id"
       OR OLD."to_branch_id" IS DISTINCT FROM NEW."to_branch_id"
       OR OLD."transfer_number" IS DISTINCT FROM NEW."transfer_number"
       OR OLD."idempotency_key" IS DISTINCT FROM NEW."idempotency_key"
       OR OLD."command_fingerprint" IS DISTINCT FROM NEW."command_fingerprint"
       OR OLD."created_by" IS DISTINCT FROM NEW."created_by"
       OR OLD."created_at" IS DISTINCT FROM NEW."created_at" THEN
      RAISE EXCEPTION 'Transfer identity fields are immutable';
    END IF;

    IF OLD."status"::text IS DISTINCT FROM NEW."status"::text
       AND NOT (
         (
           OLD."status"::text = 'pending'
           AND NEW."status"::text IN ('shipped', 'cancelled')
         )
         OR
         (
           OLD."status"::text = 'shipped'
           AND NEW."status"::text IN ('partially_received', 'received')
         )
         OR
         (
           OLD."status"::text = 'partially_received'
           AND NEW."status"::text = 'received'
         )
       ) THEN
      RAISE EXCEPTION
        'Invalid transfer state transition from % to %',
        OLD."status"::text,
        NEW."status"::text;
    END IF;

    SELECT
      COUNT(*),
      COUNT(*) FILTER (WHERE item."shipped_qty" <> item."qty"),
      COALESCE(SUM(
        item."received_qty" + item."damaged_qty" + item."missing_qty"
      ), 0),
      COALESCE(SUM(
        item."shipped_qty" - item."received_qty" -
        item."damaged_qty" - item."missing_qty"
      ), 0)
    INTO
      item_count,
      incomplete_shipment_count,
      resolved_quantity,
      outstanding_quantity
    FROM "TransferItem" item
    WHERE item."transfer_id" = NEW."id";

    IF item_count = 0 THEN
      RAISE EXCEPTION 'Transfer must contain at least one item';
    END IF;

    IF NEW."status"::text IN (
         'pending',
         'cancelled'
       )
       AND (resolved_quantity <> 0 OR outstanding_quantity <> 0) THEN
      RAISE EXCEPTION
        'Pending or cancelled transfers cannot contain materialized custody quantities';
    ELSIF NEW."status"::text = 'shipped'
       AND (
         incomplete_shipment_count <> 0
         OR resolved_quantity <> 0
         OR outstanding_quantity <= 0
       ) THEN
      RAISE EXCEPTION
        'Shipped transfer items must be fully shipped and unresolved';
    ELSIF NEW."status"::text = 'partially_received'
       AND (
         incomplete_shipment_count <> 0
         OR resolved_quantity <= 0
         OR outstanding_quantity <= 0
       ) THEN
      RAISE EXCEPTION
        'Partially received transfer must have resolved and outstanding units';
    ELSIF NEW."status"::text = 'received'
       AND (
         incomplete_shipment_count <> 0
         OR outstanding_quantity <> 0
       ) THEN
      RAISE EXCEPTION
        'Received transfer must resolve every shipped unit';
    END IF;
  ELSIF TG_TABLE_NAME = 'TransferItem' THEN
    IF OLD."transfer_id" IS DISTINCT FROM NEW."transfer_id"
       OR OLD."variant_id" IS DISTINCT FROM NEW."variant_id"
       OR OLD."qty" IS DISTINCT FROM NEW."qty" THEN
      RAISE EXCEPTION 'Transfer item identity and requested quantity are immutable';
    END IF;

    IF NEW."shipped_qty" < OLD."shipped_qty"
       OR NEW."received_qty" < OLD."received_qty"
       OR NEW."damaged_qty" < OLD."damaged_qty"
       OR NEW."missing_qty" < OLD."missing_qty" THEN
      RAISE EXCEPTION 'Transfer item cumulative quantities cannot decrease';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "Transfer_protect_posted_document"
BEFORE UPDATE OR DELETE ON "Transfer"
FOR EACH ROW EXECUTE FUNCTION "protect_transfer_posted_documents"();

CREATE TRIGGER "TransferItem_protect_posted_document"
BEFORE UPDATE OR DELETE ON "TransferItem"
FOR EACH ROW EXECUTE FUNCTION "protect_transfer_posted_documents"();

CREATE OR REPLACE FUNCTION "protect_transfer_append_only_record"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('bold.transfer_maintenance', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION
    '% is append-only; create a new transfer command or correction movement',
    TG_TABLE_NAME;
END
$$;

CREATE TRIGGER "TransferCommand_append_only"
BEFORE UPDATE OR DELETE ON "TransferCommand"
FOR EACH ROW EXECUTE FUNCTION "protect_transfer_append_only_record"();

CREATE TRIGGER "TransferTransitMovement_append_only"
BEFORE UPDATE OR DELETE ON "TransferTransitMovement"
FOR EACH ROW EXECUTE FUNCTION "protect_transfer_append_only_record"();


-- Keep Problem 4 global moving-average cost correct while stock is in transit.
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

  -- Global moving-average ownership includes stock currently held by a
  -- branch plus unresolved units in transit between branches.
  SELECT
    COALESCE((
      SELECT SUM(stock."qty_on_hand")
      FROM "InventoryStock" stock
      WHERE stock."variant_id" = p_variant_id
    ), 0)
    +
    COALESCE((
      SELECT SUM(
        item."shipped_qty" - item."received_qty" -
        item."damaged_qty" - item."missing_qty"
      )
      FROM "TransferItem" item
      WHERE item."variant_id" = p_variant_id
    ), 0)
  INTO current_quantity_big;

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
