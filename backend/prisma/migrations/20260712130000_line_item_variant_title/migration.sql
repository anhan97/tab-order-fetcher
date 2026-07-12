-- Store the Shopify line_item.variant_title (e.g. "Red / L") so fulfillment
-- exports can carry a STYLE(COLOR) column. Backfilled on the next order sync.
ALTER TABLE "OrderLineItem" ADD COLUMN "variantTitle" TEXT;
