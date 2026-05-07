-- Move Adlux configuration from env vars into DB so admins can manage it
-- through the UI without redeploying. Singleton row + token pool.

-- Singleton config (id is always 'singleton'). Holds the BM ID + FB app
-- credentials. Plain text for now — DATABASE_URL access is the trust
-- boundary; encrypt at rest when needed.
CREATE TABLE IF NOT EXISTS "AdluxConfig" (
  "id"           TEXT PRIMARY KEY DEFAULT 'singleton',
  "fbAppId"      TEXT,
  "fbAppSecret"  TEXT,
  "adluxBmId"    TEXT,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Seed empty singleton row so UI can UPSERT against it without fail-on-missing.
INSERT INTO "AdluxConfig" ("id", "updatedAt")
VALUES ('singleton', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- One row per system-user token in the Adlux BM. poolIndex is what
-- consistent-hashing maps account ids to. systemUserId is cached after
-- first /me call so we don't have to resolve it every time.
CREATE TABLE IF NOT EXISTS "AdluxSystemToken" (
  "id"            TEXT PRIMARY KEY,
  "poolIndex"     INTEGER NOT NULL UNIQUE,
  "name"          TEXT NOT NULL,
  "token"         TEXT NOT NULL,
  "systemUserId"  TEXT,
  "isActive"      BOOLEAN NOT NULL DEFAULT true,
  "lastError"     TEXT,
  "lastUsedAt"    TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "adlux_token_active_idx" ON "AdluxSystemToken"("isActive");
