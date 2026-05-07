-- Cache the result of FB /debug_token so the admin UI can show remaining
-- token lifetime + data-access expiry without hitting the Graph API on
-- every render. Refreshed when admin clicks "Refresh info" or after a
-- successful test.

ALTER TABLE "AdluxSystemToken" ADD COLUMN IF NOT EXISTS "expiresAt"           TIMESTAMP(3);
ALTER TABLE "AdluxSystemToken" ADD COLUMN IF NOT EXISTS "dataAccessExpiresAt" TIMESTAMP(3);
ALTER TABLE "AdluxSystemToken" ADD COLUMN IF NOT EXISTS "scopes"              TEXT;
ALTER TABLE "AdluxSystemToken" ADD COLUMN IF NOT EXISTS "tokenType"           TEXT;
ALTER TABLE "AdluxSystemToken" ADD COLUMN IF NOT EXISTS "infoCheckedAt"       TIMESTAMP(3);
