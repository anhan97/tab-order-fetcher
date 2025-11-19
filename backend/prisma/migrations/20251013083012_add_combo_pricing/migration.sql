/*
  Warnings:

  - You are about to drop the `PricingTier` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "PricingTier" DROP CONSTRAINT "PricingTier_cogsConfigId_fkey";

-- DropForeignKey
ALTER TABLE "PricingTier" DROP CONSTRAINT "PricingTier_storeId_fkey";

-- DropForeignKey
ALTER TABLE "PricingTier" DROP CONSTRAINT "PricingTier_userId_fkey";

-- DropTable
DROP TABLE "PricingTier";

-- CreateTable
CREATE TABLE "ComboPricing" (
    "id" TEXT NOT NULL,
    "cogsConfigId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "comboType" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "productCost" DOUBLE PRECISION NOT NULL,
    "shippingCost" DOUBLE PRECISION NOT NULL,
    "totalCost" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComboPricing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComboPricing_supplier_country_comboType_idx" ON "ComboPricing"("supplier", "country", "comboType");

-- CreateIndex
CREATE UNIQUE INDEX "ComboPricing_cogsConfigId_supplier_country_quantity_key" ON "ComboPricing"("cogsConfigId", "supplier", "country", "quantity");

-- AddForeignKey
ALTER TABLE "ComboPricing" ADD CONSTRAINT "ComboPricing_cogsConfigId_fkey" FOREIGN KEY ("cogsConfigId") REFERENCES "COGSConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboPricing" ADD CONSTRAINT "ComboPricing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboPricing" ADD CONSTRAINT "ComboPricing_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "ShopifyStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
