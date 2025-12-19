import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
const prisma = new PrismaClient();

// Validation schemas
const VariantCostSchema = z.object({
  variant_id: z.number(),
  country_code: z.string().length(2),
  shipping_company: z.string(),
  cost: z.number().positive(),
});

const ComboItemSchema = z.object({
  variant_id: z.number(),
  qty: z.number().positive(),
});

const ComboSchema = z.object({
  combo_id: z.string(),
  name: z.string(),
  trigger_quantity: z.number().positive(),
  items: z.array(ComboItemSchema),
  overrides: z.array(z.object({
    country_code: z.string().length(2),
    shipping_company: z.string(),
    override_cost: z.number().optional(),
    discount_type: z.enum(['percent', 'fixed']).optional(),
    discount_value: z.number().optional(),
  })).optional(),
});

const CogsConfigSchema = z.object({
  version: z.string(),
  currency: z.string(),
  products: z.array(z.object({
    variant_id: z.number(),
    sku: z.string().optional(),
    base_cost: z.number(),
    overrides: z.array(z.object({
      country: z.string(),
      shipping_company: z.string(),
      cost: z.number(),
    })).optional(),
  })),
  combos: z.array(ComboSchema).optional(),
});

// Helper function to get or create country
async function getOrCreateCountry(countryCode: string, name?: string) {
  // Ensure country code is exactly 2 characters (ISO 3166-1 alpha-2)
  const normalizedCountryCode = countryCode ? countryCode.substring(0, 2).toUpperCase() : 'US';

  let country = await prisma.$queryRaw`
    SELECT * FROM countries WHERE code = ${normalizedCountryCode} LIMIT 1
  `;

  if (!country || (country as any[]).length === 0) {
    const countryNames: Record<string, string> = {
      'US': 'United States',
      'CA': 'Canada',
      'AU': 'Australia',
      'UK': 'United Kingdom',
      'DE': 'Germany',
      'FR': 'France',
      'IT': 'Italy',
      'ES': 'Spain',
    };

    const countryId = uuidv4();
    const countryName = name || countryNames[normalizedCountryCode] || normalizedCountryCode;
    const currency = normalizedCountryCode === 'US' ? 'USD' :
      normalizedCountryCode === 'CA' ? 'CAD' :
        normalizedCountryCode === 'AU' ? 'AUD' :
          normalizedCountryCode === 'UK' ? 'GBP' : 'USD';

    await prisma.$executeRaw`
      INSERT INTO countries (id, code, name, currency) 
      VALUES (${countryId}, ${normalizedCountryCode}, ${countryName}, ${currency})
    `;

    country = await prisma.$queryRaw`
      SELECT * FROM countries WHERE id = ${countryId} LIMIT 1
    `;
  }

  return (country as any[])[0];
}

// Helper function to get or create shipping company
async function getOrCreateShippingCompany(companyName: string) {
  let company = await prisma.$queryRaw`
    SELECT * FROM shipping_companies WHERE name = ${companyName} LIMIT 1
  `;

  if (!company || (company as any[]).length === 0) {
    const companyId = uuidv4();

    await prisma.$executeRaw`
      INSERT INTO shipping_companies (id, name, display_name) 
      VALUES (${companyId}, ${companyName}, ${companyName})
    `;

    company = await prisma.$queryRaw`
      SELECT * FROM shipping_companies WHERE id = ${companyId} LIMIT 1
    `;
  }

  return (company as any[])[0];
}

