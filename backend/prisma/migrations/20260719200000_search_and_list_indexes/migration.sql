-- Trigram indexes keep partial product, customer, SKU, and invoice searches
-- responsive as the catalog and sales history grow.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "Product_is_active_created_at_idx"
  ON "Product"("is_active", "created_at");
CREATE INDEX "Product_name_en_trgm_idx"
  ON "Product" USING GIN ("name_en" gin_trgm_ops);
CREATE INDEX "Product_name_ar_trgm_idx"
  ON "Product" USING GIN ("name_ar" gin_trgm_ops);

CREATE INDEX "ProductVariant_barcode_ean13_idx"
  ON "ProductVariant"("barcode_ean13");
CREATE INDEX "ProductVariant_sku_trgm_idx"
  ON "ProductVariant" USING GIN ("sku" gin_trgm_ops);

CREATE INDEX "Customer_name_trgm_idx"
  ON "Customer" USING GIN ("name" gin_trgm_ops);

CREATE INDEX "SalesInvoice_branch_id_payment_method_created_at_idx"
  ON "SalesInvoice"("branch_id", "payment_method", "created_at");
CREATE INDEX "SalesInvoice_branch_id_status_created_at_idx"
  ON "SalesInvoice"("branch_id", "status", "created_at");
CREATE INDEX "SalesInvoice_invoice_number_trgm_idx"
  ON "SalesInvoice" USING GIN ("invoice_number" gin_trgm_ops);
