-- Adlux multi-tenant: BM auto-discovery, per-user access, daily snapshots.
-- Safe to re-run: every CREATE has IF NOT EXISTS.

-- 1. One row per FB ad account known to Adlux BM, with pool slot assignment.
CREATE TABLE IF NOT EXISTS "FacebookAdAccountAssignment" (
  "id"             TEXT PRIMARY KEY,
  "accountId"      TEXT NOT NULL UNIQUE,
  "accountName"    TEXT NOT NULL,
  "poolIndex"      INTEGER NOT NULL,
  "systemUserId"   TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'assigned',
  "accountStatus"  INTEGER,
  "currency"       TEXT,
  "timezone"       TEXT,
  "lastError"      TEXT,
  "lastSyncAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "fb_assignment_pool_idx"   ON "FacebookAdAccountAssignment"("poolIndex");
CREATE INDEX IF NOT EXISTS "fb_assignment_status_idx" ON "FacebookAdAccountAssignment"("status");

-- 2. Per-user access list. Many-to-many user ↔ ad account.
CREATE TABLE IF NOT EXISTS "FacebookAdAccountAccess" (
  "id"          TEXT PRIMARY KEY,
  "userId"      TEXT NOT NULL,
  "accountId"   TEXT NOT NULL,
  "role"        TEXT NOT NULL DEFAULT 'viewer',
  "isFavorite"  BOOLEAN NOT NULL DEFAULT false,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fb_access_user_acct_uniq" UNIQUE ("userId", "accountId"),
  CONSTRAINT "fb_access_user_fk"       FOREIGN KEY ("userId")    REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "fb_access_assignment_fk" FOREIGN KEY ("accountId") REFERENCES "FacebookAdAccountAssignment"("accountId") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "fb_access_user_idx"    ON "FacebookAdAccountAccess"("userId");
CREATE INDEX IF NOT EXISTS "fb_access_account_idx" ON "FacebookAdAccountAccess"("accountId");

-- 3. End-of-day per-entity snapshot for historical view.
CREATE TABLE IF NOT EXISTS "FacebookAdInsightSnapshot" (
  "id"               TEXT PRIMARY KEY,
  "accountId"        TEXT NOT NULL,
  "date"             TIMESTAMP(3) NOT NULL,
  "level"            TEXT NOT NULL,
  "entityId"         TEXT NOT NULL,
  "entityName"       TEXT,
  "parentId"         TEXT,
  "status"           TEXT,
  "spend"            DECIMAL(12, 2) NOT NULL DEFAULT 0,
  "impressions"      BIGINT NOT NULL DEFAULT 0,
  "clicks"           BIGINT NOT NULL DEFAULT 0,
  "reach"            BIGINT NOT NULL DEFAULT 0,
  "uniqueClicks"     BIGINT NOT NULL DEFAULT 0,
  "ctr"              DOUBLE PRECISION,
  "cpc"              DOUBLE PRECISION,
  "cpm"              DOUBLE PRECISION,
  "frequency"        DOUBLE PRECISION,
  "purchases"        INTEGER NOT NULL DEFAULT 0,
  "purchaseValue"    DECIMAL(12, 2) NOT NULL DEFAULT 0,
  "addToCart"        INTEGER NOT NULL DEFAULT 0,
  "initiateCheckout" INTEGER NOT NULL DEFAULT 0,
  "roas"             DOUBLE PRECISION,
  "raw"              JSONB,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fb_snap_uniq"           UNIQUE ("accountId", "date", "level", "entityId"),
  CONSTRAINT "fb_snap_assignment_fk"  FOREIGN KEY ("accountId") REFERENCES "FacebookAdAccountAssignment"("accountId") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "fb_snap_account_date_idx" ON "FacebookAdInsightSnapshot"("accountId", "date");
CREATE INDEX IF NOT EXISTS "fb_snap_date_idx"         ON "FacebookAdInsightSnapshot"("date");
