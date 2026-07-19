ALTER TABLE "PosTerminal"
  ADD COLUMN "device_token_hash" TEXT,
  ADD COLUMN "enrolled_by" UUID,
  ADD COLUMN "enrolled_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "PosTerminal_device_token_hash_key"
  ON "PosTerminal"("device_token_hash");

ALTER TABLE "PosTerminal"
  ADD CONSTRAINT "PosTerminal_enrolled_by_fkey"
  FOREIGN KEY ("enrolled_by") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PosTerminalEnrollment" (
  "id" UUID NOT NULL,
  "code_hash" TEXT NOT NULL,
  "branch_id" UUID NOT NULL,
  "terminal_name" TEXT,
  "created_by" UUID NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PosTerminalEnrollment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PosTerminalEnrollment_code_hash_key"
  ON "PosTerminalEnrollment"("code_hash");
CREATE INDEX "PosTerminalEnrollment_branch_id_expires_at_idx"
  ON "PosTerminalEnrollment"("branch_id", "expires_at");

ALTER TABLE "PosTerminalEnrollment"
  ADD CONSTRAINT "PosTerminalEnrollment_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "Branch"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PosTerminalEnrollment"
  ADD CONSTRAINT "PosTerminalEnrollment_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
