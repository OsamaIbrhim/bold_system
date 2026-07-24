ALTER TABLE "SalesInvoice" ADD COLUMN "seller_id" UUID;

ALTER TABLE "SalesInvoice"
  ADD CONSTRAINT "SalesInvoice_seller_id_fkey"
  FOREIGN KEY ("seller_id") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "SalesInvoice_seller_id_occurred_at_idx"
  ON "SalesInvoice"("seller_id", "occurred_at");
