-- Store data belongs to the store OWNER.
--
-- Until this release resolveStore set req.resolved.userId to the CALLER, so a
-- member granted a store (manager / cs / finance) read and wrote a separate,
-- empty userId=member partition: their P&L showed no revenue, and costs,
-- mappings or COGS they entered were invisible to the owner. The code now
-- scopes every store request to the owner; this moves the rows already
-- written under the wrong userId onto the owner so nothing is lost.
--
-- Only rows whose userId differs from their store's owner are touched.

-- Plain tenant rows: no uniqueness on userId, move unconditionally.
UPDATE "OperatingCost" t SET "userId" = s."userId"
  FROM "ShopifyStore" s WHERE t."storeId" = s."id" AND t."userId" <> s."userId";
UPDATE "CampaignStoreMapping" t SET "userId" = s."userId"
  FROM "ShopifyStore" s WHERE t."storeId" = s."id" AND t."userId" <> s."userId";
UPDATE "CogsLine" t SET "userId" = s."userId"
  FROM "ShopifyStore" s WHERE t."storeId" = s."id" AND t."userId" <> s."userId";
UPDATE "OrderExportPreset" t SET "userId" = s."userId"
  FROM "ShopifyStore" s WHERE t."storeId" = s."id" AND t."userId" <> s."userId";
UPDATE "OrderTransaction" t SET "userId" = s."userId"
  FROM "ShopifyStore" s WHERE t."storeId" = s."id" AND t."userId" <> s."userId";

-- P&L snapshots are a cache, rebuilt from orders + costs on the next read.
DELETE FROM "DailyPLSnapshot" t USING "ShopifyStore" s
  WHERE t."storeId" = s."id" AND t."userId" <> s."userId";

-- Orders a member pulled via "Sync orders" are copies of the owner's Shopify
-- orders. Drop the ones the owner already has (line items and transactions
-- cascade), then adopt whatever is left.
DELETE FROM "Order" t USING "ShopifyStore" s
  WHERE t."storeId" = s."id" AND t."userId" <> s."userId"
    AND EXISTS (SELECT 1 FROM "Order" o
                WHERE o."userId" = s."userId" AND o."storeId" = t."storeId"
                  AND o."shopifyOrderId" = t."shopifyOrderId");
UPDATE "Order" t SET "userId" = s."userId"
  FROM "ShopifyStore" s WHERE t."storeId" = s."id" AND t."userId" <> s."userId";

-- Unique keys that include userId: adopt a member's row only when the owner
-- has no row for the same key, so the owner's own data always wins.
UPDATE "COGSConfig" t SET "userId" = s."userId"
  FROM "ShopifyStore" s WHERE t."storeId" = s."id" AND t."userId" <> s."userId"
    AND NOT EXISTS (SELECT 1 FROM "COGSConfig" o WHERE o."userId" = s."userId"
                    AND o."storeId" = t."storeId" AND o."variantId" = t."variantId");
UPDATE "ProductCost" t SET "userId" = s."userId"
  FROM "ShopifyStore" s WHERE t."storeId" = s."id" AND t."userId" <> s."userId"
    AND NOT EXISTS (SELECT 1 FROM "ProductCost" o WHERE o."userId" = s."userId"
                    AND o."storeId" = t."storeId" AND o."variantId" = t."variantId");
UPDATE "ProductVariant" t SET "userId" = s."userId"
  FROM "ShopifyStore" s WHERE t."storeId" = s."id" AND t."userId" <> s."userId"
    AND NOT EXISTS (SELECT 1 FROM "ProductVariant" o WHERE o."userId" = s."userId"
                    AND o."storeId" = t."storeId" AND o."variantId" = t."variantId");
UPDATE "Combo" t SET "userId" = s."userId"
  FROM "ShopifyStore" s WHERE t."storeId" = s."id" AND t."userId" <> s."userId"
    AND NOT EXISTS (SELECT 1 FROM "Combo" o WHERE o."userId" = s."userId"
                    AND o."storeId" = t."storeId" AND o."name" = t."name");
UPDATE "Pricebook" t SET "userId" = s."userId"
  FROM "ShopifyStore" s WHERE t."storeId" = s."id" AND t."userId" <> s."userId"
    AND NOT EXISTS (SELECT 1 FROM "Pricebook" o WHERE o."userId" = s."userId"
                    AND o."storeId" = t."storeId" AND o."supplier" = t."supplier"
                    AND o."countryCode" = t."countryCode" AND o."shippingCompany" = t."shippingCompany");
