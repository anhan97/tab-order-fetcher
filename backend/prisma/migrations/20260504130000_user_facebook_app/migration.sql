-- Per-user Facebook App credentials. Each user brings their own FB App so
-- one compliance hit doesn't take down all merchants sharing a single app.
CREATE TABLE "UserFacebookApp" (
  "id"          TEXT PRIMARY KEY,
  "userId"      TEXT NOT NULL UNIQUE,
  "fbAppId"     TEXT NOT NULL,
  "fbAppSecret" TEXT NOT NULL,
  "fbBmId"      TEXT,
  "appName"     TEXT,
  "isActive"    BOOLEAN NOT NULL DEFAULT TRUE,
  "lastError"   TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserFacebookApp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "UserFacebookApp_isActive_idx" ON "UserFacebookApp" ("isActive");
