-- Saved column layouts for the fulfillment CSV/text export. Store-scoped so a
-- whole team shares the same per-supplier presets. `columns` is an ordered
-- JSON array of field keys (see order-export-fields.ts).
CREATE TABLE "OrderExportPreset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "columns" JSONB NOT NULL,
    "delimiter" TEXT NOT NULL DEFAULT 'comma',
    "includeHeader" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderExportPreset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderExportPreset_storeId_name_key" ON "OrderExportPreset"("storeId", "name");
CREATE INDEX "OrderExportPreset_storeId_idx" ON "OrderExportPreset"("storeId");

ALTER TABLE "OrderExportPreset" ADD CONSTRAINT "OrderExportPreset_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderExportPreset" ADD CONSTRAINT "OrderExportPreset_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "ShopifyStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;
