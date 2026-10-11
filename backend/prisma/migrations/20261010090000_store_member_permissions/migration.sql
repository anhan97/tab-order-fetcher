-- Ads-side permissions granted per member on top of the store role
-- (creatives.upload, creatives.view, creatives.manage, ads.launch, facebook.view, facebook.manage).
-- Existing members get none: Creatives / Ads Launcher / Facebook stay hidden until an admin grants them.
ALTER TABLE "StoreMember" ADD COLUMN "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
