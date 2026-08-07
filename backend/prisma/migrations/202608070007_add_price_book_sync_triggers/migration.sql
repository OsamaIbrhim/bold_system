-- WP-008 Phase B: put Price Book writes back into the POS incremental
-- synchronization stream.
--
-- Phase 5A ("202607210001_phase5a_price_sync_triggers", tenant_id fixed in
-- "202608040112_fix_ledger_triggers_tenant_id") guaranteed that every pricing
-- mutation emits a "SyncChange" row, via a trigger on "PricingRule". Phase B
-- stopped reading "PricingRule" and moved live pricing to "PriceBook"/
-- "PriceBookEntry" -- which had no trigger. The consequence was silent and
-- total: a price change committed cleanly in the admin UI, "SyncChange" never
-- advanced, and every POS terminal kept selling at its last-pulled price
-- indefinitely (SyncService.pull only re-sends the catalog when it sees a
-- change row; kind = 'pricing' is what sets `resetCatalog`).
--
-- Reuses "bold_emit_pricing_sync_change" unchanged -- both tables carry the
-- "id"/"tenant_id" columns it reads, and emitting the same kind = 'pricing'
-- keeps SyncService's existing branch working with no application change.
--
-- Ordered AFTER "202608070006_migrate_pricing_rules_to_price_books" on
-- purpose: the cutover migration inserts one row per live variant, and a
-- trigger installed before it would emit an equal number of redundant
-- SyncChange rows. Terminals pick the migrated prices up through the ordinary
-- post-deploy snapshot instead.

-- Entries are the price itself: every insert (new price), supersede (the
-- UPDATE that marks the previous row superseded plus the INSERT of its
-- successor) and delete must reach the terminals.
DROP TRIGGER IF EXISTS "bold_price_book_entry_sync_change" ON "PriceBookEntry";
CREATE TRIGGER "bold_price_book_entry_sync_change"
AFTER INSERT OR UPDATE OR DELETE ON "PriceBookEntry"
FOR EACH ROW EXECUTE FUNCTION "bold_emit_pricing_sync_change"();

-- The book itself only changes what POS resolves when it becomes (or stops
-- being) the active default -- "PricingService.loadActiveRules" filters on
-- exactly `status = 'active' AND is_default = true`. kind = 'pricing' forces a
-- full catalog reset for every terminal, so the WHEN clause keeps the noisy
-- draft/submitted/approved/scheduled transitions and name edits out of the
-- stream. INSERT is not covered for the same reason: a book is always born
-- 'draft' and cannot be live at insert time. DELETE is not covered either --
-- "PriceBookEntry" holds an onDelete: Restrict FK to "PriceBook", so a book
-- that still prices anything cannot be deleted, and a book with no entries
-- changes no price on its way out (BR-PRB-105 archives rather than deletes).
DROP TRIGGER IF EXISTS "bold_price_book_sync_change" ON "PriceBook";
CREATE TRIGGER "bold_price_book_sync_change"
AFTER UPDATE ON "PriceBook"
FOR EACH ROW
WHEN (
  OLD."status" IS DISTINCT FROM NEW."status"
  OR OLD."is_default" IS DISTINCT FROM NEW."is_default"
)
EXECUTE FUNCTION "bold_emit_pricing_sync_change"();