// GET /api/cogs/config - Get current COGS configuration
router.get('/config', async (req, res) => {
  try {
    // Get all variant costs with country and shipping company info
    const variantCosts = await prisma.$queryRaw`
      SELECT 
        vc.*,
        c.code as country_code,
        c.name as country_name,
        sc.name as shipping_company_name
      FROM variant_costs vc
      JOIN countries c ON vc.country_id = c.id
      JOIN shipping_companies sc ON vc.shipping_company_id = sc.id
      WHERE vc.is_active = true
    `;

    // Get all combos with items
    const combos = await prisma.$queryRaw`
      SELECT 
        co.*,
        ci.variant_id as item_variant_id,
        ci.quantity as item_quantity
      FROM combos co
      LEFT JOIN combo_items ci ON co.id = ci.combo_id
      WHERE co.is_active = true
    `;

    // Get combo overrides
    const comboOverrides = await prisma.$queryRaw`
      SELECT 
        co.*,
        c.code as country_code,
        sc.name as shipping_company_name
      FROM combo_overrides co
      JOIN countries c ON co.country_id = c.id
      JOIN shipping_companies sc ON co.shipping_company_id = sc.id
      WHERE co.is_active = true
    `;

    // Transform to the expected format
    const products = (variantCosts as any[]).reduce((acc: any[], cost) => {
      let product = acc.find(p => p.variant_id === Number(cost.variant_id));

      if (!product) {
        product = {
          variant_id: Number(cost.variant_id),
          base_cost: 0, // We'll need to determine base cost logic
          overrides: [],
        };
        acc.push(product);
      }

      // Add override for this country/shipping combination
      product.overrides.push({
        country: cost.country_code,
        shipping_company: cost.shipping_company_name,
        cost: Number(cost.cost),
      });

      return acc;
    }, []);

    // Group combos by combo_id
    const comboMap = new Map();
    (combos as any[]).forEach(row => {
      if (!comboMap.has(row.combo_id)) {
        comboMap.set(row.combo_id, {
          combo_id: row.combo_id,
          name: row.name,
          trigger_quantity: row.trigger_quantity,
          items: [],
          overrides: []
        });
      }

      if (row.item_variant_id) {
        comboMap.get(row.combo_id).items.push({
          variant_id: Number(row.item_variant_id),
          qty: row.item_quantity,
        });
      }
    });

    // Add overrides to combos
    (comboOverrides as any[]).forEach(override => {
      const combo = comboMap.get(override.combo_id);
      if (combo) {
        combo.overrides.push({
          country: override.country_code,
          shipping_company: override.shipping_company_name,
          override_cost: override.override_cost ? Number(override.override_cost) : undefined,
        });
      }
    });

    const transformedCombos = Array.from(comboMap.values()).map(combo => ({
      ...combo,
      cogs_rule: {
        mode: 'sum' as const,
        discount_type: null,
        discount_value: 0,
      },
    }));

    const config = {
      version: "1.0",
      currency: "USD",
      products,
      combos: transformedCombos,
    };

    res.json(config);
  } catch (error) {
    console.error('Error fetching COGS config:', error);
    res.status(500).json({ error: 'Failed to fetch COGS configuration' });
  }
});

