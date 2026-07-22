-- Problem 2: preserve the cashier, shift, terminal order, occurrence time and
-- server receipt time for every local-first POS sale.

-- Deployment preconditions: every existing shift must be closed and every
-- terminal must have reported an empty outbox. Historical rows cannot be
-- assigned to an arbitrary shift, and local pending commands must be drained
-- before the new mandatory accounting contract is deployed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Shift" WHERE "status" = 'open') THEN
    RAISE EXCEPTION 'Close every open shift before deploying the offline accounting contract';
  END IF;
  IF EXISTS (SELECT 1 FROM "PosTerminal" WHERE "pending_count" > 0) THEN
    RAISE EXCEPTION 'Synchronize every POS terminal until pending_count is zero before deploying the offline accounting contract';
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "SalesInvoice" invoice
    LEFT JOIN "User" cashier ON cashier."id" = invoice."cashier_id"
    WHERE invoice."cashier_id" IS NOT NULL
      AND cashier."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot add SalesInvoice cashier foreign key: orphan cashier_id values exist';
  END IF;
END
$$;

ALTER TABLE "SalesInvoice"
  ADD COLUMN "received_by" UUID,
  ADD COLUMN "shift_id" UUID,
  ADD COLUMN "offline_session_id" UUID,
  ADD COLUMN "terminal_sequence" BIGINT,
  ADD COLUMN "command_fingerprint" VARCHAR(64),
  ADD COLUMN "occurred_at" TIMESTAMP(3),
  ADD COLUMN "received_at" TIMESTAMP(3);

UPDATE "SalesInvoice"
SET
  "occurred_at" = "created_at",
  "received_at" = "created_at",
  "received_by" = "cashier_id"
WHERE "occurred_at" IS NULL
   OR "received_at" IS NULL;

ALTER TABLE "SalesInvoice"
  ALTER COLUMN "occurred_at" SET NOT NULL,
  ALTER COLUMN "occurred_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "received_at" SET NOT NULL,
  ALTER COLUMN "received_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "PosTerminal"
  ADD COLUMN "last_sale_sequence" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "Return"
  ADD COLUMN "shift_id" UUID;

ALTER TABLE "SalesInvoice"
  ADD CONSTRAINT "SalesInvoice_cashier_id_fkey"
    FOREIGN KEY ("cashier_id") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "SalesInvoice_received_by_fkey"
    FOREIGN KEY ("received_by") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "SalesInvoice_shift_id_fkey"
    FOREIGN KEY ("shift_id") REFERENCES "Shift"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Return"
  ADD CONSTRAINT "Return_shift_id_fkey"
    FOREIGN KEY ("shift_id") REFERENCES "Shift"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "SalesInvoice_terminal_id_terminal_sequence_key"
  ON "SalesInvoice"("terminal_id", "terminal_sequence");

DROP INDEX IF EXISTS "SalesInvoice_branch_id_created_at_idx";
DROP INDEX IF EXISTS "SalesInvoice_created_at_id_idx";
DROP INDEX IF EXISTS "SalesInvoice_branch_id_payment_method_created_at_idx";
DROP INDEX IF EXISTS "SalesInvoice_branch_id_status_created_at_idx";
DROP INDEX IF EXISTS "SalesInvoice_terminal_id_created_at_idx";

CREATE INDEX "SalesInvoice_branch_id_occurred_at_idx"
  ON "SalesInvoice"("branch_id", "occurred_at");
CREATE INDEX "SalesInvoice_occurred_at_id_idx"
  ON "SalesInvoice"("occurred_at" DESC, "id" DESC);
CREATE INDEX "SalesInvoice_branch_id_payment_method_occurred_at_idx"
  ON "SalesInvoice"("branch_id", "payment_method", "occurred_at");
CREATE INDEX "SalesInvoice_branch_id_status_occurred_at_idx"
  ON "SalesInvoice"("branch_id", "status", "occurred_at");
CREATE INDEX "SalesInvoice_terminal_id_occurred_at_idx"
  ON "SalesInvoice"("terminal_id", "occurred_at");
CREATE INDEX "SalesInvoice_shift_id_occurred_at_idx"
  ON "SalesInvoice"("shift_id", "occurred_at");
CREATE INDEX "SalesInvoice_cashier_id_occurred_at_idx"
  ON "SalesInvoice"("cashier_id", "occurred_at");
CREATE INDEX "SalesInvoice_customer_id_occurred_at_id_idx"
  ON "SalesInvoice"("customer_id", "occurred_at" DESC, "id" DESC);
CREATE INDEX "SalesInvoice_received_at_idx"
  ON "SalesInvoice"("received_at");
CREATE INDEX "Return_shift_id_created_at_idx"
  ON "Return"("shift_id", "created_at");

ALTER TABLE "PosTerminal"
  ADD CONSTRAINT "PosTerminal_last_sale_sequence_nonnegative"
    CHECK ("last_sale_sequence" >= 0);

ALTER TABLE "SalesInvoice"
  ADD CONSTRAINT "SalesInvoice_terminal_sequence_positive"
    CHECK ("terminal_sequence" IS NULL OR "terminal_sequence" > 0),
  ADD CONSTRAINT "SalesInvoice_command_fingerprint_format"
    CHECK (
      "command_fingerprint" IS NULL
      OR "command_fingerprint" ~ '^[0-9a-f]{64}$'
    ),
  ADD CONSTRAINT "SalesInvoice_offline_accounting_context_complete"
    CHECK (
      (
        "terminal_sequence" IS NULL
        AND "shift_id" IS NULL
        AND "offline_session_id" IS NULL
        AND "command_fingerprint" IS NULL
      )
      OR
      (
        "terminal_id" IS NOT NULL
        AND "terminal_sequence" IS NOT NULL
        AND "shift_id" IS NOT NULL
        AND "offline_session_id" IS NOT NULL
        AND "cashier_id" IS NOT NULL
        AND "received_by" IS NOT NULL
        AND "command_fingerprint" IS NOT NULL
      )
    );
