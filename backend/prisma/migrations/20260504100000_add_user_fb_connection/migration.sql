-- Move per-user FB SDK login tokens out of localStorage and into DB. Tokens
-- are AES-256-GCM encrypted at rest. Frontend never sees the raw token
-- after this migration; it only knows {connected: true, expiresAt, fbUserId}.

CREATE TABLE IF NOT EXISTS "UserFacebookConnection" (
  "id"                  TEXT PRIMARY KEY,
  "userId"              TEXT NOT NULL UNIQUE,                -- 1:1 with User
  "accessToken"         TEXT NOT NULL,                       -- encrypted
  "fbUserId"            TEXT NOT NULL,
  "fbUserName"          TEXT,
  "expiresAt"           TIMESTAMP(3),                        -- null = never (long-lived 60d)
  "dataAccessExpiresAt" TIMESTAMP(3),
  "scopes"              TEXT,                                -- JSON array
  "lastRefreshedAt"     TIMESTAMP(3),
  "lastUsedAt"          TIMESTAMP(3),
  "lastError"           TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ufc_user_fk" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "ufc_user_idx" ON "UserFacebookConnection"("userId");
