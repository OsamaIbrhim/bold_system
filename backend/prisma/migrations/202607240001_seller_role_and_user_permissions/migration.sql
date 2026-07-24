ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'seller';

ALTER TABLE "User"
  ADD COLUMN "granted_capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "revoked_capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
