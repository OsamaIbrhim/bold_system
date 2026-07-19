CREATE INDEX "OfferSuggestion_branch_id_status_created_at_idx"
ON "OfferSuggestion"("branch_id", "status", "created_at");

CREATE UNIQUE INDEX "OfferSuggestion_one_pending_per_stock"
ON "OfferSuggestion"("branch_id", "variant_id")
WHERE "status" = 'pending';

ALTER TABLE "OfferSuggestion"
ADD CONSTRAINT "OfferSuggestion_variant_id_fkey"
FOREIGN KEY ("variant_id") REFERENCES "ProductVariant"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfferSuggestion"
ADD CONSTRAINT "OfferSuggestion_branch_id_fkey"
FOREIGN KEY ("branch_id") REFERENCES "Branch"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfferSuggestion"
ADD CONSTRAINT "OfferSuggestion_reviewed_by_fkey"
FOREIGN KEY ("reviewed_by") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
