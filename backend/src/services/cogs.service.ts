import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface COGSConfigData {
  productSKU: string;
  variantId: string | number; // Can be string or number (Shopify returns numbers)
  productId: string | number; // Can be string or number (Shopify returns numbers)
  productTitle: string;
  variantTitle: string;
  baseCost: number;
  handlingFee: number;
  description?: string;
  comboPricing?: ComboPricingData[];
  overrides?: ProductOverrideData[];
}

export interface ProductOverrideData {
  country: string;
  shipping_company: string;
  cost: number;
}

export interface ComboPricingData {
  supplier: string;
  country: string;
  comboType: string;
  quantity: number;
  productCost: number;
  shippingCost: number;
  totalCost?: number;
  isActive?: boolean;
}

// Legacy interfaces for backward compatibility
export interface PricingTierData {
  supplier: string;
  country: string;
  minQuantity: number;
  maxQuantity?: number;
  productCost: number;
  shippingCost: number;
  discount: number;
  isActive?: boolean;
}

export class COGSService {
  // Get all COGS configurations for a user and store
  static async getCOGSConfigs(userId: string, storeId: string) {
    try {
      const configs = await prisma.cOGSConfig.findMany({
        where: {
          userId,
          storeId
        },
        include: {
          comboPricing: {
            where: { isActive: true },
            orderBy: [
              { supplier: 'asc' },
              { country: 'asc' },
              { quantity: 'asc' }
            ]
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      // Fetch overrides for these variants
      const variantIds = configs.map(c => BigInt(c.variantId));
      const overrides = await prisma.pricebookVariantCostOverride.findMany({
        where: {
          variantId: {
            in: variantIds
          }
        },
        include: {
          pricebook: true
        }
      });

      // Map overrides by variantId
      const overridesMap = new Map<string, ProductOverrideData[]>();
      overrides.forEach(o => {
        const vId = o.variantId.toString();
        if (!overridesMap.has(vId)) {
          overridesMap.set(vId, []);
        }
        overridesMap.get(vId)?.push({
          country: o.pricebook.countryCode,
          shipping_company: o.pricebook.shippingCompany,
          cost: Number(o.overrideCost)
        });
      });

      return configs.map(config => ({
        id: config.id,
        productSKU: config.productSKU,
        variantId: config.variantId,
        productId: config.productId,
        productTitle: config.productTitle,
        variantTitle: config.variantTitle,
        baseCost: config.baseCost,
        handlingFee: config.handlingFee,
        description: config.description,
        comboPricing: config.comboPricing.map(combo => ({
          id: combo.id,
          supplier: combo.supplier,
          country: combo.country,
          comboType: combo.comboType,
          quantity: combo.quantity,
          productCost: combo.productCost,
          shippingCost: combo.shippingCost,
          totalCost: combo.totalCost,
          isActive: combo.isActive
        })),
        overrides: overridesMap.get(config.variantId) || []
      }));
    } catch (error) {
      console.error('Error fetching COGS configs:', error);
      throw new Error('Failed to fetch COGS configurations');
    }
  }

  // Create a new COGS configuration
  static async createCOGSConfig(userId: string, storeId: string, data: COGSConfigData) {
    try {
      console.log('Creating COGS config with data:', { userId, storeId, data });

      // First, ensure User and ShopifyStore records exist
      await this.ensureUserAndStoreExist(userId, storeId);

      const config = await prisma.cOGSConfig.upsert({
        where: {
          userId_storeId_variantId: {
            userId,
            storeId,
            variantId: String(data.variantId)
          }
        },
        create: {
          userId,
          storeId,
          productSKU: data.productSKU,
          variantId: String(data.variantId), // Convert to string
          productId: String(data.productId), // Convert to string
          productTitle: data.productTitle,
          variantTitle: data.variantTitle,
          baseCost: data.baseCost,
          handlingFee: data.handlingFee,
          description: data.description,
          comboPricing: data.comboPricing ? {
            create: data.comboPricing.map(combo => ({
              userId,
              storeId,
              supplier: combo.supplier,
              country: combo.country,
              comboType: combo.comboType,
              quantity: combo.quantity,
              productCost: combo.productCost,
              shippingCost: combo.shippingCost,
              totalCost: combo.totalCost || (combo.productCost * combo.quantity + combo.shippingCost),
              isActive: combo.isActive ?? true
            }))
          } : undefined
        },
        update: {
          productSKU: data.productSKU,
          productId: String(data.productId),
          productTitle: data.productTitle,
          variantTitle: data.variantTitle,
          baseCost: data.baseCost,
          handlingFee: data.handlingFee,
          description: data.description
          // Note: We are not updating comboPricing here as it's complex to diff. 
          // Users should use specific combo endpoints or we can implement full replace logic if needed.
          // For now, baseCost update is the primary goal.
        },
        include: {
          comboPricing: true
        }
      });

      // Handle Overrides (New System)
      if (data.overrides && data.overrides.length > 0) {
        try {
          // 1. Ensure ProductVariant exists
          await prisma.productVariant.upsert({
            where: {
              userId_storeId_variantId: {
                userId,
                storeId,
                variantId: BigInt(data.variantId)
              }
            },
            create: {
              variantId: BigInt(data.variantId),
              userId,
              storeId,
              sku: data.productSKU,
              title: data.variantTitle,
              productId: BigInt(data.productId),
              baseCost: data.baseCost
            },
            update: {
              baseCost: data.baseCost,
              sku: data.productSKU,
              title: data.variantTitle
            }
          });

          // 2. Process each override
          for (const override of data.overrides) {
            // Find or create Pricebook
            // Note: Pricebook unique constraint is [userId, storeId, countryCode, shippingCompany]
            let pricebook = await prisma.pricebook.findUnique({
              where: {
                userId_storeId_countryCode_shippingCompany: {
                  userId,
                  storeId,
                  countryCode: override.country,
                  shippingCompany: override.shipping_company
                }
              }
            });

            if (!pricebook) {
              pricebook = await prisma.pricebook.create({
                data: {
                  userId,
                  storeId,
                  countryCode: override.country,
                  shippingCompany: override.shipping_company,
                  currency: 'USD' // Default currency
                }
              });
            }

            // Upsert Override
            await prisma.pricebookVariantCostOverride.upsert({
              where: {
                pricebookId_variantId: {
                  pricebookId: pricebook.pricebookId,
                  variantId: BigInt(data.variantId)
                }
              },
              create: {
                pricebookId: pricebook.pricebookId,
                variantId: BigInt(data.variantId),
                overrideCost: override.cost
              },
              update: {
                overrideCost: override.cost
              }
            });
          }
        } catch (err) {
          console.error('Error saving overrides:', err);
          // Don't fail the whole request if overrides fail, but log it
        }
      }

      console.log('Successfully created COGS config:', config.id);

      return {
        id: config.id,
        productSKU: config.productSKU,
        variantId: config.variantId,
        productId: config.productId,
        productTitle: config.productTitle,
        variantTitle: config.variantTitle,
        baseCost: config.baseCost,
        handlingFee: config.handlingFee,
        description: config.description,
        comboPricing: config.comboPricing?.map(combo => ({
          id: combo.id,
          supplier: combo.supplier,
          country: combo.country,
          comboType: combo.comboType,
          quantity: combo.quantity,
          productCost: combo.productCost,
          shippingCost: combo.shippingCost,
          totalCost: combo.totalCost,
          isActive: combo.isActive
        })),
        overrides: data.overrides || []
      };
    } catch (error: any) {
      console.error('Error creating COGS config:', error);
      console.error('Error details:', { code: error.code, message: error.message, meta: error.meta });

      if (error.code === 'P2002') {
        // If COGS config exists, we might still want to update overrides
        // But for now, let's just throw as before, or we could handle upsert logic here
        throw new Error('COGS configuration already exists for this variant');
      }
      throw new Error(`Failed to create COGS configuration: ${error.message}`);
    }
  }

  // Ensure User and ShopifyStore records exist
  private static async ensureUserAndStoreExist(userId: string, storeId: string) {
    try {
      // Check if user exists, create if not
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });

      if (!user) {
        console.log('Creating user:', userId);
        await prisma.user.create({
          data: {
            id: userId,
            email: `${userId}@example.com`, // Default email
            password: 'default-password', // This should be hashed in production
            firstName: 'Default',
            lastName: 'User'
          }
        });
      }

      // Check if store exists, create if not
      const store = await prisma.shopifyStore.findUnique({
        where: { id: storeId }
      });

      if (!store) {
        console.log('Creating store:', storeId);
        await prisma.shopifyStore.create({
          data: {
            id: storeId,
            userId: userId,
            storeDomain: `${storeId}.myshopify.com`,
            accessToken: 'default-token' // This should be the actual token in production
          }
        });
      }
    } catch (error: any) {
      console.error('Error ensuring user and store exist:', error);
      throw new Error(`Failed to ensure user and store exist: ${error.message}`);
    }
  }

  // Update an existing COGS configuration
  static async updateCOGSConfig(userId: string, configId: string, data: Partial<COGSConfigData>) {
    try {
      const config = await prisma.cOGSConfig.update({
        where: {
          id: configId,
          userId // Ensure user can only update their own configs
        },
        data: {
          ...(data.productSKU && { productSKU: data.productSKU }),
          ...(data.variantId && { variantId: String(data.variantId) }),
          ...(data.productId && { productId: String(data.productId) }),
          ...(data.productTitle && { productTitle: data.productTitle }),
          ...(data.variantTitle && { variantTitle: data.variantTitle }),
          ...(data.baseCost !== undefined && { baseCost: data.baseCost }),
          ...(data.handlingFee !== undefined && { handlingFee: data.handlingFee }),
          ...(data.description !== undefined && { description: data.description })
        }
      });

      // Handle Overrides (New System)
      if (data.overrides) {
        try {
          const storeId = config.storeId;
          const variantId = config.variantId;

          // 1. Ensure ProductVariant exists (it might not if only legacy config existed)
          await prisma.productVariant.upsert({
            where: {
              userId_storeId_variantId: {
                userId,
                storeId,
                variantId: BigInt(variantId)
              }
            },
            create: {
              variantId: BigInt(variantId),
              userId,
              storeId,
              sku: config.productSKU,
              title: config.variantTitle,
              productId: BigInt(config.productId),
              baseCost: config.baseCost
            },
            update: {
              baseCost: config.baseCost,
              sku: config.productSKU,
              title: config.variantTitle
            }
          });

          // 2. Process each override
          // First, we might want to clear existing overrides for this variant if we are doing a full replace
          // But typically updates are partial. However, if the UI sends the full list, we should probably sync it.
          // For now, let's just upsert the ones provided.

          for (const override of data.overrides) {
            // Find or create Pricebook
            let pricebook = await prisma.pricebook.findUnique({
              where: {
                userId_storeId_countryCode_shippingCompany: {
                  userId,
                  storeId,
                  countryCode: override.country,
                  shippingCompany: override.shipping_company
                }
              }
            });

            if (!pricebook) {
              pricebook = await prisma.pricebook.create({
                data: {
                  userId,
                  storeId,
                  countryCode: override.country,
                  shippingCompany: override.shipping_company,
                  currency: 'USD'
                }
              });
            }

            // Upsert Override
            await prisma.pricebookVariantCostOverride.upsert({
              where: {
                pricebookId_variantId: {
                  pricebookId: pricebook.pricebookId,
                  variantId: BigInt(variantId)
                }
              },
              create: {
                pricebookId: pricebook.pricebookId,
                variantId: BigInt(variantId),
                overrideCost: override.cost
              },
              update: {
                overrideCost: override.cost
              }
            });
          }
        } catch (err) {
          console.error('Error saving overrides in update:', err);
        }
      }

      return {
        id: config.id,
        productSKU: config.productSKU,
        variantId: config.variantId,
        productId: config.productId,
        productTitle: config.productTitle,
        variantTitle: config.variantTitle,
        baseCost: config.baseCost,
        handlingFee: config.handlingFee,
        description: config.description,
        overrides: data.overrides || []
      };
    } catch (error: any) {
      console.error('Error updating COGS config:', error);
      if (error.code === 'P2025') {
        throw new Error('COGS configuration not found');
      }
      throw new Error('Failed to update COGS configuration');
    }
  }

  // Delete a COGS configuration
  static async deleteCOGSConfig(userId: string, configId: string) {
    try {
      await prisma.cOGSConfig.delete({
        where: {
          id: configId,
          userId // Ensure user can only delete their own configs
        }
      });

      return { success: true };
    } catch (error: any) {
      console.error('Error deleting COGS config:', error);
      if (error.code === 'P2025') {
        throw new Error('COGS configuration not found');
      }
      throw new Error('Failed to delete COGS configuration');
    }
  }

  // Bulk create COGS configurations
  static async bulkCreateCOGSConfigs(userId: string, storeId: string, configs: COGSConfigData[]) {
    try {
      console.log('Bulk creating COGS configs:', { userId, storeId, configCount: configs.length });

      const results = await Promise.allSettled(
        configs.map((config, index) => {
          console.log(`Creating config ${index + 1}:`, config);
          return this.createCOGSConfig(userId, storeId, config);
        })
      );

      const successful = results
        .filter((result): result is PromiseFulfilledResult<any> => result.status === 'fulfilled')
        .map(result => result.value);

      const failed = results
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map(result => ({
          error: result.reason?.message || 'Unknown error',
          details: result.reason
        }));

      console.log('Bulk create results:', { successful: successful.length, failed: failed.length });

      return {
        successful,
        failed,
        totalCreated: successful.length,
        totalFailed: failed.length
      };
    } catch (error) {
      console.error('Error bulk creating COGS configs:', error);
      throw new Error('Failed to bulk create COGS configurations');
    }
  }

  // Add pricing tier to existing COGS config (Legacy method for backward compatibility)
  static async addPricingTier(userId: string, cogsConfigId: string, tierData: PricingTierData) {
    try {
      // Convert legacy pricing tier to combo pricing
      const comboData: ComboPricingData = {
        supplier: tierData.supplier,
        country: tierData.country,
        comboType: tierData.minQuantity === 1 ? 'single' :
          tierData.minQuantity === 2 ? 'combo2' :
            tierData.minQuantity === 3 ? 'combo3' :
              tierData.minQuantity === 4 ? 'combo4' : 'combo5+',
        quantity: tierData.minQuantity,
        productCost: tierData.productCost,
        shippingCost: tierData.shippingCost,
        totalCost: tierData.productCost * tierData.minQuantity + tierData.shippingCost,
        isActive: tierData.isActive ?? true
      };

      return await this.addComboPricing(userId, cogsConfigId, comboData);
    } catch (error: any) {
      console.error('Error adding pricing tier:', error);
      throw new Error('Failed to add pricing tier');
    }
  }

  // Update pricing tier (Legacy method for backward compatibility)
  static async updatePricingTier(userId: string, tierId: string, tierData: Partial<PricingTierData>) {
    try {
      // Convert legacy pricing tier data to combo pricing data
      const comboData: Partial<ComboPricingData> = {};

      if (tierData.supplier) comboData.supplier = tierData.supplier;
      if (tierData.country) comboData.country = tierData.country;
      if (tierData.minQuantity !== undefined) {
        comboData.quantity = tierData.minQuantity;
        comboData.comboType = tierData.minQuantity === 1 ? 'single' :
          tierData.minQuantity === 2 ? 'combo2' :
            tierData.minQuantity === 3 ? 'combo3' :
              tierData.minQuantity === 4 ? 'combo4' : 'combo5+';
      }
      if (tierData.productCost !== undefined) comboData.productCost = tierData.productCost;
      if (tierData.shippingCost !== undefined) comboData.shippingCost = tierData.shippingCost;
      if (tierData.isActive !== undefined) comboData.isActive = tierData.isActive;

      return await this.updateComboPricing(userId, tierId, comboData);
    } catch (error: any) {
      console.error('Error updating pricing tier:', error);
      throw new Error('Failed to update pricing tier');
    }
  }

  // Delete pricing tier (Legacy method for backward compatibility)
  static async deletePricingTier(userId: string, tierId: string) {
    try {
      return await this.deleteComboPricing(userId, tierId);
    } catch (error: any) {
      console.error('Error deleting pricing tier:', error);
      throw new Error('Failed to delete pricing tier');
    }
  }

  // Add combo pricing to existing COGS config
  static async addComboPricing(userId: string, cogsConfigId: string, comboData: ComboPricingData) {
    try {
      // Verify the COGS config belongs to the user
      const config = await prisma.cOGSConfig.findFirst({
        where: {
          id: cogsConfigId,
          userId
        }
      });

      if (!config) {
        throw new Error('COGS configuration not found');
      }

      const totalCost = comboData.totalCost || (comboData.productCost * comboData.quantity + comboData.shippingCost);

      const combo = await prisma.comboPricing.create({
        data: {
          cogsConfigId,
          userId,
          storeId: config.storeId,
          supplier: comboData.supplier,
          country: comboData.country,
          comboType: comboData.comboType,
          quantity: comboData.quantity,
          productCost: comboData.productCost,
          shippingCost: comboData.shippingCost,
          totalCost,
          isActive: comboData.isActive ?? true
        }
      });

      return {
        id: combo.id,
        supplier: combo.supplier,
        country: combo.country,
        comboType: combo.comboType,
        quantity: combo.quantity,
        productCost: combo.productCost,
        shippingCost: combo.shippingCost,
        totalCost: combo.totalCost,
        isActive: combo.isActive
      };
    } catch (error: any) {
      console.error('Error adding combo pricing:', error);
      if (error.code === 'P2002') {
        throw new Error('Combo pricing already exists for this supplier/country/quantity combination');
      }
      throw new Error('Failed to add combo pricing');
    }
  }

  // Update combo pricing
  static async updateComboPricing(userId: string, comboId: string, comboData: Partial<ComboPricingData>) {
    try {
      const combo = await prisma.comboPricing.update({
        where: {
          id: comboId,
          userId // Ensure user can only update their own combos
        },
        data: {
          ...(comboData.supplier && { supplier: comboData.supplier }),
          ...(comboData.country && { country: comboData.country }),
          ...(comboData.comboType && { comboType: comboData.comboType }),
          ...(comboData.quantity !== undefined && { quantity: comboData.quantity }),
          ...(comboData.productCost !== undefined && { productCost: comboData.productCost }),
          ...(comboData.shippingCost !== undefined && { shippingCost: comboData.shippingCost }),
          ...(comboData.totalCost !== undefined && { totalCost: comboData.totalCost }),
          ...(comboData.isActive !== undefined && { isActive: comboData.isActive })
        }
      });

      return {
        id: combo.id,
        supplier: combo.supplier,
        country: combo.country,
        comboType: combo.comboType,
        quantity: combo.quantity,
        productCost: combo.productCost,
        shippingCost: combo.shippingCost,
        totalCost: combo.totalCost,
        isActive: combo.isActive
      };
    } catch (error: any) {
      console.error('Error updating combo pricing:', error);
      if (error.code === 'P2025') {
        throw new Error('Combo pricing not found');
      }
      throw new Error('Failed to update combo pricing');
    }
  }

  // Delete combo pricing
  static async deleteComboPricing(userId: string, comboId: string) {
    try {
      await prisma.comboPricing.delete({
        where: {
          id: comboId,
          userId // Ensure user can only delete their own combos
        }
      });

      return { success: true };
    } catch (error: any) {
      console.error('Error deleting combo pricing:', error);
      if (error.code === 'P2025') {
        throw new Error('Combo pricing not found');
      }
      throw new Error('Failed to delete combo pricing');
    }
  }

  // Get exact COGS for order based on quantity
  static async getExactCOGSForOrder(userId: string, variantId: string, country: string, quantity: number) {
    try {
      // First try to find exact quantity match
      let combo = await prisma.comboPricing.findFirst({
        where: {
          userId,
          cogsConfig: {
            variantId
          },
          country,
          quantity,
          isActive: true
        },
        orderBy: [
          { supplier: 'asc' }
        ]
      });

      // If no exact match, find the closest lower quantity (for 5+ combos)
      if (!combo && quantity >= 5) {
        combo = await prisma.comboPricing.findFirst({
          where: {
            userId,
            cogsConfig: {
              variantId
            },
            country,
            comboType: 'combo5+',
            isActive: true
          },
          orderBy: [
            { supplier: 'asc' }
          ]
        });
      }

      if (!combo) {
        return null;
      }

      // Calculate total cost for the actual quantity
      const totalCost = combo.productCost * quantity + combo.shippingCost;

      return {
        combo,
        calculatedCost: {
          productCostPerUnit: combo.productCost,
          totalProductCost: combo.productCost * quantity,
          shippingCost: combo.shippingCost,
          totalCost,
          comboType: combo.comboType,
          quantity: quantity
        }
      };
    } catch (error) {
      console.error('Error getting exact COGS for order:', error);
      throw new Error('Failed to get exact COGS for order');
    }
  }

  // Legacy method for backward compatibility
  static async getPricingForOrder(userId: string, variantId: string, country: string, quantity: number) {
    return this.getExactCOGSForOrder(userId, variantId, country, quantity);
  }

  // Shipping Company Management
  static async getShippingCompanies() {
    try {
      // Use raw query to avoid type issues if client isn't regenerated
      const companies = await prisma.$queryRaw`
        SELECT * FROM shipping_companies WHERE is_active = true ORDER BY name ASC
      `;
      return companies;
    } catch (error) {
      console.error('Error fetching shipping companies:', error);
      throw new Error('Failed to fetch shipping companies');
    }
  }

  static async createShippingCompany(data: { name: string; display_name?: string; tracking_prefixes?: string }) {
    try {
      const { name, display_name, tracking_prefixes } = data;
      // Use raw query
      const id = require('crypto').randomUUID();
      await prisma.$executeRaw`
        INSERT INTO shipping_companies (id, name, display_name, tracking_prefixes, is_active, "createdAt", "updatedAt")
        VALUES (${id}, ${name}, ${display_name || name}, ${tracking_prefixes || null}, true, NOW(), NOW())
      `;
      const company = await prisma.$queryRaw`SELECT * FROM shipping_companies WHERE id = ${id}`;
      return (company as any[])[0];
    } catch (error) {
      console.error('Error creating shipping company:', error);
      throw new Error('Failed to create shipping company');
    }
  }

  static async updateShippingCompany(id: string, data: { name: string; display_name?: string; tracking_prefixes?: string; is_active?: boolean }) {
    try {
      const { name, display_name, tracking_prefixes, is_active } = data;
      await prisma.$executeRaw`
        UPDATE shipping_companies
        SET name = ${name},
            display_name = ${display_name || name},
            tracking_prefixes = ${tracking_prefixes || null},
            is_active = ${is_active !== undefined ? is_active : true},
            "updatedAt" = NOW()
        WHERE id = ${id}
      `;
      const company = await prisma.$queryRaw`SELECT * FROM shipping_companies WHERE id = ${id}`;
      return (company as any[])[0];
    } catch (error) {
      console.error('Error updating shipping company:', error);
      throw new Error('Failed to update shipping company');
    }
  }

  static async deleteShippingCompany(id: string) {
    try {
      await prisma.$executeRaw`
        UPDATE shipping_companies
        SET is_active = false,
            "updatedAt" = NOW()
        WHERE id = ${id}
      `;
      return { success: true };
    } catch (error) {
      console.error('Error deleting shipping company:', error);
      throw new Error('Failed to delete shipping company');
    }
  }
}

