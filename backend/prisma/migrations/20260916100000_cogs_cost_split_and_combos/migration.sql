-- 1) Split each matrix price into product cost + shipping cost.
--    cost stays the total and is still the only field P&L reads. Existing
--    prices were entered as one total, so they move into productCost with
--    shippingCost 0 — every total is unchanged; the merchant can split them
--    later.
ALTER TABLE "CogsPrice" ADD COLUMN "productCost"  DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "CogsPrice" ADD COLUMN "shippingCost" DECIMAL(12,2) NOT NULL DEFAULT 0;
UPDATE "CogsPrice" SET "productCost" = "cost";

-- 2) Combos: a priced mix of different variants, per ship line.
CREATE TABLE "CogsCombo" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "signature" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CogsCombo_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CogsCombo_storeId_signature_key" ON "CogsCombo"("storeId", "signature");
CREATE INDEX "CogsCombo_storeId_sortOrder_idx" ON "CogsCombo"("storeId", "sortOrder");

CREATE TABLE "CogsComboPrice" (
    "id" TEXT NOT NULL,
    "comboId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "productCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "shippingCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cost" DECIMAL(12,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CogsComboPrice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CogsComboPrice_comboId_lineId_key" ON "CogsComboPrice"("comboId", "lineId");
CREATE INDEX "CogsComboPrice_lineId_idx" ON "CogsComboPrice"("lineId");

ALTER TABLE "CogsComboPrice" ADD CONSTRAINT "CogsComboPrice_comboId_fkey"
    FOREIGN KEY ("comboId") REFERENCES "CogsCombo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CogsComboPrice" ADD CONSTRAINT "CogsComboPrice_lineId_fkey"
    FOREIGN KEY ("lineId") REFERENCES "CogsLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
