-- Auto-launch ads (campaign builder) — new tables for saved templates,
-- launch history, and per-creative outcomes. Additive only; no changes to
-- existing tables besides Prisma-managed FK indexes already covered by
-- the User.id PK.

CREATE TABLE IF NOT EXISTS "AdLaunchTemplate" (
    "id"        TEXT PRIMARY KEY,
    "userId"    TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "config"    JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdLaunchTemplate_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "AdLaunchTemplate_userId_idx" ON "AdLaunchTemplate" ("userId");

CREATE TABLE IF NOT EXISTS "AdLaunchHistory" (
    "id"             TEXT PRIMARY KEY,
    "userId"         TEXT NOT NULL,
    "accountId"      TEXT NOT NULL,
    "campaignId"     TEXT,
    "campaignName"   TEXT NOT NULL,
    "status"         TEXT NOT NULL,
    "totalAds"       INTEGER NOT NULL DEFAULT 0,
    "successAds"     INTEGER NOT NULL DEFAULT 0,
    "failedAds"      INTEGER NOT NULL DEFAULT 0,
    "errorSummary"   TEXT,
    "configSnapshot" JSONB NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdLaunchHistory_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "AdLaunchHistory_userId_createdAt_idx" ON "AdLaunchHistory" ("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "AdLaunchHistory_accountId_idx" ON "AdLaunchHistory" ("accountId");
CREATE INDEX IF NOT EXISTS "AdLaunchHistory_campaignId_idx" ON "AdLaunchHistory" ("campaignId");

CREATE TABLE IF NOT EXISTS "AdLaunchItem" (
    "id"        TEXT PRIMARY KEY,
    "historyId" TEXT NOT NULL,
    "filename"  TEXT NOT NULL,
    "adSetId"   TEXT,
    "adId"      TEXT,
    "status"    TEXT NOT NULL,
    "error"     TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdLaunchItem_historyId_fkey"
      FOREIGN KEY ("historyId") REFERENCES "AdLaunchHistory"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "AdLaunchItem_historyId_idx" ON "AdLaunchItem" ("historyId");
