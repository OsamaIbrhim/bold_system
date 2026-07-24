CREATE TABLE "SellerCommissionSettings" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "default_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "default_target" DECIMAL(12,2),
  "default_bonus" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "period_length_days" INTEGER NOT NULL DEFAULT 30,
  "period_anchor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SellerCommissionSettings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SellerCommissionSettings_singleton_check" CHECK ("id" = 1),
  CONSTRAINT "SellerCommissionSettings_rate_check" CHECK ("default_rate" >= 0 AND "default_rate" <= 100),
  CONSTRAINT "SellerCommissionSettings_period_check" CHECK ("period_length_days" BETWEEN 1 AND 366)
);

CREATE TABLE "SellerCommissionOverride" (
  "seller_id" UUID NOT NULL,
  "rate" DECIMAL(5,2),
  "target" DECIMAL(12,2),
  "bonus" DECIMAL(12,2),
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SellerCommissionOverride_pkey" PRIMARY KEY ("seller_id"),
  CONSTRAINT "SellerCommissionOverride_rate_check" CHECK ("rate" IS NULL OR ("rate" >= 0 AND "rate" <= 100)),
  CONSTRAINT "SellerCommissionOverride_seller_id_fkey"
    FOREIGN KEY ("seller_id") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "SellerCommissionSettings" (
  "id", "default_rate", "default_bonus", "period_length_days", "period_anchor", "updated_at"
) VALUES (1, 0, 0, 30, date_trunc('month', CURRENT_TIMESTAMP), CURRENT_TIMESTAMP);
