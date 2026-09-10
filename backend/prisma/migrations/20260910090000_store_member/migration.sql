-- Admin-granted access to a store the user does NOT own.
--
-- ShopifyStore.userId stays the single owner; this table is purely additive
-- delegation so a fulfiller (cs) or an accountant (finance) can work on a
-- store they don't own. Capabilities per role live in lib/store-access.ts.
CREATE TABLE "StoreMember" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "grantedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreMember_pkey" PRIMARY KEY ("id")
);

-- One row per (person, store): re-granting updates the role instead of
-- stacking rows, so "what can this person do here" has a single answer.
CREATE UNIQUE INDEX "StoreMember_userId_storeId_key" ON "StoreMember"("userId", "storeId");
CREATE INDEX "StoreMember_userId_idx"  ON "StoreMember"("userId");
CREATE INDEX "StoreMember_storeId_idx" ON "StoreMember"("storeId");

-- Deleting the person or the store drops the grant with it. The granting
-- admin is kept for audit, so that FK only nulls out.
ALTER TABLE "StoreMember" ADD CONSTRAINT "StoreMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreMember" ADD CONSTRAINT "StoreMember_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "ShopifyStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreMember" ADD CONSTRAINT "StoreMember_grantedBy_fkey"
    FOREIGN KEY ("grantedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
