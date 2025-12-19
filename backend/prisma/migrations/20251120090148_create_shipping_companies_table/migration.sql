/*
  Warnings:

  - You are about to drop the column `accessToken` on the `FacebookAdAccount` table. All the data in the column will be lost.
  - You are about to drop the column `adId` on the `FacebookAdSpend` table. All the data in the column will be lost.
  - You are about to drop the column `adsetId` on the `FacebookAdSpend` table. All the data in the column will be lost.
  - You are about to drop the column `campaignId` on the `FacebookAdSpend` table. All the data in the column will be lost.
  - You are about to drop the column `clicks` on the `FacebookAdSpend` table. All the data in the column will be lost.
  - You are about to drop the column `impressions` on the `FacebookAdSpend` table. All the data in the column will be lost.
  - You are about to drop the column `adSpend` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `costOfGoods` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `financialStatus` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `marketplaceFee` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `orderId` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `otherCosts` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `profit` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `sessionUrl` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `shippingCost` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `totalPrice` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `trackingCompany` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `trackingNumber` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `trackingUrl` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `sku` on the `ProductCost` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[userId,storeId,accountId,date]` on the table `FacebookAdSpend` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[userId,storeId,shopifyOrderId]` on the table `Order` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[userId,storeId,variantId]` on the table `ProductCost` will be added. If there are existing duplicate values, this will fail.
  - Made the column `name` on table `FacebookAdAccount` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `currency` to the `FacebookAdSpend` table without a default value. This is not possible if the table is not empty.
  - Added the required column `storeId` to the `FacebookAdSpend` table without a default value. This is not possible if the table is not empty.
  - Added the required column `shopifyOrderId` to the `Order` table without a default value. This is not possible if the table is not empty.
  - Added the required column `status` to the `Order` table without a default value. This is not possible if the table is not empty.
  - Added the required column `totalAmount` to the `Order` table without a default value. This is not possible if the table is not empty.
  - Added the required column `currency` to the `ProductCost` table without a default value. This is not possible if the table is not empty.
  - Added the required column `storeId` to the `ProductCost` table without a default value. This is not possible if the table is not empty.
  - Made the column `variantId` on table `ProductCost` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "FacebookAdSpend_accountId_adId_date_key";

-- DropIndex
DROP INDEX "Order_storeId_orderId_key";

-- DropIndex
DROP INDEX "ProductCost_userId_sku_key";

-- AlterTable
ALTER TABLE "FacebookAdAccount" DROP COLUMN "accessToken",
ALTER COLUMN "name" SET NOT NULL;

-- AlterTable
ALTER TABLE "FacebookAdSpend" DROP COLUMN "adId",
DROP COLUMN "adsetId",
DROP COLUMN "campaignId",
DROP COLUMN "clicks",
DROP COLUMN "impressions",
ADD COLUMN     "currency" TEXT NOT NULL,
ADD COLUMN     "orderId" TEXT,
ADD COLUMN     "storeId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Order" DROP COLUMN "adSpend",
DROP COLUMN "costOfGoods",
DROP COLUMN "financialStatus",
DROP COLUMN "marketplaceFee",
DROP COLUMN "orderId",
DROP COLUMN "otherCosts",
DROP COLUMN "profit",
DROP COLUMN "sessionUrl",
DROP COLUMN "shippingCost",
DROP COLUMN "totalPrice",
DROP COLUMN "trackingCompany",
DROP COLUMN "trackingNumber",
DROP COLUMN "trackingUrl",
ADD COLUMN     "customerName" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "phoneNumber" TEXT,
ADD COLUMN     "productName" TEXT,
ADD COLUMN     "quantity" INTEGER,
ADD COLUMN     "shopifyOrderId" TEXT NOT NULL,
ADD COLUMN     "status" TEXT NOT NULL,
ADD COLUMN     "style" TEXT,
ADD COLUMN     "totalAmount" DOUBLE PRECISION NOT NULL,
ALTER COLUMN "currency" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ProductCost" DROP COLUMN "sku",
ADD COLUMN     "currency" TEXT NOT NULL,
ADD COLUMN     "storeId" TEXT NOT NULL,
ALTER COLUMN "variantId" SET NOT NULL;

-- CreateTable
CREATE TABLE "ProductVariant" (
    "variantId" BIGINT NOT NULL,
    "userId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "sku" TEXT,
    "title" TEXT NOT NULL,
    "productId" BIGINT NOT NULL,
    "inventoryItemId" BIGINT,
    "baseCost" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("variantId")
);

-- CreateTable
CREATE TABLE "Combo" (
    "comboId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Combo_pkey" PRIMARY KEY ("comboId")
);

-- CreateTable
CREATE TABLE "ComboItem" (
    "comboId" TEXT NOT NULL,
    "variantId" BIGINT NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "ComboItem_pkey" PRIMARY KEY ("comboId","variantId")
);

-- CreateTable
CREATE TABLE "Pricebook" (
    "pricebookId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "shippingCompany" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pricebook_pkey" PRIMARY KEY ("pricebookId")
);

-- CreateTable
CREATE TABLE "PricebookShippingTier" (
    "pricebookId" TEXT NOT NULL,
    "minItems" INTEGER NOT NULL,
    "maxItems" INTEGER NOT NULL,
    "shippingCost" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "PricebookShippingTier_pkey" PRIMARY KEY ("pricebookId","minItems","maxItems")
);

-- CreateTable
CREATE TABLE "PricebookVariantCostOverride" (
    "pricebookId" TEXT NOT NULL,
    "variantId" BIGINT NOT NULL,
    "overrideCost" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "PricebookVariantCostOverride_pkey" PRIMARY KEY ("pricebookId","variantId")
);

-- CreateTable
CREATE TABLE "PricebookComboOverride" (
    "pricebookId" TEXT NOT NULL,
    "comboId" TEXT NOT NULL,
    "overrideProductCost" DECIMAL(10,2),
    "overrideShippingCost" DECIMAL(10,2),

    CONSTRAINT "PricebookComboOverride_pkey" PRIMARY KEY ("pricebookId","comboId")
);

-- CreateTable
CREATE TABLE "shipping_companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "display_name" TEXT,
    "tracking_prefixes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_companies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_userId_storeId_variantId_key" ON "ProductVariant"("userId", "storeId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "Combo_userId_storeId_name_key" ON "Combo"("userId", "storeId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Pricebook_userId_storeId_countryCode_shippingCompany_key" ON "Pricebook"("userId", "storeId", "countryCode", "shippingCompany");

-- CreateIndex
CREATE UNIQUE INDEX "FacebookAdSpend_userId_storeId_accountId_date_key" ON "FacebookAdSpend"("userId", "storeId", "accountId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Order_userId_storeId_shopifyOrderId_key" ON "Order"("userId", "storeId", "shopifyOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCost_userId_storeId_variantId_key" ON "ProductCost"("userId", "storeId", "variantId");

-- AddForeignKey
ALTER TABLE "FacebookAdSpend" ADD CONSTRAINT "FacebookAdSpend_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "ShopifyStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacebookAdSpend" ADD CONSTRAINT "FacebookAdSpend_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCost" ADD CONSTRAINT "ProductCost_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "ShopifyStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "ShopifyStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Combo" ADD CONSTRAINT "Combo_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Combo" ADD CONSTRAINT "Combo_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "ShopifyStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboItem" ADD CONSTRAINT "ComboItem_comboId_fkey" FOREIGN KEY ("comboId") REFERENCES "Combo"("comboId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboItem" ADD CONSTRAINT "ComboItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("variantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pricebook" ADD CONSTRAINT "Pricebook_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pricebook" ADD CONSTRAINT "Pricebook_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "ShopifyStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricebookShippingTier" ADD CONSTRAINT "PricebookShippingTier_pricebookId_fkey" FOREIGN KEY ("pricebookId") REFERENCES "Pricebook"("pricebookId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricebookVariantCostOverride" ADD CONSTRAINT "PricebookVariantCostOverride_pricebookId_fkey" FOREIGN KEY ("pricebookId") REFERENCES "Pricebook"("pricebookId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricebookVariantCostOverride" ADD CONSTRAINT "PricebookVariantCostOverride_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("variantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricebookComboOverride" ADD CONSTRAINT "PricebookComboOverride_pricebookId_fkey" FOREIGN KEY ("pricebookId") REFERENCES "Pricebook"("pricebookId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricebookComboOverride" ADD CONSTRAINT "PricebookComboOverride_comboId_fkey" FOREIGN KEY ("comboId") REFERENCES "Combo"("comboId") ON DELETE CASCADE ON UPDATE CASCADE;
