import express from 'express';
import { ComprehensiveCOGSService } from '../services/comprehensive-cogs.service';
import { 
  CreatePricebookRequest, 
  CreateShippingTierRequest, 
  CreateVariantCostOverrideRequest,
  CreateComboRequest,
  CreateComboOverrideRequest,
  PricebookImportConfig,
  QuoteRequest
} from '../types/cogs';

import { requireAuth, requireActive } from '../middleware/require-auth';
import { resolveStore, requireStoreCapability } from '../middleware/resolve-store';

const router = express.Router();

/**
 * Identity comes from the JWT, never from the client. Every handler here
 * used to read `X-User-Id` / `X-Store-Id` off the request with no auth
 * middleware mounted, so any caller who reached the port could read or
 * write another merchant's pricebooks, combos and cost overrides by
 * supplying an id. Same guard chain as cogs-matrix.routes.
 */
router.use(requireAuth, requireActive, resolveStore);

// ===== PRICEBOOK ROUTES =====

// POST /pricebooks
router.post('/pricebooks', requireStoreCapability('costs'), async (req, res) => {
  try {
    const { userId, storeId } = req.resolved!;
    const data: CreatePricebookRequest = req.body;


    if (!data.country_code || !data.shipping_company || !data.currency) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['country_code', 'shipping_company', 'currency']
      });
    }

    const result = await ComprehensiveCOGSService.createPricebook(userId, storeId, data);
    res.json(result);
  } catch (error: any) {
    console.error('Failed to create pricebook:', error);
    res.status(500).json({ 
      error: 'Failed to create pricebook',
      details: error.message
    });
  }
});

// GET /pricebooks
router.get('/pricebooks', async (req, res) => {
  try {
    const { userId, storeId } = req.resolved!;
    const { country_code, shipping_company } = req.query;


    const filters = {
      ...(country_code && { country_code: country_code as string }),
      ...(shipping_company && { shipping_company: shipping_company as string })
    };

    const pricebooks = await ComprehensiveCOGSService.getPricebooks(userId, storeId, filters);
    res.json(pricebooks);
  } catch (error: any) {
    console.error('Failed to fetch pricebooks:', error);
    res.status(500).json({ 
      error: 'Failed to fetch pricebooks',
      details: error.message
    });
  }
});

// PATCH /pricebooks/:pricebook_id
router.patch('/pricebooks/:pricebook_id', requireStoreCapability('costs'), async (req, res) => {
  try {
    const userId = req.userId!;
    const { pricebook_id } = req.params;
    const data = req.body;


    const result = await ComprehensiveCOGSService.updatePricebook(userId, pricebook_id, data);
    res.json(result);
  } catch (error: any) {
    console.error('Failed to update pricebook:', error);
    res.status(500).json({ 
      error: 'Failed to update pricebook',
      details: error.message
    });
  }
});

// DELETE /pricebooks/:pricebook_id
router.delete('/pricebooks/:pricebook_id', requireStoreCapability('costs'), async (req, res) => {
  try {
    const userId = req.userId!;
    const { pricebook_id } = req.params;


    const result = await ComprehensiveCOGSService.deletePricebook(userId, pricebook_id);
    res.json(result);
  } catch (error: any) {
    console.error('Failed to delete pricebook:', error);
    res.status(500).json({ 
      error: 'Failed to delete pricebook',
      details: error.message
    });
  }
});

// ===== SHIPPING TIERS ROUTES =====

// POST /pricebooks/:pricebook_id/tiers
router.post('/pricebooks/:pricebook_id/tiers', requireStoreCapability('costs'), async (req, res) => {
  try {
    const userId = req.userId!;
    const { pricebook_id } = req.params;
    const data: CreateShippingTierRequest = req.body;


    if (!data.min_items || !data.max_items || data.shipping_cost === undefined) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['min_items', 'max_items', 'shipping_cost']
      });
    }

    const result = await ComprehensiveCOGSService.addShippingTier(userId, pricebook_id, data);
    res.json(result);
  } catch (error: any) {
    console.error('Failed to add shipping tier:', error);
    res.status(500).json({ 
      error: 'Failed to add shipping tier',
      details: error.message
    });
  }
});

// GET /pricebooks/:pricebook_id/tiers
router.get('/pricebooks/:pricebook_id/tiers', async (req, res) => {
  try {
    const userId = req.userId!;
    const { pricebook_id } = req.params;


    const tiers = await ComprehensiveCOGSService.getShippingTiers(userId, pricebook_id);
    res.json(tiers);
  } catch (error: any) {
    console.error('Failed to fetch shipping tiers:', error);
    res.status(500).json({ 
      error: 'Failed to fetch shipping tiers',
      details: error.message
    });
  }
});

