import express from 'express';
import { COGSService } from '../services/cogs.service';

const router = express.Router();

// Get all COGS configurations for a user and store
router.get('/configs', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const storeId = req.headers['x-store-id'] as string;

    if (!userId || !storeId) {
      return res.status(400).json({
        error: 'Missing required headers',
        missing: {
          userId: !userId,
          storeId: !storeId
        }
      });
    }

    const configs = await COGSService.getCOGSConfigs(userId, storeId);
    res.json({ configs });
  } catch (error: any) {
    console.error('Failed to fetch COGS configs:', error);
    res.status(500).json({
      error: 'Failed to fetch COGS configurations',
      details: error.message
    });
  }
});

// Create a new COGS configuration
router.post('/configs', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const storeId = req.headers['x-store-id'] as string;

    if (!userId || !storeId) {
      return res.status(400).json({
        error: 'Missing required headers',
        missing: {
          userId: !userId,
          storeId: !storeId
        }
      });
    }

    const config = await COGSService.createCOGSConfig(userId, storeId, req.body);
    res.status(201).json({ config });
  } catch (error: any) {
    console.error('Failed to create COGS config:', error);
    res.status(500).json({
      error: 'Failed to create COGS configuration',
      details: error.message
    });
  }
});

// Update an existing COGS configuration
router.put('/configs/:configId', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const { configId } = req.params;

    if (!userId) {
      return res.status(400).json({
        error: 'Missing required headers',
        missing: {
          userId: !userId
        }
      });
    }

    const config = await COGSService.updateCOGSConfig(userId, configId, req.body);
    res.json({ config });
  } catch (error: any) {
    console.error('Failed to update COGS config:', error);
    res.status(500).json({
      error: 'Failed to update COGS configuration',
      details: error.message
    });
  }
});

// Delete a COGS configuration
router.delete('/configs/:configId', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const { configId } = req.params;

    if (!userId) {
      return res.status(400).json({
        error: 'Missing required headers',
        missing: {
          userId: !userId
        }
      });
    }

    await COGSService.deleteCOGSConfig(userId, configId);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Failed to delete COGS config:', error);
    res.status(500).json({
      error: 'Failed to delete COGS configuration',
      details: error.message
    });
  }
});

// Bulk create COGS configurations
router.post('/configs/bulk', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const storeId = req.headers['x-store-id'] as string;

    if (!userId || !storeId) {
      return res.status(400).json({
        error: 'Missing required headers',
        missing: {
          userId: !userId,
          storeId: !storeId
        }
      });
    }

    const { configs } = req.body;
    if (!Array.isArray(configs)) {
      return res.status(400).json({
        error: 'Configs must be an array'
      });
    }

    // Validate each config
    for (let i = 0; i < configs.length; i++) {
      const config = configs[i];
      if (!config.variantId || !config.productId || !config.productTitle || !config.variantTitle) {
        return res.status(400).json({
          error: `Config ${i + 1} is missing required fields`,
          missing: {
            variantId: !config.variantId,
            productId: !config.productId,
            productTitle: !config.productTitle,
            variantTitle: !config.variantTitle
          }
        });
      }
    }

    console.log('Bulk create request:', { userId, storeId, configCount: configs.length });
    const result = await COGSService.bulkCreateCOGSConfigs(userId, storeId, configs);
    res.status(201).json(result);
  } catch (error: any) {
    console.error('Failed to bulk create COGS configs:', error);
    res.status(500).json({
      error: 'Failed to bulk create COGS configurations',
      details: error.message
    });
  }
});

// Combo Pricing routes
router.post('/:configId/combo-pricing', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const { configId } = req.params;
    const comboData = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'Missing X-User-Id header' });
    }

    if (!comboData.supplier || !comboData.country || !comboData.comboType ||
      !comboData.quantity || comboData.productCost === undefined || comboData.shippingCost === undefined) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['supplier', 'country', 'comboType', 'quantity', 'productCost', 'shippingCost']
      });
    }

    const combo = await COGSService.addComboPricing(userId, configId, comboData);
    res.json(combo);
  } catch (error: any) {
    console.error('Failed to add combo pricing:', error);
    res.status(500).json({
      error: 'Failed to add combo pricing',
      details: error.message
    });
  }
});

router.put('/combo-pricing/:comboId', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const { comboId } = req.params;
    const comboData = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'Missing X-User-Id header' });
    }

    const combo = await COGSService.updateComboPricing(userId, comboId, comboData);
    res.json(combo);
  } catch (error: any) {
    console.error('Failed to update combo pricing:', error);
    res.status(500).json({
      error: 'Failed to update combo pricing',
      details: error.message
    });
  }
});

router.delete('/combo-pricing/:comboId', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const { comboId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: 'Missing X-User-Id header' });
    }

    const result = await COGSService.deleteComboPricing(userId, comboId);
    res.json(result);
  } catch (error: any) {
    console.error('Failed to delete combo pricing:', error);
    res.status(500).json({
      error: 'Failed to delete combo pricing',
      details: error.message
    });
  }
});

// Legacy pricing tier routes for backward compatibility
router.put('/pricing-tiers/:tierId', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const { tierId } = req.params;
    const tierData = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'Missing X-User-Id header' });
    }

    const tier = await COGSService.updatePricingTier(userId, tierId, tierData);
    res.json(tier);
  } catch (error: any) {
    console.error('Failed to update pricing tier:', error);
    res.status(500).json({
      error: 'Failed to update pricing tier',
      details: error.message
    });
  }
});

router.delete('/pricing-tiers/:tierId', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const { tierId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: 'Missing X-User-Id header' });
    }

    const result = await COGSService.deletePricingTier(userId, tierId);
    res.json(result);
  } catch (error: any) {
    console.error('Failed to delete pricing tier:', error);
    res.status(500).json({
      error: 'Failed to delete pricing tier',
      details: error.message
    });
  }
});

router.get('/pricing/:variantId/:country/:quantity', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const { variantId, country, quantity } = req.params;

    if (!userId) {
      return res.status(400).json({ error: 'Missing X-User-Id header' });
    }

    const quantityNum = parseInt(quantity);
    if (isNaN(quantityNum) || quantityNum < 1) {
      return res.status(400).json({ error: 'Invalid quantity' });
    }

    const pricing = await COGSService.getPricingForOrder(userId, variantId, country, quantityNum);
    res.json(pricing);
  } catch (error: any) {
    console.error('Failed to get pricing for order:', error);
    res.status(500).json({
      error: 'Failed to get pricing for order',
      details: error.message
    });
  }
});

// Shipping Company Routes
router.get('/shipping-companies', async (req, res) => {
  try {
    const companies = await COGSService.getShippingCompanies();
    res.json(companies);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/shipping-companies', async (req, res) => {
  try {
    const company = await COGSService.createShippingCompany(req.body);
    res.status(201).json(company);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/shipping-companies/:id', async (req, res) => {
  try {
    const company = await COGSService.updateShippingCompany(req.params.id, req.body);
    res.json(company);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/shipping-companies/:id', async (req, res) => {
  try {
    const result = await COGSService.deleteShippingCompany(req.params.id);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
