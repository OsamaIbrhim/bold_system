CREATE TABLE "SellerCommissionPeriod" (
  "id" UUID NOT NULL,
  "period_start" TIMESTAMP(3) NOT NULL,
  "period_end_exclusive" TIMESTAMP(3) NOT NULL,
  "period_length_days" INTEGER NOT NULL,
  "default_rate" DECIMAL(5,2) NOT NULL,
  "default_target" DECIMAL(12,2),
  "default_bonus" DECIMAL(12,2) NOT NULL,
  "closed_by" UUID NOT NULL,
  "closed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SellerCommissionPeriod_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SellerCommissionPeriod_range_check" CHECK ("period_start" < "period_end_exclusive"),
  CONSTRAINT "SellerCommissionPeriod_closed_by_fkey"
    FOREIGN KEY ("closed_by") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SellerCommissionPeriod_period_start_period_end_exclusive_key"
  ON "SellerCommissionPeriod"("period_start", "period_end_exclusive");
CREATE INDEX "SellerCommissionPeriod_closed_at_idx"
  ON "SellerCommissionPeriod"("closed_at" DESC);

CREATE TABLE "SellerCommissionPeriodRow" (
  "period_id" UUID NOT NULL,
  "seller_id" UUID NOT NULL,
  "seller_name" TEXT NOT NULL,
  "branch_id" UUID,
  "branch_name" TEXT,
  "invoice_count" INTEGER NOT NULL,
  "gross_sales_before_tax" DECIMAL(12,2) NOT NULL,
  "return_count" INTEGER NOT NULL,
  "returns_before_tax" DECIMAL(12,2) NOT NULL,
  "net_sales_before_tax" DECIMAL(12,2) NOT NULL,
  "commission_rate" DECIMAL(5,2) NOT NULL,
  "percentage_commission" DECIMAL(12,2) NOT NULL,
  "target" DECIMAL(12,2),
  "target_achieved" BOOLEAN NOT NULL,
  "target_bonus" DECIMAL(12,2) NOT NULL,
  "estimated_total" DECIMAL(12,2) NOT NULL,
  CONSTRAINT "SellerCommissionPeriodRow_pkey" PRIMARY KEY ("period_id", "seller_id"),
  CONSTRAINT "SellerCommissionPeriodRow_period_id_fkey"
    FOREIGN KEY ("period_id") REFERENCES "SellerCommissionPeriod"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SellerCommissionPeriodRow_seller_id_fkey"
    FOREIGN KEY ("seller_id") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "SellerCommissionPeriodRow_seller_id_period_id_idx"
  ON "SellerCommissionPeriodRow"("seller_id", "period_id");
