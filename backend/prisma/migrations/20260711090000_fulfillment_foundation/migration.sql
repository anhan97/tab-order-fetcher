-- Fulfillment foundation: user approval gate, rotating refresh tokens,
-- webhook idempotency ledger, audit log, and internal order lifecycle +
-- customer shipping info for fulfillment export.

-- 1. User approval gate. New registrations default PENDING (set by schema
--    default); every EXISTING user is backfilled to ACTIVE so nobody gets
--    locked out by this migration.
ALTER TABLE "User" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'PENDING';
UPDATE "User" SET "status" = 'ACTIVE';

-- 2. Rotating refresh tokens (only SHA-256 hashes stored).
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Shopify webhook idempotency ledger.
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "shopifyId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WebhookEvent_shopifyId_key" ON "WebhookEvent"("shopifyId");
CREATE INDEX "WebhookEvent_topic_idx" ON "WebhookEvent"("topic");
CREATE INDEX "WebhookEvent_createdAt_idx" ON "WebhookEvent"("createdAt");

-- 4. Audit log (append-only).
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- 5. Internal order lifecycle + customer shipping info for export.
ALTER TABLE "Order" ADD COLUMN "fulfillStatus" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "Order" ADD COLUMN "trackingNumber" TEXT;
ALTER TABLE "Order" ADD COLUMN "deliveryStatus" TEXT;
ALTER TABLE "Order" ADD COLUMN "shippingAddress" JSONB;
ALTER TABLE "Order" ADD COLUMN "customerPhone" TEXT;

-- Backfill lifecycle from the Shopify mirrors we already sync:
--   cancelled  → CANCELLED
--   fulfilled  → SHIPPED (tracking/delivery info will refine to DELIVERED later)
--   everything else stays PENDING
UPDATE "Order" SET "fulfillStatus" = 'CANCELLED' WHERE "cancelledAt" IS NOT NULL;
UPDATE "Order" SET "fulfillStatus" = 'SHIPPED'
  WHERE "cancelledAt" IS NULL AND "fulfillmentStatus" = 'fulfilled';
