CREATE INDEX "Shift_branch_id_opened_at_idx"
ON "Shift"("branch_id", "opened_at");

-- Enforce the business invariant even when two tills open a shift together.
CREATE UNIQUE INDEX "Shift_one_open_per_branch"
ON "Shift"("branch_id")
WHERE "status" = 'open';

ALTER TABLE "Shift"
ADD CONSTRAINT "Shift_opened_by_fkey"
FOREIGN KEY ("opened_by") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Shift"
ADD CONSTRAINT "Shift_closed_by_fkey"
FOREIGN KEY ("closed_by") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
