-- Pricing scopes include entity UUIDs and textual brand identifiers.
ALTER TABLE "PricingRule"
ALTER COLUMN "scope_id" TYPE TEXT
USING "scope_id"::text;
