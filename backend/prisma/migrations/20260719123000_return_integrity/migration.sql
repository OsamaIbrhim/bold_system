-- Persist the exact tax snapshot used for each sold unit.
ALTER TABLE "SalesInvoiceItem"
ADD COLUMN "unit_tax" DECIMAL(12,2) NOT NULL DEFAULT 0;

CREATE TYPE "ReturnStatus" AS ENUM ('completed', 'voided');

ALTER TABLE "Return"
ADD COLUMN "branch_id" UUID,
ADD COLUMN "refund_subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "refund_tax" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "refund_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "status" "ReturnStatus" NOT NULL DEFAULT 'completed';

UPDATE "Return" AS r
SET "branch_id" = s."branch_id"
FROM "SalesInvoice" AS s
WHERE s."id" = r."original_invoice_id";

-- This intentionally fails if historical orphan returns exist; they must be
-- reconciled instead of silently assigning them to an arbitrary branch.
ALTER TABLE "Return"
ALTER COLUMN "branch_id" SET NOT NULL;

CREATE TABLE "ReturnItem" (
    "id" UUID NOT NULL,
    "return_id" UUID NOT NULL,
    "sales_invoice_item_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "unit_cost" DECIMAL(12,2) NOT NULL,
    "unit_tax" DECIMAL(12,2) NOT NULL,
    CONSTRAINT "ReturnItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ReturnItem_qty_positive" CHECK ("qty" > 0)
);

CREATE INDEX "Return_original_invoice_id_created_at_idx"
ON "Return"("original_invoice_id", "created_at");
CREATE INDEX "ReturnItem_sales_invoice_item_id_idx"
ON "ReturnItem"("sales_invoice_item_id");

ALTER TABLE "Return"
ADD CONSTRAINT "Return_original_invoice_id_fkey"
FOREIGN KEY ("original_invoice_id") REFERENCES "SalesInvoice"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Return"
ADD CONSTRAINT "Return_new_invoice_id_fkey"
FOREIGN KEY ("new_invoice_id") REFERENCES "SalesInvoice"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Return"
ADD CONSTRAINT "Return_branch_id_fkey"
FOREIGN KEY ("branch_id") REFERENCES "Branch"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Return"
ADD CONSTRAINT "Return_created_by_fkey"
FOREIGN KEY ("created_by") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ReturnItem"
ADD CONSTRAINT "ReturnItem_return_id_fkey"
FOREIGN KEY ("return_id") REFERENCES "Return"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReturnItem"
ADD CONSTRAINT "ReturnItem_sales_invoice_item_id_fkey"
FOREIGN KEY ("sales_invoice_item_id") REFERENCES "SalesInvoiceItem"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReturnItem"
ADD CONSTRAINT "ReturnItem_variant_id_fkey"
FOREIGN KEY ("variant_id") REFERENCES "ProductVariant"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
