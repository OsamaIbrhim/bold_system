ALTER TABLE "SalesInvoice" ADD COLUMN "terminal_id" UUID;

CREATE INDEX "SalesInvoice_terminal_id_created_at_idx"
  ON "SalesInvoice"("terminal_id", "created_at");

ALTER TABLE "SalesInvoice"
  ADD CONSTRAINT "SalesInvoice_terminal_id_fkey"
  FOREIGN KEY ("terminal_id") REFERENCES "PosTerminal"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
