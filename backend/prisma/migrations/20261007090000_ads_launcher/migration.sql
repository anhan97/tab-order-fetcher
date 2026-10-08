-- Ads Launcher (docs/2026-10-07-dac-ta-ads-launcher.md). Additive only:
-- new tables + indexes, no existing column is changed or dropped.

-- CreateTable
CREATE TABLE "AdCreative" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" VARCHAR(40) NOT NULL,
    "productTitle" TEXT NOT NULL,
    "productHandle" TEXT,
    "productCode" VARCHAR(64) NOT NULL,
    "productImageUrl" TEXT,
    "createdBy" TEXT NOT NULL,
    "creatorName" TEXT NOT NULL,
    "name" VARCHAR(500) NOT NULL,
    "angle" VARCHAR(255) NOT NULL,
    "primaryText" TEXT,
    "headline" VARCHAR(255),
    "description" VARCHAR(255),
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "mediaType" VARCHAR(10) NOT NULL,
    "mediaPath" TEXT NOT NULL,
    "posterPath" TEXT,
    "mediaMime" VARCHAR(100) NOT NULL,
    "mediaSize" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "originalName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AdCreative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaunchPreset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "config" JSONB NOT NULL,
    "starterKey" VARCHAR(64),
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "LaunchPreset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetaCampaign" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "storeId" TEXT,
    "adAccountId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "objective" TEXT,
    "dailyBudget" TEXT,
    "bidStrategy" TEXT,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MetaCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetaAdSet" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "dailyBudget" TEXT,
    "bidStrategy" TEXT,
    "optimizationGoal" TEXT,
    "targeting" JSONB,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MetaAdSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetaAd" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "storeId" TEXT,
    "adsetId" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "creativeId" TEXT,
    "postId" VARCHAR(100),
    "postCheckedAt" TIMESTAMP(3),
    "metaCreativeId" TEXT,
    "pageId" TEXT,
    "link" TEXT,
    "displayLink" TEXT,
    "urlTags" TEXT,
    "title" TEXT,
    "body" TEXT,
    "thumbnailUrl" TEXT,
    "imageUrl" TEXT,
    "callToActionType" TEXT,
    "creativeData" JSONB,
    "launchId" TEXT,
    "launchedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MetaAd_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdLaunchRequest" (
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdLaunchRequest_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "AdCreative_storeId_productId_deletedAt_idx" ON "AdCreative"("storeId", "productId", "deletedAt");

-- CreateIndex
CREATE INDEX "AdCreative_storeId_createdBy_deletedAt_idx" ON "AdCreative"("storeId", "createdBy", "deletedAt");

-- CreateIndex
CREATE INDEX "AdCreative_storeId_createdAt_idx" ON "AdCreative"("storeId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "LaunchPreset_userId_idx" ON "LaunchPreset"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LaunchPreset_userId_starterKey_key" ON "LaunchPreset"("userId", "starterKey");

-- CreateIndex
CREATE INDEX "MetaCampaign_ownerId_adAccountId_idx" ON "MetaCampaign"("ownerId", "adAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "MetaCampaign_ownerId_externalId_key" ON "MetaCampaign"("ownerId", "externalId");

-- CreateIndex
CREATE INDEX "MetaAdSet_campaignId_idx" ON "MetaAdSet"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "MetaAdSet_ownerId_externalId_key" ON "MetaAdSet"("ownerId", "externalId");

-- CreateIndex
CREATE INDEX "MetaAd_creativeId_idx" ON "MetaAd"("creativeId");

-- CreateIndex
CREATE INDEX "MetaAd_ownerId_postId_idx" ON "MetaAd"("ownerId", "postId");

-- CreateIndex
CREATE INDEX "MetaAd_adsetId_idx" ON "MetaAd"("adsetId");

-- CreateIndex
CREATE UNIQUE INDEX "MetaAd_ownerId_externalId_key" ON "MetaAd"("ownerId", "externalId");

-- CreateIndex
CREATE INDEX "AdLaunchRequest_expiresAt_idx" ON "AdLaunchRequest"("expiresAt");

-- AddForeignKey
ALTER TABLE "AdCreative" ADD CONSTRAINT "AdCreative_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "ShopifyStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaunchPreset" ADD CONSTRAINT "LaunchPreset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetaAdSet" ADD CONSTRAINT "MetaAdSet_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MetaCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetaAd" ADD CONSTRAINT "MetaAd_adsetId_fkey" FOREIGN KEY ("adsetId") REFERENCES "MetaAdSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetaAd" ADD CONSTRAINT "MetaAd_creativeId_fkey" FOREIGN KEY ("creativeId") REFERENCES "AdCreative"("id") ON DELETE SET NULL ON UPDATE CASCADE;

