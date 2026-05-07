-- Migration: Basecost redesign
-- Drops legacy FacebookAdSpend/FacebookAdAccount (replaced by mapping + Assignment),
-- renames cogs→basecost everywhere, drops shipping cost columns (basecost now
-- bakes in supplier shipping; shipping revenue stays in grossRevenue via
-- Order.totalAmount).

BEGIN;

-- 1. DailyPLSnapshot: rename + drop shipping cols, with backfill
-- Backfill basecost = OLD cogs + OLD shippingCost so historical totals don't change.
ALTER TABLE "DailyPLSnapshot" RENAME COLUMN "cogs" TO "basecost";
UPDATE "DailyPLSnapshot"
   SET "basecost" = COALESCE("basecost", 0) + COALESCE("shippingCost", 0);
ALTER TABLE "DailyPLSnapshot" DROP COLUMN IF EXISTS "shippingCost";
ALTER TABLE "DailyPLSnapshot" DROP COLUMN IF EXISTS "shippingRevenue";

-- New indexes for faster lookups
CREATE INDEX IF NOT EXISTS "DailyPLSnapshot_userId_date_idx" ON "DailyPLSnapshot" ("userId", "date");
CREATE INDEX IF NOT EXISTS "DailyPLSnapshot_isFinalized_idx" ON "DailyPLSnapshot" ("isFinalized");

-- 2. OrderLineItem: rename unitCostSnapshot → unitBasecost
ALTER TABLE "OrderLineItem" RENAME COLUMN "unitCostSnapshot" TO "unitBasecost";

-- 3. Order: drop shippingCostSnapshot (data migrated into per-line basecost going
--    forward; historical orders keep snapshot zeroed)
ALTER TABLE "Order" DROP COLUMN IF EXISTS "shippingCostSnapshot";

-- 4. ProductVariant: rename baseCost → basecost (semantic now: product + supplier shipping)
ALTER TABLE "ProductVariant" RENAME COLUMN "baseCost" TO "basecost";

-- 5. Drop FacebookAdSpend (legacy account-level totals, replaced by
--    FacebookAdInsightSnapshot + CampaignStoreMapping for per-store attribution)
DROP TABLE IF EXISTS "FacebookAdSpend" CASCADE;

-- 6. Drop FacebookAdAccount (legacy per-user account list, replaced by
--    FacebookAdAccountAssignment + FacebookAdAccountAccess for multi-tenant)
DROP TABLE IF EXISTS "FacebookAdAccount" CASCADE;

COMMIT;
