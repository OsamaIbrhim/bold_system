-- WP-008 Phase B: one-time data migration, "PricingRule" -> "PriceBook"/
-- "PriceBookEntry" (CLAUDE.md §6 "fail loud on ambiguous data").
--
-- Why this is not a straight row-for-row copy
-- ---------------------------------------------------------------------------
-- "PricingRule" encodes a cost-multiplier FORMULA (overhead%, profit%, tax%)
-- that the old "PricingService.quote()" applied dynamically, per variant, at
-- read time: price = cost * (1+overhead%) * (1+profit%). "PriceBookEntry"
-- stores one fixed, explicit "unit_price" instead (BR-PSL, no formula
-- concept in the BR doc). For "variant"/"product"-scoped rules this is a
-- lossless, unambiguous translation: the set of affected variants is finite
-- and enumerable, so each one's *current* formula result can be frozen as
-- its own entry. For "brand"/"category"/"global"-scoped rules this is NOT
-- unambiguous: the same rule prices many variants differently depending on
-- each one's own cost, and a single fixed "unit_price" cannot represent
-- that. Per CLAUDE.md §6, this migration does not invent a representative
-- price for those rules.
--
-- What this migration actually does
-- ---------------------------------------------------------------------------
-- For every ACTIVE ProductVariant (of an active Product), it resolves
-- exactly the rule the OLD engine's priority chain
-- (variant > product > brand > category > global > hardcoded 20/35/14
-- default) would have picked *today*, computes that variant's current
-- selling price with the OLD formula, and freezes it as a variant-scoped
-- "PriceBookEntry" (version 1, active) in one new "Migrated Default Price
-- Book" per tenant. This gives every currently-live variant an unchanged
-- selling price on cutover -- zero price drift -- regardless of which scope
-- level (including brand/category/global) used to win for it. It does NOT
-- create any brand/category/global-scoped "PriceBookEntry" rows, because
-- doing so would require picking one arbitrary price to stand in for a
-- formula that is supposed to vary per variant cost.
--
-- What is explicitly reported, not silently dropped
-- ---------------------------------------------------------------------------
-- The original "PricingRule" rows are left untouched (forward-only, no
-- destructive drop; see the model's schema comment). The validation block
-- below counts, and RAISE NOTICEs:
--   1. active "PricingRule" rows with scope_type IN ('brand','category',
--      'global') -- these are the ambiguous ones described above. Their
--      effect on every variant that is live *today* is preserved (via the
--      frozen per-variant entries), but they are not carried forward as a
--      reusable scope-level default for a variant added after cutover. This
--      is a deliberate policy gap flagged for Osama, not an oversight.
--   2. inactive "PricingRule" rows (is_active = false) -- these already have
--      zero effect on live pricing today ("PricingService.loadActiveRules"
--      filters "is_active = true"), so not migrating them is parity, not
--      data loss; still counted here for a complete accounting.
-- Exact counts are echoed by Postgres NOTICE during migration and must be
-- quoted verbatim in the Phase B PR description, per CLAUDE.md §6.

WITH matched AS (
    SELECT
        v."id" AS variant_id,
        v."tenant_id" AS tenant_id,
        v."cost_price" AS cost_price,
        r."overhead_percent" AS overhead_percent,
        r."profit_percent" AS profit_percent,
        r."tax_percent" AS tax_percent,
        -- Tie-break within one scope_type, matching the OLD engine exactly:
        -- "PricingService.loadActiveRules" ordered every rule by
        -- `priority ASC` and `quote()` then took the FIRST match per scope
        -- level (`rules.find(...)`), so the lowest `priority` won a tie.
        -- Without carrying this through, `DISTINCT ON` would pick an
        -- arbitrary row whenever two active same-scope rules match one
        -- variant, silently drifting that variant's live price.
        r."priority" AS priority,
        r."id" AS rule_id,
        CASE r."scope_type"
            WHEN 'variant' THEN 1
            WHEN 'product' THEN 2
            WHEN 'brand' THEN 3
            WHEN 'category' THEN 4
            WHEN 'global' THEN 5
            ELSE 6
        END AS rank
    FROM "ProductVariant" v
    JOIN "Product" p ON p."tenant_id" = v."tenant_id" AND p."id" = v."product_id"
    JOIN "PricingRule" r ON r."tenant_id" = v."tenant_id" AND r."is_active" = true AND (
        (r."scope_type" = 'variant' AND r."scope_id" = v."id"::text)
        OR (r."scope_type" = 'product' AND r."scope_id" = v."product_id"::text)
        OR (r."scope_type" = 'brand' AND p."brand" IS NOT NULL AND r."scope_id" = p."brand")
        OR (r."scope_type" = 'category' AND p."category_id" IS NOT NULL AND r."scope_id" = p."category_id"::text)
        OR (r."scope_type" = 'global')
    )
    WHERE v."is_active" = true AND p."is_active" = true
),
winners AS (
    -- `priority`/`rule_id` are deliberately absent from the target list: this
    -- CTE is UNION ALLed with `unmatched` (which has no rule behind it), so
    -- the two column lists must stay symmetric. `DISTINCT ON` permits
    -- ORDER BY expressions that are not selected; plain SELECT DISTINCT does
    -- not. `rule_id` last makes an exact priority tie deterministic (the old
    -- engine left that case to Postgres's arbitrary row order).
    SELECT DISTINCT ON (variant_id) variant_id, tenant_id, cost_price, overhead_percent, profit_percent, tax_percent
    FROM matched
    ORDER BY variant_id, rank ASC, priority ASC, rule_id ASC
),
-- Variants with no matching PricingRule row at all today still get priced by
-- "PricingService.quote()"'s hardcoded { overhead: 20, profit: 35, tax: 14 }
-- literal fallback (pricing.service.ts, pre-Phase-B). Freezing that same
-- literal here preserves their current price exactly; it is not a new
-- assumption, it is what production computes for them right now.
unmatched AS (
    SELECT v."id" AS variant_id, v."tenant_id" AS tenant_id, v."cost_price" AS cost_price,
           20::numeric AS overhead_percent, 35::numeric AS profit_percent, 14::numeric AS tax_percent
    FROM "ProductVariant" v
    JOIN "Product" p ON p."tenant_id" = v."tenant_id" AND p."id" = v."product_id"
    WHERE v."is_active" = true AND p."is_active" = true
      AND NOT EXISTS (SELECT 1 FROM winners w WHERE w.variant_id = v."id")
),
resolved AS (
    SELECT * FROM winners
    UNION ALL
    SELECT * FROM unmatched
),
priced AS (
    SELECT
        variant_id,
        tenant_id,
        ROUND(cost_price * (1 + overhead_percent / 100) * (1 + profit_percent / 100), 2) AS unit_price,
        tax_percent
    FROM resolved
),
new_books AS (
    INSERT INTO "PriceBook" (
        "id", "tenant_id", "name", "currency", "scope", "status", "is_default",
        "activated_by", "activated_at", "created_at", "updated_at"
    )
    SELECT
        gen_random_uuid(),
        t.tenant_id,
        'Migrated Default Price Book (WP-008 Phase B)',
        COALESCE(tn."default_currency", 'EGP'),
        'tenant_default',
        'active',
        true,
        NULL,
        now(),
        now(),
        now()
    FROM (SELECT DISTINCT tenant_id FROM priced) t
    JOIN "Tenant" tn ON tn."id" = t.tenant_id
    RETURNING "id", "tenant_id"
)
INSERT INTO "PriceBookEntry" (
    "id", "tenant_id", "price_book_id", "scope_type", "scope_id", "min_qty",
    "unit_price", "allow_zero_price", "tax_percent", "effective_from",
    "version", "status", "created_at"
)
SELECT
    gen_random_uuid(),
    pr.tenant_id,
    nb."id",
    'variant',
    pr.variant_id,
    1,
    pr.unit_price,
    (pr.unit_price = 0),
    pr.tax_percent,
    now(),
    1,
    'active',
    now()
FROM priced pr
JOIN new_books nb ON nb."tenant_id" = pr.tenant_id;

-- Post-step invariants and the ambiguous-data report (CLAUDE.md §6).
DO $$
DECLARE
    live_variants INT;
    migrated_entries INT;
    ambiguous_active_rules INT;
    inactive_rules INT;
    total_active_rules INT;
BEGIN
    SELECT count(*) INTO live_variants
    FROM "ProductVariant" v
    JOIN "Product" p ON p."tenant_id" = v."tenant_id" AND p."id" = v."product_id"
    WHERE v."is_active" = true AND p."is_active" = true;

    SELECT count(*) INTO migrated_entries
    FROM "PriceBookEntry" e
    WHERE e."scope_type" = 'variant' AND e."status" = 'active'
      AND EXISTS (
          SELECT 1 FROM "ProductVariant" v
          JOIN "Product" p ON p."tenant_id" = v."tenant_id" AND p."id" = v."product_id"
          WHERE v."id" = e."scope_id" AND v."tenant_id" = e."tenant_id"
            AND v."is_active" = true AND p."is_active" = true
      );

    IF live_variants <> migrated_entries THEN
        RAISE EXCEPTION 'WP-008 Phase B precondition failed: % active ProductVariant row(s) but only % resolved to a migrated active variant-scope PriceBookEntry -- expected a 1:1 mapping (zero live-price data loss).', live_variants, migrated_entries;
    END IF;

    SELECT count(*) INTO total_active_rules FROM "PricingRule" WHERE "is_active" = true;
    SELECT count(*) INTO ambiguous_active_rules FROM "PricingRule" WHERE "is_active" = true AND "scope_type" IN ('brand', 'category', 'global');
    SELECT count(*) INTO inactive_rules FROM "PricingRule" WHERE "is_active" = false;

    RAISE NOTICE 'WP-008 Phase B PricingRule migration report: % active ProductVariant row(s) migrated to a frozen variant-scope PriceBookEntry (zero price drift). % active PricingRule row(s) total; of those, % are scope_type brand/category/global and were NOT carried forward as reusable scope-level PriceBookEntry rows (ambiguous -- see this migration''s header comment) -- their effect on today''s live variants is preserved via the frozen entries above, but a variant added after this migration will not inherit them. % inactive PricingRule row(s) exist and were not migrated (already had zero live effect under the pre-Phase-B engine).', live_variants, total_active_rules, ambiguous_active_rules, inactive_rules;
END $$;
