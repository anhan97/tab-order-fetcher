import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/auth.middleware';
import { validateShopifyStore } from '../middleware/validation.middleware';
import { ShopifyController } from '../controllers/shopify.controller';
import { syncOrders } from '../services/order-sync.service';
import { AuthenticatedRequest } from '../types/express';
import { verifyShopifyCredentials, fetchShopifyOrders, updateOrderTracking } from '../services/shopify.service';

const router = Router();
const prisma = new PrismaClient();
const shopifyController = new ShopifyController();

// Direct store verification (no auth required)
router.post('/stores/verify', async (req, res) => {
  try {
    const { storeDomain, accessToken } = req.body;
    
    if (!storeDomain || !accessToken) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    try {
      const shopInfo = await verifyShopifyCredentials(storeDomain, accessToken);
      res.json({
        valid: true,
        shopInfo
      });
    } catch (error) {
      res.json({
        valid: false,
        error: 'Invalid store credentials'
      });
    }
  } catch (error: any) {
    console.error('Failed to verify store:', error);
    res.status(500).json({ error: 'Failed to verify store' });
  }
});

// Direct order fetching (no auth required)
router.get('/stores/orders', async (req, res) => {
  try {
    const storeDomain = req.headers['x-shopify-store-domain'] as string;
    const accessToken = req.headers['x-shopify-access-token'] as string;

    console.log('Received request headers:', {
      storeDomain,
      hasAccessToken: !!accessToken,
      headers: req.headers
    });

    if (!storeDomain || !accessToken) {
      return res.status(400).json({ 
        error: 'Missing required headers',
        missing: {
          storeDomain: !storeDomain,
          accessToken: !accessToken
        },
        receivedHeaders: req.headers
      });
    }

    const {
      created_at_min,
      created_at_max,
      limit = '50',
      page_info,
      status
    } = req.query;

    console.log('Query parameters:', {
      created_at_min,
      created_at_max,
      limit,
      page_info,
      status
    });

    // Validate status parameter if provided
    if (status && typeof status === 'string' && status !== 'any' && !['unfulfilled', 'fulfilled', 'partially_fulfilled', 'paid', 'unpaid', 'refunded'].includes(status)) {
      return res.status(400).json({
        error: 'Invalid status parameter',
        validStatuses: ['any', 'unfulfilled', 'fulfilled', 'partially_fulfilled', 'paid', 'unpaid', 'refunded']
      });
    }

    const { orders, pageInfo } = await fetchShopifyOrders(storeDomain, accessToken, {
      limit: parseInt(limit as string),
      page_info: page_info as string,
      createdAtMin: created_at_min as string,
      createdAtMax: created_at_max as string,
      status: status as string
    });

    res.json({ orders, pageInfo });
  } catch (error: any) {
    console.error('Failed to fetch orders:', {
      error: error.message,
      stack: error.stack,
      headers: {
        ...req.headers,
        'x-shopify-access-token': '***hidden***' // Hide sensitive data in logs
      },
      query: req.query
    });
    res.status(500).json({ 
      error: 'Failed to fetch orders',
      details: error.message,
      requestInfo: {
        headers: {
          storeDomain: req.headers['x-shopify-store-domain'],
          hasAccessToken: !!req.headers['x-shopify-access-token']
        },
        query: req.query
      }
    });
  }
});

// Get all stores for the authenticated user
router.get('/stores', authenticate, (req, res) => shopifyController.getStores(req as AuthenticatedRequest, res));

// Add a new store
router.post('/stores', authenticate, validateShopifyStore, (req, res) => shopifyController.addStore(req as AuthenticatedRequest, res));

// Update store
router.put('/stores/:id', authenticate, validateShopifyStore, (req, res) => shopifyController.updateStore(req as AuthenticatedRequest, res));

// Delete store
router.delete('/stores/:id', authenticate, (req, res) => shopifyController.deleteStore(req as AuthenticatedRequest, res));

// Fetch orders for a specific store
router.get('/stores/:id/orders', authenticate, (req, res) => shopifyController.fetchOrders(req as AuthenticatedRequest, res));

// Sync orders
router.post('/stores/:id/sync', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const authenticatedReq = req as AuthenticatedRequest;

    // Check if store exists and belongs to user
    const store = await prisma.shopifyStore.findFirst({
      where: {
        id,
        userId: authenticatedReq.user.id
      }
    });

    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }

    const result = await syncOrders(id);
    res.json(result);
  } catch (error: any) {
    console.error('Failed to sync orders:', error);
    res.status(500).json({ error: 'Failed to sync orders', message: error.message });
  }
});

// Update order tracking
router.put('/orders/tracking', async (req, res) => {
  try {
    const storeDomain = req.headers['x-shopify-store-domain'] as string;
    const accessToken = req.headers['x-shopify-access-token'] as string;
    
    const {
      orderNumber,
      trackingNumber,
      trackingCompany,
      trackingUrl,
      notifyCustomer = true,
      fulfillItems = true,
      fulfillShippingNotRequired = true
    } = req.body;

    if (!storeDomain || !accessToken) {
      return res.status(400).json({ 
        error: 'Missing required headers',
        missing: {
          storeDomain: !storeDomain,
          accessToken: !accessToken
        }
      });
    }

    if (!orderNumber || !trackingNumber || !trackingCompany) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['orderNumber', 'trackingNumber', 'trackingCompany']
      });
    }

    const result = await updateOrderTracking(
      storeDomain,
      accessToken,
      orderNumber,
      trackingNumber,
      trackingCompany,
      trackingUrl,
      notifyCustomer,
      fulfillItems,
      fulfillShippingNotRequired
    );

    res.json({ 
      success: true, 
      fulfillment: result.fulfillment 
    });
  } catch (error: any) {
    console.error('Failed to update order tracking:', error);
    res.status(500).json({ 
      error: 'Failed to update order tracking',
      details: error.message
    });
  }
});

