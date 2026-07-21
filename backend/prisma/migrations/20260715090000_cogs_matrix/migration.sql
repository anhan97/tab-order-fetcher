-- COGS price matrix (Excel-style): CogsLine = one column group per
-- (supplier × carrier × country) ship line; CogsPrice = one cell holding the
-- TOTAL landed cost for setQty units of a variant via that line.
CREATE TABLE "CogsLine" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "supplier" TEXT NOT NULL DEFAULT 'Default',
    "carrier" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "setSizes" JSONB NOT NULL DEFAULT '[1]',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CogsLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CogsLine_storeId_supplier_carrier_countryCode_key"
    ON "CogsLine"("storeId", "supplier", "carrier", "countryCode");
CREATE INDEX "CogsLine_storeId_sortOrder_idx" ON "CogsLine"("storeId", "sortOrder");

CREATE TABLE "CogsPrice" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "variantId" BIGINT NOT NULL,
    "setQty" INTEGER NOT NULL,
    "cost" DECIMAL(12,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CogsPrice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CogsPrice_lineId_variantId_setQty_key"
    ON "CogsPrice"("lineId", "variantId", "setQty");
CREATE INDEX "CogsPrice_variantId_idx" ON "CogsPrice"("variantId");

ALTER TABLE "CogsPrice" ADD CONSTRAINT "CogsPrice_lineId_fkey"
    FOREIGN KEY ("lineId") REFERENCES "CogsLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
