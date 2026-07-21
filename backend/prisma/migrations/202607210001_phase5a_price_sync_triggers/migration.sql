-- Phase 5A: guarantee that every catalog, pricing, and stock mutation enters
-- the POS incremental synchronization stream. Triggers are intentionally
-- idempotent and may coexist with application-level SyncChange writes.

CREATE OR REPLACE FUNCTION "bold_emit_pricing_sync_change"()
RETURNS trigger AS $$
DECLARE entity_id uuid;
BEGIN
  entity_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."id" ELSE NEW."id" END;
  INSERT INTO "SyncChange" ("kind", "branch_id", "entity_key", "created_at")
  VALUES ('pricing', NULL, entity_id::text, CURRENT_TIMESTAMP);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "bold_emit_product_sync_change"()
RETURNS trigger AS $$
DECLARE entity_id uuid;
BEGIN
  entity_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."id" ELSE NEW."id" END;
  INSERT INTO "SyncChange" ("kind", "branch_id", "entity_key", "created_at")
  VALUES ('product', NULL, entity_id::text, CURRENT_TIMESTAMP);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "bold_emit_variant_sync_change"()
RETURNS trigger AS $$
DECLARE entity_id uuid;
BEGIN
  entity_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."id" ELSE NEW."id" END;
  INSERT INTO "SyncChange" ("kind", "branch_id", "entity_key", "created_at")
  VALUES ('variant', NULL, entity_id::text, CURRENT_TIMESTAMP);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "bold_emit_inventory_sync_change"()
RETURNS trigger AS $$
DECLARE target_branch uuid;
DECLARE target_variant uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_branch := OLD."branch_id";
    target_variant := OLD."variant_id";
  ELSE
    target_branch := NEW."branch_id";
    target_variant := NEW."variant_id";
  END IF;

  INSERT INTO "SyncChange" ("kind", "branch_id", "entity_key", "created_at")
  VALUES ('inventory', target_branch, target_variant::text, CURRENT_TIMESTAMP);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "bold_pricing_rule_sync_change" ON "PricingRule";
CREATE TRIGGER "bold_pricing_rule_sync_change"
AFTER INSERT OR UPDATE OR DELETE ON "PricingRule"
FOR EACH ROW EXECUTE FUNCTION "bold_emit_pricing_sync_change"();

DROP TRIGGER IF EXISTS "bold_product_sync_change" ON "Product";
CREATE TRIGGER "bold_product_sync_change"
AFTER INSERT OR UPDATE OR DELETE ON "Product"
FOR EACH ROW EXECUTE FUNCTION "bold_emit_product_sync_change"();

DROP TRIGGER IF EXISTS "bold_variant_sync_change" ON "ProductVariant";
CREATE TRIGGER "bold_variant_sync_change"
AFTER INSERT OR UPDATE OR DELETE ON "ProductVariant"
FOR EACH ROW EXECUTE FUNCTION "bold_emit_variant_sync_change"();

DROP TRIGGER IF EXISTS "bold_inventory_sync_change" ON "InventoryStock";
CREATE TRIGGER "bold_inventory_sync_change"
AFTER INSERT OR UPDATE OR DELETE ON "InventoryStock"
FOR EACH ROW EXECUTE FUNCTION "bold_emit_inventory_sync_change"();
