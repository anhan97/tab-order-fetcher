-- Shopify apps can now be pinned to a specific store: custom-distribution
-- apps only install on ONE real store, so multi-store users need one app
-- per store. shopDomain NULL = the user's default app (previous behavior).
DROP INDEX "UserShopifyApp_userId_key";
ALTER TABLE "UserShopifyApp" ADD COLUMN "shopDomain" TEXT;
CREATE UNIQUE INDEX "UserShopifyApp_userId_shopDomain_key" ON "UserShopifyApp"("userId", "shopDomain");
CREATE INDEX "UserShopifyApp_userId_idx" ON "UserShopifyApp"("userId");