// PUT /pricebooks/:pricebook_id/tiers (bulk replace)
router.put('/pricebooks/:pricebook_id/tiers', requireStoreCapability('costs'), async (req, res) => {
  try {
    const userId = req.userId!;
    const { pricebook_id } = req.params;
    const { tiers } = req.body;


    if (!Array.isArray(tiers)) {
      return res.status(400).json({ error: 'tiers must be an array' });
    }

    const result = await ComprehensiveCOGSService.updateShippingTiers(userId, pricebook_id, tiers);
    res.json(result);
  } catch (error: any) {
    console.error('Failed to update shipping tiers:', error);
    res.status(500).json({ 
      error: 'Failed to update shipping tiers',
      details: error.message
    });
  }
});

// DELETE /pricebooks/:pricebook_id/tiers
router.delete('/pricebooks/:pricebook_id/tiers', requireStoreCapability('costs'), async (req, res) => {
  try {
    const userId = req.userId!;
    const { pricebook_id } = req.params;
    const { min_items, max_items } = req.query;


    if (!min_items || !max_items) {
      return res.status(400).json({ 
        error: 'Missing required query parameters',
        required: ['min_items', 'max_items']
      });
    }

    const result = await ComprehensiveCOGSService.deleteShippingTier(
      userId, 
      pricebook_id, 
      parseInt(min_items as string), 
      parseInt(max_items as string)
    );
    res.json(result);
  } catch (error: any) {
    console.error('Failed to delete shipping tier:', error);
    res.status(500).json({ 
      error: 'Failed to delete shipping tier',
      details: error.message
    });
  }
});

// ===== VARIANT COST OVERRIDES ROUTES =====

// POST /pricebooks/:pricebook_id/variant-costs
router.post('/pricebooks/:pricebook_id/variant-costs', requireStoreCapability('costs'), async (req, res) => {
  try {
    const userId = req.userId!;
    const { pricebook_id } = req.params;
    const data: CreateVariantCostOverrideRequest = req.body;


    if (!data.variant_id || data.override_cost === undefined) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['variant_id', 'override_cost']
      });
    }

    const result = await ComprehensiveCOGSService.addVariantCostOverride(userId, pricebook_id, data);
    res.json(result);
  } catch (error: any) {
    console.error('Failed to add variant cost override:', error);
    res.status(500).json({ 
      error: 'Failed to add variant cost override',
      details: error.message
    });
  }
});

// GET /pricebooks/:pricebook_id/variant-costs
router.get('/pricebooks/:pricebook_id/variant-costs', async (req, res) => {
  try {
    const userId = req.userId!;
    const { pricebook_id } = req.params;


    const overrides = await ComprehensiveCOGSService.getVariantCostOverrides(userId, pricebook_id);
    res.json(overrides);
  } catch (error: any) {
    console.error('Failed to fetch variant cost overrides:', error);
    res.status(500).json({ 
      error: 'Failed to fetch variant cost overrides',
      details: error.message
    });
  }
});

// DELETE /pricebooks/:pricebook_id/variant-costs/:variant_id
router.delete('/pricebooks/:pricebook_id/variant-costs/:variant_id', requireStoreCapability('costs'), async (req, res) => {
  try {
    const userId = req.userId!;
    const { pricebook_id, variant_id } = req.params;


    const result = await ComprehensiveCOGSService.deleteVariantCostOverride(
      userId, 
      pricebook_id, 
      parseInt(variant_id)
    );
    res.json(result);
  } catch (error: any) {
    console.error('Failed to delete variant cost override:', error);
    res.status(500).json({ 
      error: 'Failed to delete variant cost override',
      details: error.message
    });
  }
});

// ===== COMBO ROUTES =====

// POST /combos
router.post('/combos', requireStoreCapability('costs'), async (req, res) => {
  try {
    const { userId, storeId } = req.resolved!;
    const data: CreateComboRequest = req.body;


    if (!data.name || !data.items || !Array.isArray(data.items)) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['name', 'items']
      });
    }

    const result = await ComprehensiveCOGSService.createCombo(userId, storeId, data);
    res.json(result);
  } catch (error: any) {
    console.error('Failed to create combo:', error);
    res.status(500).json({ 
      error: 'Failed to create combo',
      details: error.message
    });
  }
});

