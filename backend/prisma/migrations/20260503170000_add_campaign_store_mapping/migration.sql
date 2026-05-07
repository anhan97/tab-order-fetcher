-- Map FB campaigns to Shopify stores so 1 ad account serving N stores can
-- attribute spend correctly. A campaign can be mapped to AT MOST one store
-- (1:N — store has many campaigns, campaign has 0..1 store).

CREATE TABLE IF NOT EXISTS "CampaignStoreMapping" (
  "id"            TEXT PRIMARY KEY,
  "campaignId"    TEXT NOT NULL UNIQUE,
  "campaignName"  TEXT,
  "accountId"     TEXT NOT NULL,             -- FB ad account (without 'act_' prefix)
  "userId"        TEXT NOT NULL,
  "storeId"       TEXT NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "csm_user_fk"  FOREIGN KEY ("userId")  REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "csm_store_fk" FOREIGN KEY ("storeId") REFERENCES "ShopifyStore"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "csm_user_store_idx"  ON "CampaignStoreMapping"("userId", "storeId");
CREATE INDEX IF NOT EXISTS "csm_account_idx"     ON "CampaignStoreMapping"("accountId");
CREATE INDEX IF NOT EXISTS "csm_store_idx"       ON "CampaignStoreMapping"("storeId");