// POST /api/cogs/config - Save COGS configuration
router.post('/config', async (req, res) => {
  try {
    const config = CogsConfigSchema.parse(req.body);

    // Start a transaction
    await prisma.$transaction(async (tx) => {
      // Clear existing data
      await tx.$executeRaw`DELETE FROM variant_costs`;
      await tx.$executeRaw`DELETE FROM combo_overrides`;
      await tx.$executeRaw`DELETE FROM combo_items`;
      await tx.$executeRaw`DELETE FROM combos`;

      // Process products
      for (const product of config.products) {
        // Create base cost entry (using US as default)
        const usCountry = await getOrCreateCountry('US');
        const defaultShipping = await getOrCreateShippingCompany('YunTu');

        const variantCostId = uuidv4();
        await tx.$executeRaw`
          INSERT INTO variant_costs (id, variant_id, country_id, shipping_company_id, cost)
          VALUES (${variantCostId}, ${product.variant_id}, ${usCountry.id}, ${defaultShipping.id}, ${product.base_cost})
        `;

        // Process overrides
        if (product.overrides) {
          for (const override of product.overrides) {
            const country = await getOrCreateCountry(override.country);
            const shippingCompany = await getOrCreateShippingCompany(override.shipping_company);

            const overrideId = uuidv4();
            await tx.$executeRaw`
              INSERT INTO variant_costs (id, variant_id, country_id, shipping_company_id, cost)
              VALUES (${overrideId}, ${product.variant_id}, ${country.id}, ${shippingCompany.id}, ${override.cost})
              ON CONFLICT (variant_id, country_id, shipping_company_id) 
              DO UPDATE SET cost = ${override.cost}
            `;
          }
        }
      }

      // Process combos
      if (config.combos) {
        for (const combo of config.combos) {
          const comboId = uuidv4();
          await tx.$executeRaw`
            INSERT INTO combos (id, combo_id, name, trigger_quantity)
            VALUES (${comboId}, ${combo.combo_id}, ${combo.name}, ${combo.trigger_quantity})
          `;

          // Create combo items
          for (const item of combo.items) {
            const itemId = uuidv4();
            await tx.$executeRaw`
              INSERT INTO combo_items (id, combo_id, variant_id, quantity)
              VALUES (${itemId}, ${comboId}, ${item.variant_id}, ${item.qty})
            `;
          }

          // Create combo overrides
          if (combo.overrides) {
            for (const override of combo.overrides) {
              const country = await getOrCreateCountry(override.country_code);
              const shippingCompany = await getOrCreateShippingCompany(override.shipping_company);

              const overrideId = uuidv4();
              await tx.$executeRaw`
                INSERT INTO combo_overrides (id, combo_id, country_id, shipping_company_id, override_cost, discount_type, discount_value)
                VALUES (${overrideId}, ${comboId}, ${country.id}, ${shippingCompany.id}, ${override.override_cost || null}, ${override.discount_type || null}, ${override.discount_value || null})
              `;
            }
          }
        }
      }
    });

    res.json({ success: true, message: 'COGS configuration saved successfully' });
  } catch (error) {
    console.error('Error saving COGS config:', error);
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid data format', details: error.issues });
    } else {
      res.status(500).json({ error: 'Failed to save COGS configuration' });
    }
  }
});

// GET /api/cogs/countries - Get all countries
router.get('/countries', async (req, res) => {
  try {
    const countries = await prisma.$queryRaw`
      SELECT * FROM countries ORDER BY name ASC
    `;
    res.json(countries);
  } catch (error) {
    console.error('Error fetching countries:', error);
    res.status(500).json({ error: 'Failed to fetch countries' });
  }
});

// GET /api/cogs/shipping-companies - Get all shipping companies
router.get('/shipping-companies', async (req, res) => {
  try {
    const companies = await prisma.$queryRaw`
      SELECT * FROM shipping_companies WHERE is_active = true ORDER BY name ASC
    `;
    res.json(companies);
  } catch (error) {
    console.error('Error fetching shipping companies:', error);
    res.status(500).json({ error: 'Failed to fetch shipping companies' });
  }
});

// POST /api/cogs/shipping-companies - Create new shipping company
router.post('/shipping-companies', async (req, res) => {
  try {
    const { name, display_name, tracking_prefixes } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const companyId = uuidv4();
    await prisma.$executeRaw`
      INSERT INTO shipping_companies (id, name, display_name, tracking_prefixes, is_active)
      VALUES (${companyId}, ${name}, ${display_name || name}, ${tracking_prefixes || null}, true)
    `;

    const company = await prisma.$queryRaw`
      SELECT * FROM shipping_companies WHERE id = ${companyId} LIMIT 1
    `;

    res.status(201).json((company as any[])[0]);
  } catch (error) {
    console.error('Error creating shipping company:', error);
    res.status(500).json({ error: 'Failed to create shipping company' });
  }
});

// PUT /api/cogs/shipping-companies/:id - Update shipping company
router.put('/shipping-companies/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, display_name, tracking_prefixes, is_active } = req.body;

    await prisma.$executeRaw`
      UPDATE shipping_companies
      SET name = ${name},
          display_name = ${display_name || name},
          tracking_prefixes = ${tracking_prefixes || null},
          is_active = ${is_active !== undefined ? is_active : true}
      WHERE id = ${id}
    `;

    const company = await prisma.$queryRaw`
      SELECT * FROM shipping_companies WHERE id = ${id} LIMIT 1
    `;

    if (!company || (company as any[]).length === 0) {
      return res.status(404).json({ error: 'Shipping company not found' });
    }

    res.json((company as any[])[0]);
  } catch (error) {
    console.error('Error updating shipping company:', error);
    res.status(500).json({ error: 'Failed to update shipping company' });
  }
});

