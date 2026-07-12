-- Per-user Shopify App credentials for the OAuth connect flow. Unpublished
-- Shopify apps can't be installed cross-store, so each user registers their
-- own app; secret stored encrypted (enc2:).
CREATE TABLE "UserShopifyApp" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserShopifyApp_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserShopifyApp_userId_key" ON "UserShopifyApp"("userId");
ALTER TABLE "UserShopifyApp" ADD CONSTRAINT "UserShopifyApp_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
