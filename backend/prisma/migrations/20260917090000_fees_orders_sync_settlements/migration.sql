-- 1) Why payment fees are 0: record the balance-API failure on the store
--    instead of swallowing it, and track the incremental order-sync cursor.
ALTER TABLE "ShopifyStore" ADD COLUMN "feeSyncError" TEXT;
ALTER TABLE "ShopifyStore" ADD COLUMN "feeSyncAt" TIMESTAMP(3);
ALTER TABLE "ShopifyStore" ADD COLUMN "ordersSyncedAt" TIMESTAMP(3);

-- 2) When an order shipped. Left NULL for existing rows: the real date only
--    comes from Shopify fulfillments, so it fills in as orders re-sync. The
--    "shipped long ago" view falls back to the order date meanwhile.
ALTER TABLE "Order" ADD COLUMN "shippedAt" TIMESTAMP(3);

-- 3) Frozen product / shipping split of each line item's unit cost. NULL on
--    rows costed before the split existed — we don't invent a split; the
--    total (unitBasecost) is still exact and "Apply to P&L" fills the parts.
ALTER TABLE "OrderLineItem" ADD COLUMN "unitProductCost" DECIMAL(12,2);
ALTER TABLE "OrderLineItem" ADD COLUMN "unitShippingCost" DECIMAL(12,2);

-- 4) Supplier settlements (payments to a supplier for a set of orders).
CREATE TABLE "SupplierSettlement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PAID',
    "orderCount" INTEGER NOT NULL,
    "unitCount" INTEGER NOT NULL,
    "productCost" DECIMAL(12,2) NOT NULL,
    "shippingCost" DECIMAL(12,2) NOT NULL,
    "totalCost" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "paidAt" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedBy" TEXT,

    CONSTRAINT "SupplierSettlement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SupplierSettlement_storeId_paidAt_idx" ON "SupplierSettlement"("storeId", "paidAt");
CREATE INDEX "SupplierSettlement_storeId_supplier_idx" ON "SupplierSettlement"("storeId", "supplier");
ALTER TABLE "SupplierSettlement" ADD CONSTRAINT "SupplierSettlement_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "ShopifyStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Order" ADD COLUMN "supplierSettlementId" TEXT;
ALTER TABLE "Order" ADD CONSTRAINT "Order_supplierSettlementId_fkey"
    FOREIGN KEY ("supplierSettlementId") REFERENCES "SupplierSettlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Order_storeId_supplierSettlementId_idx" ON "Order"("storeId", "supplierSettlementId");
CREATE INDEX "Order_storeId_fulfillStatus_shippedAt_idx" ON "Order"("storeId", "fulfillStatus", "shippedAt");
