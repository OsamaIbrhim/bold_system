CREATE TYPE "TransferStatus" AS ENUM ('pending', 'shipped', 'received', 'cancelled');

ALTER TABLE "Transfer"
ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Transfer"
ALTER COLUMN "status" TYPE "TransferStatus"
USING "status"::"TransferStatus";
ALTER TABLE "Transfer"
ALTER COLUMN "status" SET DEFAULT 'pending';

ALTER TABLE "Transfer"
ADD COLUMN "shipped_by" UUID,
ADD COLUMN "shipped_at" TIMESTAMP(3),
ADD COLUMN "received_by" UUID,
ADD COLUMN "received_at" TIMESTAMP(3);

ALTER TABLE "TransferItem"
ADD CONSTRAINT "TransferItem_qty_positive" CHECK ("qty" > 0);

CREATE INDEX "Transfer_from_branch_id_created_at_idx"
ON "Transfer"("from_branch_id", "created_at");
CREATE INDEX "Transfer_to_branch_id_created_at_idx"
ON "Transfer"("to_branch_id", "created_at");

ALTER TABLE "Transfer"
ADD CONSTRAINT "Transfer_from_branch_id_fkey"
FOREIGN KEY ("from_branch_id") REFERENCES "Branch"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Transfer"
ADD CONSTRAINT "Transfer_to_branch_id_fkey"
FOREIGN KEY ("to_branch_id") REFERENCES "Branch"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Transfer"
ADD CONSTRAINT "Transfer_created_by_fkey"
FOREIGN KEY ("created_by") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Transfer"
ADD CONSTRAINT "Transfer_shipped_by_fkey"
FOREIGN KEY ("shipped_by") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Transfer"
ADD CONSTRAINT "Transfer_received_by_fkey"
FOREIGN KEY ("received_by") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