// GET /combos/:combo_id
router.get('/combos/:combo_id', async (req, res) => {
  try {
    const userId = req.userId!;
    const { combo_id } = req.params;


    const combo = await ComprehensiveCOGSService.getCombo(userId, combo_id);
    res.json(combo);
  } catch (error: any) {
    console.error('Failed to fetch combo:', error);
    res.status(500).json({ 
      error: 'Failed to fetch combo',
      details: error.message
    });
  }
});

// PATCH /combos/:combo_id
router.patch('/combos/:combo_id', requireStoreCapability('costs'), async (req, res) => {
  try {
    const userId = req.userId!;
    const { combo_id } = req.params;
    const data = req.body;


    const result = await ComprehensiveCOGSService.updateCombo(userId, combo_id, data);
    res.json(result);
  } catch (error: any) {
    console.error('Failed to update combo:', error);
    res.status(500).json({ 
      error: 'Failed to update combo',
      details: error.message
    });
  }
});

// DELETE /combos/:combo_id
router.delete('/combos/:combo_id', requireStoreCapability('costs'), async (req, res) => {
  try {
    const userId = req.userId!;
    const { combo_id } = req.params;


    const result = await ComprehensiveCOGSService.deleteCombo(userId, combo_id);
    res.json(result);
  } catch (error: any) {
    console.error('Failed to delete combo:', error);
    res.status(500).json({ 
      error: 'Failed to delete combo',
      details: error.message
    });
  }
});

// ===== COMBO OVERRIDES ROUTES =====

// POST /pricebooks/:pricebook_id/combo-overrides
router.post('/pricebooks/:pricebook_id/combo-overrides', requireStoreCapability('costs'), async (req, res) => {
  try {
    const userId = req.userId!;
    const { pricebook_id } = req.params;
    const data: CreateComboOverrideRequest = req.body;


    if (!data.combo_id) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['combo_id']
      });
    }

    const result = await ComprehensiveCOGSService.addComboOverride(userId, pricebook_id, data);
    res.json(result);
  } catch (error: any) {
    console.error('Failed to add combo override:', error);
    res.status(500).json({ 
      error: 'Failed to add combo override',
      details: error.message
    });
  }
});

// GET /pricebooks/:pricebook_id/combo-overrides
router.get('/pricebooks/:pricebook_id/combo-overrides', async (req, res) => {
  try {
    const userId = req.userId!;
    const { pricebook_id } = req.params;


    const overrides = await ComprehensiveCOGSService.getComboOverrides(userId, pricebook_id);
    res.json(overrides);
  } catch (error: any) {
    console.error('Failed to fetch combo overrides:', error);
    res.status(500).json({ 
      error: 'Failed to fetch combo overrides',
      details: error.message
    });
  }
});

// DELETE /pricebooks/:pricebook_id/combo-overrides/:combo_id
router.delete('/pricebooks/:pricebook_id/combo-overrides/:combo_id', requireStoreCapability('costs'), async (req, res) => {
  try {
    const userId = req.userId!;
    const { pricebook_id, combo_id } = req.params;


    const result = await ComprehensiveCOGSService.deleteComboOverride(userId, pricebook_id, combo_id);
    res.json(result);
  } catch (error: any) {
    console.error('Failed to delete combo override:', error);
    res.status(500).json({ 
      error: 'Failed to delete combo override',
      details: error.message
    });
  }
});

// ===== UTILITY ROUTES =====

// POST /pricebooks/import
router.post('/pricebooks/import', requireStoreCapability('costs'), async (req, res) => {
  try {
    const { userId, storeId } = req.resolved!;
    const config: PricebookImportConfig = req.body;


    if (!config.country_code || !config.shipping_company || !config.currency) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['country_code', 'shipping_company', 'currency']
      });
    }

    const result = await ComprehensiveCOGSService.importPricebook(userId, storeId, config);
    res.json(result);
  } catch (error: any) {
    console.error('Failed to import pricebook:', error);
    res.status(500).json({ 
      error: 'Failed to import pricebook',
      details: error.message
    });
  }
});

// POST /cost/quote
router.post('/cost/quote', requireStoreCapability('read'), async (req, res) => {
  try {
    const userId = req.userId!;
    const request: QuoteRequest = req.body;


    if (!request.country_code || !request.shipping_company || !request.currency) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['country_code', 'shipping_company', 'currency']
      });
    }

    if (!request.lines && !request.combo_id) {
      return res.status(400).json({ 
        error: 'Either lines or combo_id must be provided'
      });
    }

    const result = await ComprehensiveCOGSService.calculateCost(userId, request);
    res.json(result);
  } catch (error: any) {
    console.error('Failed to calculate cost:', error);
    res.status(500).json({ 
      error: 'Failed to calculate cost',
      details: error.message
    });
  }
});

export default router;
