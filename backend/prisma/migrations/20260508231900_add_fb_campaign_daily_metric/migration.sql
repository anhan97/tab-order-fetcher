-- Per-campaign, per-day FB metrics. Single source of truth for
-- Dashboard + P&L ad spend / impressions / clicks / purchases / ROAS.
-- Populated by the fb-metrics-sync scheduler (5min cadence) and on
-- saveCampaignsForStore.
CREATE TABLE IF NOT EXISTS "FbCampaignDailyMetric" (
    "id"            TEXT PRIMARY KEY,
    "userId"        TEXT NOT NULL,
    "accountId"     TEXT NOT NULL,
    "campaignId"    TEXT NOT NULL,
    "campaignName"  TEXT,
    "date"          TIMESTAMP(3) NOT NULL,

    "spend"         DECIMAL(14, 2) NOT NULL DEFAULT 0,
    "impressions"   BIGINT         NOT NULL DEFAULT 0,
    "clicks"        BIGINT         NOT NULL DEFAULT 0,
    "linkClicks"    BIGINT         NOT NULL DEFAULT 0,
    "uniqueClicks"  BIGINT         NOT NULL DEFAULT 0,
    "reach"         BIGINT         NOT NULL DEFAULT 0,
    "purchases"     INTEGER        NOT NULL DEFAULT 0,
    "purchaseValue" DECIMAL(14, 2) NOT NULL DEFAULT 0,
    "ctr"           DOUBLE PRECISION,
    "cpc"           DOUBLE PRECISION,
    "cpm"           DOUBLE PRECISION,
    "roas"          DOUBLE PRECISION,
    "currency"      TEXT NOT NULL DEFAULT 'USD',

    "lastSyncedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "FbCampaignDailyMetric_userId_accountId_campaignId_date_key"
    ON "FbCampaignDailyMetric" ("userId", "accountId", "campaignId", "date");
CREATE INDEX IF NOT EXISTS "FbCampaignDailyMetric_userId_date_idx"
    ON "FbCampaignDailyMetric" ("userId", "date");
CREATE INDEX IF NOT EXISTS "FbCampaignDailyMetric_accountId_date_idx"
    ON "FbCampaignDailyMetric" ("accountId", "date");
CREATE INDEX IF NOT EXISTS "FbCampaignDailyMetric_campaignId_date_idx"
    ON "FbCampaignDailyMetric" ("campaignId", "date");
