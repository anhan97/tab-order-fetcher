-- Global Shopify OAuth app config (admin-managed, singleton). The whole
-- system connects stores through this one app (shipbro-style). Secret
-- encrypted at rest. UserShopifyApp kept as-is (deprecated, no longer read).
CREATE TABLE "ShopifyAppConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopifyAppConfig_pkey" PRIMARY KEY ("id")
);
