CREATE TABLE "SyncChange" (
  "sequence" BIGSERIAL NOT NULL,
  "kind" TEXT NOT NULL,
  "branch_id" UUID,
  "entity_key" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SyncChange_pkey" PRIMARY KEY ("sequence")
);

CREATE INDEX "SyncChange_branch_id_sequence_idx"
  ON "SyncChange"("branch_id", "sequence");
CREATE INDEX "SyncChange_sequence_kind_idx"
  ON "SyncChange"("sequence", "kind");

CREATE OR REPLACE FUNCTION bold_record_catalog_change()
RETURNS TRIGGER AS $$
DECLARE
  changed_id TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    changed_id := OLD."id"::text;
  ELSE
    changed_id := NEW."id"::text;
  END IF;
  INSERT INTO "SyncChange" ("kind", "entity_key")
  VALUES (TG_ARGV[0], changed_id);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION bold_record_inventory_change()
RETURNS TRIGGER AS $$
DECLARE
  changed_branch UUID;
  changed_variant TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    changed_branch := OLD."branch_id";
    changed_variant := OLD."variant_id"::text;
  ELSE
    changed_branch := NEW."branch_id";
    changed_variant := NEW."variant_id"::text;
  END IF;
  INSERT INTO "SyncChange" ("kind", "branch_id", "entity_key")
  VALUES ('inventory', changed_branch, changed_variant);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Product_sync_change"
AFTER INSERT OR UPDATE OR DELETE ON "Product"
FOR EACH ROW EXECUTE FUNCTION bold_record_catalog_change('product');

CREATE TRIGGER "ProductVariant_sync_change"
AFTER INSERT OR UPDATE OR DELETE ON "ProductVariant"
FOR EACH ROW EXECUTE FUNCTION bold_record_catalog_change('variant');

CREATE TRIGGER "PricingRule_sync_change"
AFTER INSERT OR UPDATE OR DELETE ON "PricingRule"
FOR EACH ROW EXECUTE FUNCTION bold_record_catalog_change('pricing');

CREATE TRIGGER "InventoryStock_sync_change"
AFTER INSERT OR UPDATE OR DELETE ON "InventoryStock"
FOR EACH ROW EXECUTE FUNCTION bold_record_inventory_change();
