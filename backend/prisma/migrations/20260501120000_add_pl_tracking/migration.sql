-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "paymentFee" DECIMAL(12,2) DEFAULT 0,
ADD COLUMN     "paymentGateway" TEXT,
ADD COLUMN     "presentmentCurrency" TEXT,
ADD COLUMN     "processedAt" TIMESTAMP(3),
ADD COLUMN     "shopifyCreatedAt" TIMESTAMP(3),
ADD COLUMN     "subtotalPrice" DECIMAL(12,2),
ADD COLUMN     "totalDiscounts" DECIMAL(12,2) DEFAULT 0,
ADD COLUMN     "totalRefunded" DECIMAL(12,2) DEFAULT 0,
ADD COLUMN     "totalShipping" DECIMAL(12,2) DEFAULT 0,
ADD COLUMN     "totalTax" DECIMAL(12,2) DEFAULT 0;

-- CreateTable
CREATE TABLE "OrderTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "shopifyTransactionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "gateway" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "net" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "presentmentCurrency" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyPLSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "grossRevenue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "refunds" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discounts" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "shippingRevenue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxCollected" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "netRevenue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cogs" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "shippingCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paymentFees" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "fbAdSpend" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "otherAdSpend" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "operatingCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "grossProfit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "netProfit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "refundedOrderCount" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isFinalized" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DailyPLSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperatingCost" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperatingCost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderTransaction_storeId_processedAt_idx" ON "OrderTransaction"("storeId", "processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrderTransaction_orderId_shopifyTransactionId_key" ON "OrderTransaction"("orderId", "shopifyTransactionId");

-- CreateIndex
CREATE INDEX "DailyPLSnapshot_storeId_date_idx" ON "DailyPLSnapshot"("storeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyPLSnapshot_userId_storeId_date_key" ON "DailyPLSnapshot"("userId", "storeId", "date");

-- CreateIndex
CREATE INDEX "OperatingCost_userId_storeId_date_idx" ON "OperatingCost"("userId", "storeId", "date");

-- CreateIndex
CREATE INDEX "Order_storeId_processedAt_idx" ON "Order"("storeId", "processedAt");

-- CreateIndex
CREATE INDEX "Order_userId_storeId_processedAt_idx" ON "Order"("userId", "storeId", "processedAt");

-- AddForeignKey
ALTER TABLE "OrderTransaction" ADD CONSTRAINT "OrderTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTransaction" ADD CONSTRAINT "OrderTransaction_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "ShopifyStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTransaction" ADD CONSTRAINT "OrderTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPLSnapshot" ADD CONSTRAINT "DailyPLSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPLSnapshot" ADD CONSTRAINT "DailyPLSnapshot_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "ShopifyStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatingCost" ADD CONSTRAINT "OperatingCost_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatingCost" ADD CONSTRAINT "OperatingCost_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "ShopifyStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
