-- Multi-FB-app per user + admin role.
--
-- Before: 1 user → 1 FB App → 1 FB connection.
-- After:  1 user → N FB Apps (each with its own long-lived FB connection),
--                 because a single FB account is limited in how many ad
--                 accounts it can own; users with many nicks register one
--                 app per nick.
--
-- Migration is preserve-data: existing rows keep their data, the unique
-- constraints just relax from `userId` to `(userId, fbAppId)`. The one
-- non-trivial step is backfilling UserFacebookConnection.fbAppId from the
-- user's existing UserFacebookApp; if a connection has no matching app,
-- we drop it (it would have been broken anyway).

BEGIN;

-- ─── 1. User.role for admin gating ────────────────────────────────────────
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT 'user';
CREATE INDEX IF NOT EXISTS "User_role_idx" ON "User" ("role");

-- ─── 2. UserFacebookApp: drop UNIQUE on userId, allow many apps per user ──
ALTER TABLE "UserFacebookApp" DROP CONSTRAINT IF EXISTS "UserFacebookApp_userId_key";
-- Older Prisma generated this name pattern in the init migration:
ALTER TABLE "UserFacebookApp" DROP CONSTRAINT IF EXISTS "UserFacebookApp_userId_unique";

ALTER TABLE "UserFacebookApp" ADD COLUMN IF NOT EXISTS "isDefault" BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill: each user's existing single app becomes their default.
UPDATE "UserFacebookApp" SET "isDefault" = TRUE WHERE "isDefault" = FALSE;

-- New composite unique on (userId, fbAppId) so a user can't double-register
-- the same FB App ID, but they CAN register multiple distinct apps.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'UserFacebookApp_userId_fbAppId_key'
  ) THEN
    ALTER TABLE "UserFacebookApp"
      ADD CONSTRAINT "UserFacebookApp_userId_fbAppId_key" UNIQUE ("userId", "fbAppId");
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "UserFacebookApp_userId_idx" ON "UserFacebookApp" ("userId");

-- ─── 3. UserFacebookConnection: scope by fbAppId ──────────────────────────
ALTER TABLE "UserFacebookConnection" DROP CONSTRAINT IF EXISTS "UserFacebookConnection_userId_key";
ALTER TABLE "UserFacebookConnection" DROP CONSTRAINT IF EXISTS "UserFacebookConnection_userId_unique";

-- Add fbAppId column (nullable first, then backfill, then NOT NULL).
ALTER TABLE "UserFacebookConnection" ADD COLUMN IF NOT EXISTS "fbAppId" TEXT;

-- Backfill: inherit fbAppId from this user's default (or only) FB app.
UPDATE "UserFacebookConnection" c
SET    "fbAppId" = a."fbAppId"
FROM   "UserFacebookApp" a
WHERE  a."userId" = c."userId"
  AND  c."fbAppId" IS NULL
  AND  a."isDefault" = TRUE;

-- Fallback: pick any app for the user if no default flagged (legacy rows).
UPDATE "UserFacebookConnection" c
SET    "fbAppId" = (
  SELECT "fbAppId" FROM "UserFacebookApp"
  WHERE "userId" = c."userId" ORDER BY "createdAt" ASC LIMIT 1
)
WHERE  c."fbAppId" IS NULL;

-- Drop orphan connections (user has no FB app at all — token is unusable
-- without app credentials to refresh).
DELETE FROM "UserFacebookConnection" WHERE "fbAppId" IS NULL;

-- Now safe to enforce NOT NULL.
ALTER TABLE "UserFacebookConnection" ALTER COLUMN "fbAppId" SET NOT NULL;

-- Composite unique: one connection per (user, app).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'UserFacebookConnection_userId_fbAppId_key'
  ) THEN
    ALTER TABLE "UserFacebookConnection"
      ADD CONSTRAINT "UserFacebookConnection_userId_fbAppId_key" UNIQUE ("userId", "fbAppId");
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "UserFacebookConnection_userId_idx" ON "UserFacebookConnection" ("userId");
CREATE INDEX IF NOT EXISTS "UserFacebookConnection_fbAppId_idx" ON "UserFacebookConnection" ("fbAppId");

COMMIT;
