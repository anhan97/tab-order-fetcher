-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "shippingCompany" TEXT,
ADD COLUMN     "shippingCostSnapshot" DECIMAL(12,2) DEFAULT 0,
ADD COLUMN     "shippingCountryCode" TEXT;

-- AlterTable
ALTER TABLE "ShopifyStore" ADD COLUMN     "defaultShippingCompany" TEXT;
