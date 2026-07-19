CREATE TABLE "PosTerminal" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "terminal_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "branch_id" UUID NOT NULL,
    "app_version" TEXT,
    "last_seen_at" TIMESTAMP(3),
    "last_sync_at" TIMESTAMP(3),
    "last_sync_status" TEXT NOT NULL DEFAULT 'never',
    "last_error" TEXT,
    "pending_count" INTEGER NOT NULL DEFAULT 0,
    "is_revoked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PosTerminal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PosTerminal_device_id_key" ON "PosTerminal"("device_id");
CREATE UNIQUE INDEX "PosTerminal_terminal_code_key" ON "PosTerminal"("terminal_code");
CREATE INDEX "PosTerminal_branch_id_last_seen_at_idx" ON "PosTerminal"("branch_id", "last_seen_at");
CREATE INDEX "SalesInvoice_branch_id_created_at_idx" ON "SalesInvoice"("branch_id", "created_at");

ALTER TABLE "PosTerminal"
ADD CONSTRAINT "PosTerminal_branch_id_fkey"
FOREIGN KEY ("branch_id") REFERENCES "Branch"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
