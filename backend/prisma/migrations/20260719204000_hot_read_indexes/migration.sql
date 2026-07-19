-- Support owner-wide pagination and relation lookups used by the Admin and
-- synchronization endpoints. PostgreSQL does not create indexes for foreign
-- keys automatically.
CREATE INDEX "ProductVariant_created_at_id_idx"
  ON "ProductVariant"("created_at" DESC, "id" ASC);

CREATE INDEX "ProductVariant_product_id_idx"
  ON "ProductVariant"("product_id");

CREATE INDEX "InventoryStock_variant_id_idx"
  ON "InventoryStock"("variant_id");

CREATE INDEX "SalesInvoice_created_at_id_idx"
  ON "SalesInvoice"("created_at", "id");

CREATE INDEX "SalesInvoiceItem_sales_invoice_id_idx"
  ON "SalesInvoiceItem"("sales_invoice_id");
