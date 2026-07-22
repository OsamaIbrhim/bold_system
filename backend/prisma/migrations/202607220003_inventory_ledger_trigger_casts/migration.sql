BEGIN;

-- PostgreSQL resolves trigger-time string literals as unknown and
-- COALESCE(timestamp, CURRENT_TIMESTAMP) as timestamptz. The ledger writer
-- intentionally accepts the Prisma/PostgreSQL timestamp(3) representation,
-- so every trigger argument is cast to the exact function signature.
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

  IF invoice_sync_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM "record_inventory_movement"(
    invoice_branch_id::uuid,
    NEW."variant_id"::uuid,
    'sale'::"InventoryMovementType",
    (-NEW."qty")::integer,
    0::integer,
    'SalesInvoice'::text,
    NEW."sales_invoice_id"::text,
    NEW."id"::text,
    ('sale:' || NEW."id"::text)::text,
    invoice_occurred_at::timestamp(3),
    invoice_cashier_id::uuid,
    jsonb_build_object(
      'invoice_number', invoice_number,
      'sync_id', invoice_sync_id
    )::jsonb
  );

  RETURN NEW;
END
$$;

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

  IF return_status <> 'completed'::"ReturnStatus" THEN
    RETURN NEW;
  END IF;

  PERFORM "record_inventory_movement"(
    return_branch_id::uuid,
    NEW."variant_id"::uuid,
    'return'::"InventoryMovementType",
    NEW."qty"::integer,
    0::integer,
    'Return'::text,
    NEW."return_id"::text,
    NEW."id"::text,
    ('return:' || NEW."id"::text)::text,
    return_created_at::timestamp(3),
    return_created_by::uuid,
    jsonb_build_object(
      'return_invoice_number', return_number,
      'original_invoice_id', original_invoice_id
    )::jsonb
  );

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION "record_transfer_inventory_movement"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  item RECORD;
BEGIN
  IF OLD."status" = 'pending'::"TransferStatus"
     AND NEW."status" = 'shipped'::"TransferStatus" THEN
    FOR item IN
      SELECT
        transfer_item."id",
        transfer_item."variant_id",
        transfer_item."qty"
      FROM "TransferItem" transfer_item
      WHERE transfer_item."transfer_id" = NEW."id"
    LOOP
      PERFORM "record_inventory_movement"(
        NEW."from_branch_id"::uuid,
        item."variant_id"::uuid,
        'transfer_out'::"InventoryMovementType",
        (-item."qty")::integer,
        0::integer,
        'Transfer'::text,
        NEW."id"::text,
        item."id"::text,
        ('transfer-out:' || item."id"::text)::text,
        COALESCE(
          NEW."shipped_at",
          CURRENT_TIMESTAMP::timestamp(3)
        )::timestamp(3),
        NEW."shipped_by"::uuid,
        jsonb_build_object(
          'transfer_number', NEW."transfer_number",
          'from_branch_id', NEW."from_branch_id",
          'to_branch_id', NEW."to_branch_id"
        )::jsonb
      );
    END LOOP;
  ELSIF OLD."status" = 'shipped'::"TransferStatus"
     AND NEW."status" = 'received'::"TransferStatus" THEN
    FOR item IN
      SELECT
        transfer_item."id",
        transfer_item."variant_id",
        transfer_item."qty"
      FROM "TransferItem" transfer_item
      WHERE transfer_item."transfer_id" = NEW."id"
    LOOP
      PERFORM "record_inventory_movement"(
        NEW."to_branch_id"::uuid,
        item."variant_id"::uuid,
        'transfer_in'::"InventoryMovementType",
        item."qty"::integer,
        0::integer,
        'Transfer'::text,
        NEW."id"::text,
        item."id"::text,
        ('transfer-in:' || item."id"::text)::text,
        COALESCE(
          NEW."received_at",
          CURRENT_TIMESTAMP::timestamp(3)
        )::timestamp(3),
        NEW."received_by"::uuid,
        jsonb_build_object(
          'transfer_number', NEW."transfer_number",
          'from_branch_id', NEW."from_branch_id",
          'to_branch_id', NEW."to_branch_id"
        )::jsonb
      );
    END LOOP;
  END IF;

  RETURN NEW;
END
$$;

COMMIT;
