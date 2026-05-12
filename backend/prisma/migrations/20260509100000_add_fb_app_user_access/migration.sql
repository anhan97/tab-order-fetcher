-- Pivot: which users are allowed to connect FB through which admin-owned app.
-- See FacebookAppUserAccess in schema.prisma for the design rationale.
CREATE TABLE IF NOT EXISTS "FacebookAppUserAccess" (
    "id"             TEXT         PRIMARY KEY,
    "userFbAppId"    TEXT         NOT NULL,
    "assignedUserId" TEXT         NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "FacebookAppUserAccess_userFbAppId_assignedUserId_key"
    ON "FacebookAppUserAccess" ("userFbAppId", "assignedUserId");
CREATE INDEX IF NOT EXISTS "FacebookAppUserAccess_assignedUserId_idx"
    ON "FacebookAppUserAccess" ("assignedUserId");
CREATE INDEX IF NOT EXISTS "FacebookAppUserAccess_userFbAppId_idx"
    ON "FacebookAppUserAccess" ("userFbAppId");
