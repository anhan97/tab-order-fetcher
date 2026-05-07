-- DropIndex
DROP INDEX "Pricebook_userId_storeId_countryCode_shippingCompany_key";

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "supplier" TEXT;

-- AlterTable
ALTER TABLE "Pricebook" ADD COLUMN     "supplier" TEXT NOT NULL DEFAULT 'Default';

-- AlterTable
ALTER TABLE "ShopifyStore" ADD COLUMN     "defaultSupplier" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Pricebook_userId_storeId_supplier_countryCode_shippingCompa_key" ON "Pricebook"("userId", "storeId", "supplier", "countryCode", "shippingCompany");
