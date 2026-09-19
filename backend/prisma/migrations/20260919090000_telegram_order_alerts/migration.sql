-- New-order Telegram alerts, per store.
ALTER TABLE "ShopifyStore" ADD COLUMN "telegramEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ShopifyStore" ADD COLUMN "telegramChatId" TEXT;
ALTER TABLE "ShopifyStore" ADD COLUMN "telegramBotToken" TEXT;
ALTER TABLE "ShopifyStore" ADD COLUMN "telegramError" TEXT;

-- Existing orders are never announced (alerts only fire for newly created
-- orders), so they stay NULL.
ALTER TABLE "Order" ADD COLUMN "telegramNotifiedAt" TIMESTAMP(3);
