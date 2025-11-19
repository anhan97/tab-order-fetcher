import { PrismaClient } from '@prisma/client';
import { fetchShopifyOrders } from './shopify.service';
import { format } from 'date-fns';

const prisma = new PrismaClient();

export async function syncOrders(storeId: string) {
  try {
    // Get store details
    const store = await prisma.shopifyStore.findUnique({
      where: { id: storeId }
    });

    if (!store) {
      throw new Error('Store not found');
    }

    // Get last sync time
    const lastOrder = await prisma.order.findFirst({
      where: { storeId },
      orderBy: { createdAt: 'desc' }
    });

    // Fetch orders from Shopify
    const { orders } = await fetchShopifyOrders(
      store.storeDomain,
      store.accessToken,
      {
        createdAtMin: lastOrder?.createdAt.toISOString(),
        limit: 250 // Maximum allowed by Shopify
      }
    );

    // Process orders
    const createdOrders = await Promise.all(
      orders.map(async (order) => {
        // Extract UTM parameters and fbclid from order tags or note attributes
        const utmParams = extractUtmParameters(order);
        
        return prisma.order.create({
          data: {
            storeId,
            userId: store.userId,
            shopifyOrderId: String(order.id),
            orderNumber: order.order_number,
            totalAmount: parseFloat(order.total_price),
            currency: order.currency,
            customerEmail: order.customer.email,
            fulfillmentStatus: order.fulfillment_status || 'unfulfilled',
            status: order.financial_status,
            createdAt: format(new Date(order.created_at), 'yyyy-MM-dd HH:mm:ss'),
            updatedAt: format(new Date(order.updated_at), 'yyyy-MM-dd HH:mm:ss'),
            // UTM parameters
            ...utmParams
          }
        });
      })
    );

    return {
      success: true,
      ordersCreated: createdOrders.length
    };
  } catch (error: any) {
    console.error('Failed to sync orders:', error);
    throw new Error(`Failed to sync orders: ${error.message}`);
  }
}

function extractUtmParameters(order: any) {
  const utmParams: {
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    utmContent?: string;
    fbclid?: string;
  } = {};

  // Try to extract from note attributes
  const noteAttributes = order.note_attributes || [];
  for (const attr of noteAttributes) {
    switch (attr.name.toLowerCase()) {
      case 'utm_source':
        utmParams.utmSource = attr.value;
        break;
      case 'utm_medium':
        utmParams.utmMedium = attr.value;
        break;
      case 'utm_campaign':
        utmParams.utmCampaign = attr.value;
        break;
      case 'utm_content':
        utmParams.utmContent = attr.value;
        break;
      case 'fbclid':
        utmParams.fbclid = attr.value;
        break;
    }
  }

  // Try to extract from order tags
  const tags = (order.tags || '').split(',').map((tag: string) => tag.trim());
  for (const tag of tags) {
    if (tag.startsWith('utm_source:')) utmParams.utmSource = tag.split(':')[1];
    if (tag.startsWith('utm_medium:')) utmParams.utmMedium = tag.split(':')[1];
    if (tag.startsWith('utm_campaign:')) utmParams.utmCampaign = tag.split(':')[1];
    if (tag.startsWith('utm_content:')) utmParams.utmContent = tag.split(':')[1];
    if (tag.startsWith('fbclid:')) utmParams.fbclid = tag.split(':')[1];
  }

  return utmParams;
} 