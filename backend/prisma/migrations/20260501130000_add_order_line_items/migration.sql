-- CreateTable
CREATE TABLE "OrderLineItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "shopifyLineItemId" TEXT NOT NULL,
    "variantId" BIGINT,
    "productId" BIGINT,
    "sku" TEXT,
    "title" TEXT,
    "quantity" INTEGER NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "totalDiscount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "unitCostSnapshot" DECIMAL(12,2),

    CONSTRAINT "OrderLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderLineItem_orderId_idx" ON "OrderLineItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderLineItem_variantId_idx" ON "OrderLineItem"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderLineItem_orderId_shopifyLineItemId_key" ON "OrderLineItem"("orderId", "shopifyLineItemId");

-- AddForeignKey
ALTER TABLE "OrderLineItem" ADD CONSTRAINT "OrderLineItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