// DELETE /api/cogs/shipping-companies/:id - Delete (soft delete) shipping company
router.delete('/shipping-companies/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Soft delete by setting is_active to false
    await prisma.$executeRaw`
      UPDATE shipping_companies
      SET is_active = false
      WHERE id = ${id}
    `;

    res.json({ success: true, message: 'Shipping company deleted successfully' });
  } catch (error) {
    console.error('Error deleting shipping company:', error);
    res.status(500).json({ error: 'Failed to delete shipping company' });
  }
});

// POST /api/cogs/calculate-bulk - Calculate COGS for multiple orders
router.post('/calculate-bulk', async (req, res) => {
  try {
    const { orders } = req.body;

    if (!orders || !Array.isArray(orders)) {
      return res.status(400).json({ error: 'orders is required and must be an array' });
    }

    const results = [];

    for (const orderData of orders) {
      const { order_lines, country_code, shipping_company, order_id } = orderData;

      if (!order_lines || !Array.isArray(order_lines)) {
        results.push({
          order_id,
          total_cogs: 0,
          line_details: [],
          error: 'order_lines is required and must be an array'
        });
        continue;
      }

      const country = await getOrCreateCountry(country_code || 'US');
      const shipping = await getOrCreateShippingCompany(shipping_company || 'YunTu');

      let totalCogs = 0;
      const lineDetails = [];

      for (const line of order_lines) {
        const variantCosts = await prisma.$queryRaw`
          SELECT * FROM variant_costs 
          WHERE variant_id = ${line.variant_id} 
          AND country_id = ${country.id} 
          AND shipping_company_id = ${shipping.id}
          AND is_active = true
          LIMIT 1
        `;

        if (variantCosts && (variantCosts as any[]).length > 0) {
          const variantCost = (variantCosts as any[])[0];
          const lineCost = Number(variantCost.cost) * line.quantity;
          totalCogs += lineCost;
          lineDetails.push({
            variant_id: line.variant_id,
            quantity: line.quantity,
            unit_cost: Number(variantCost.cost),
            total_cost: lineCost,
          });
        }
      }

      results.push({
        order_id,
        total_cogs: totalCogs,
        line_details: lineDetails,
        country: country.code,
        shipping_company: shipping.name,
      });
    }

    res.json({ results });
  } catch (error) {
    console.error('Error calculating bulk COGS:', error);
    res.status(500).json({ error: 'Failed to calculate bulk COGS' });
  }
});

// POST /api/cogs/calculate - Calculate COGS for an order
router.post('/calculate', async (req, res) => {
  try {
    const { order_lines, country_code, shipping_company } = req.body;

    if (!order_lines || !Array.isArray(order_lines)) {
      return res.status(400).json({ error: 'order_lines is required and must be an array' });
    }

    const country = await getOrCreateCountry(country_code || 'US');
    const shipping = await getOrCreateShippingCompany(shipping_company || 'YunTu');

    let totalCogs = 0;
    const lineDetails = [];

    for (const line of order_lines) {
      const variantCosts = await prisma.$queryRaw`
        SELECT * FROM variant_costs 
        WHERE variant_id = ${line.variant_id} 
        AND country_id = ${country.id} 
        AND shipping_company_id = ${shipping.id}
        AND is_active = true
        LIMIT 1
      `;

      if (variantCosts && (variantCosts as any[]).length > 0) {
        const variantCost = (variantCosts as any[])[0];
        const lineCost = Number(variantCost.cost) * line.quantity;
        totalCogs += lineCost;
        lineDetails.push({
          variant_id: line.variant_id,
          quantity: line.quantity,
          unit_cost: Number(variantCost.cost),
          total_cost: lineCost,
        });
      }
    }

    res.json({
      total_cogs: totalCogs,
      line_details: lineDetails,
      country: country.code,
      shipping_company: shipping.name,
    });
  } catch (error) {
    console.error('Error calculating COGS:', error);
    res.status(500).json({ error: 'Failed to calculate COGS' });
  }
});

export default router;