// Batch tracking update endpoint for faster processing
router.put('/orders/tracking/batch', async (req, res) => {
  try {
    const storeDomain = req.headers['x-shopify-store-domain'] as string;
    const accessToken = req.headers['x-shopify-access-token'] as string;
    
    const {
      trackingUpdates,
      notifyCustomer = true,
      fulfillItems = true,
      fulfillShippingNotRequired = true
    } = req.body;

    if (!storeDomain || !accessToken) {
      return res.status(400).json({ 
        error: 'Missing required headers',
        missing: {
          storeDomain: !storeDomain,
          accessToken: !accessToken
        }
      });
    }

    if (!trackingUpdates || !Array.isArray(trackingUpdates) || trackingUpdates.length === 0) {
      return res.status(400).json({ 
        error: 'Missing or invalid trackingUpdates array'
      });
    }

    // Validate each tracking update
    for (const update of trackingUpdates) {
      if (!update.orderNumber || !update.trackingNumber || !update.trackingCompany) {
        return res.status(400).json({ 
          error: 'Missing required fields in tracking update',
          required: ['orderNumber', 'trackingNumber', 'trackingCompany']
        });
      }
    }

    console.log(`Processing batch tracking update for ${trackingUpdates.length} orders`);

    // Process all updates in parallel
    const results = await Promise.allSettled(
      trackingUpdates.map(update => 
        updateOrderTracking(
          storeDomain,
          accessToken,
          update.orderNumber,
          update.trackingNumber,
          update.trackingCompany,
          update.trackingUrl,
          notifyCustomer,
          fulfillItems,
          fulfillShippingNotRequired
        )
      )
    );

    // Process results
    const successful: Array<{ orderNumber: string; fulfillment: any }> = [];
    const failed: Array<{ orderNumber: string; error: string }> = [];

    results.forEach((result, index) => {
      const update = trackingUpdates[index];
      if (result.status === 'fulfilled') {
        successful.push({
          orderNumber: update.orderNumber,
          fulfillment: result.value.fulfillment
        });
      } else {
        failed.push({
          orderNumber: update.orderNumber,
          error: result.reason?.message || 'Unknown error'
        });
      }
    });

    res.json({ 
      success: true,
      summary: {
        total: trackingUpdates.length,
        successful: successful.length,
        failed: failed.length
      },
      successful,
      failed
    });
  } catch (error: any) {
    console.error('Failed to process batch tracking update:', error);
    res.status(500).json({ 
      error: 'Failed to process batch tracking update',
      details: error.message
    });
  }
});

// Get products
router.get('/products', async (req, res) => {
  try {
    const storeDomain = req.headers['x-shopify-store-domain'] as string;
    const accessToken = req.headers['x-shopify-access-token'] as string;

    if (!storeDomain || !accessToken) {
      return res.status(400).json({ 
        error: 'Missing required headers',
        missing: {
          storeDomain: !storeDomain,
          accessToken: !accessToken
        }
      });
    }

    const {
      limit = '50',
      page_info,
      status = 'active'
    } = req.query;

    const queryParams = new URLSearchParams();
    queryParams.append('limit', limit as string);
    queryParams.append('status', status as string);
    
    if (page_info) {
      queryParams.append('page_info', page_info as string);
    }

    const response = await fetch(`https://${storeDomain}/admin/api/2025-10/products.json?${queryParams}`, {
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to fetch products:', errorText);
      throw new Error(`Failed to fetch products: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    res.json({ products: data.products });
  } catch (error: any) {
    console.error('Failed to fetch products:', error);
    res.status(500).json({ 
      error: 'Failed to fetch products',
      details: error.message
    });
  }
});

// Get order attribution (UTM parameters) via GraphQL
// router.get('/orders/:orderId/attribution', async (req, res) => {
//   try {
//     const storeDomain = req.headers['x-shopify-store-domain'] as string;
//     const accessToken = req.headers['x-shopify-access-token'] as string;
//     const orderId = req.params.orderId;

//     if (!storeDomain || !accessToken) {
//       return res.status(400).json({ 
//         error: 'Missing required headers',
//         missing: {
//           storeDomain: !storeDomain,
//           accessToken: !accessToken
//         }
//       });
//     }

//     if (!orderId) {
//       return res.status(400).json({ 
//         error: 'Missing order ID parameter'
//       });
//     }

//     const attribution = await fetchOrderAttribution(storeDomain, accessToken, orderId);
//     res.json(attribution);
//   } catch (error: any) {
//     console.error('Failed to fetch order attribution:', error);
//     res.status(500).json({ 
//       error: 'Failed to fetch order attribution',
//       details: error.message
//     });
//   }
// });

export default router; 