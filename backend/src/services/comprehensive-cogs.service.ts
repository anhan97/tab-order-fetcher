import { PrismaClient } from '@prisma/client';
import { 
  PricebookImportConfig, 
  QuoteRequest, 
  QuoteResponse, 
  CostCalculationResult,
  CreatePricebookRequest,
  CreateShippingTierRequest,
  CreateVariantCostOverrideRequest,
  CreateComboRequest,
  CreateComboOverrideRequest
} from '../types/cogs';

const prisma = new PrismaClient();

export class ComprehensiveCOGSService {
  
  // ===== PRICEBOOK MANAGEMENT =====
  
  static async createPricebook(userId: string, storeId: string, data: CreatePricebookRequest) {
    try {
      const pricebook = await prisma.pricebook.create({
        data: {
          userId,
          storeId,
          countryCode: data.country_code,
          shippingCompany: data.shipping_company,
          currency: data.currency
        }
      });

      return {
        pricebook_id: pricebook.pricebookId
      };
    } catch (error: any) {
      console.error('Error creating pricebook:', error);
      if (error.code === 'P2002') {
        throw new Error('Pricebook already exists for this country and shipping company');
      }
      throw new Error('Failed to create pricebook');
    }
  }

  static async getPricebooks(userId: string, storeId: string, filters?: {
    country_code?: string;
    shipping_company?: string;
  }) {
    try {
      const where: any = { userId, storeId };
      
      if (filters?.country_code) {
        where.countryCode = filters.country_code;
      }
      
      if (filters?.shipping_company) {
        where.shippingCompany = filters.shipping_company;
      }

      const pricebooks = await prisma.pricebook.findMany({
        where,
        include: {
          shippingTiers: {
            orderBy: { minItems: 'asc' }
          },
          variantCostOverrides: true,
          comboOverrides: true
        },
        orderBy: [
          { countryCode: 'asc' },
          { shippingCompany: 'asc' }
        ]
      });

      return pricebooks.map(pb => ({
        pricebook_id: pb.pricebookId,
        country_code: pb.countryCode,
        shipping_company: pb.shippingCompany,
        currency: pb.currency,
        tiers: pb.shippingTiers.map(tier => ({
          min_items: tier.minItems,
          max_items: tier.maxItems,
          shipping_cost: Number(tier.shippingCost)
        })),
        variant_overrides: pb.variantCostOverrides.reduce((acc, override) => {
          acc[override.variantId.toString()] = Number(override.overrideCost);
          return acc;
        }, {} as Record<string, number>),
        combo_overrides: pb.comboOverrides.reduce((acc, override) => {
          acc[override.comboId] = {
            override_product_cost: override.overrideProductCost ? Number(override.overrideProductCost) : null,
            override_shipping_cost: override.overrideShippingCost ? Number(override.overrideShippingCost) : null
          };
          return acc;
        }, {} as Record<string, { override_product_cost?: number | null; override_shipping_cost?: number | null }>)
      }));
    } catch (error) {
      console.error('Error fetching pricebooks:', error);
      throw new Error('Failed to fetch pricebooks');
    }
  }

  static async updatePricebook(userId: string, pricebookId: string, data: Partial<CreatePricebookRequest>) {
    try {
      const pricebook = await prisma.pricebook.update({
        where: {
          pricebookId,
          userId
        },
        data: {
          ...(data.country_code && { countryCode: data.country_code }),
          ...(data.shipping_company && { shippingCompany: data.shipping_company }),
          ...(data.currency && { currency: data.currency })
        }
      });

      return {
        pricebook_id: pricebook.pricebookId,
        country_code: pricebook.countryCode,
        shipping_company: pricebook.shippingCompany,
        currency: pricebook.currency
      };
    } catch (error: any) {
      console.error('Error updating pricebook:', error);
      if (error.code === 'P2025') {
        throw new Error('Pricebook not found');
      }
      throw new Error('Failed to update pricebook');
    }
  }

  static async deletePricebook(userId: string, pricebookId: string) {
    try {
      await prisma.pricebook.delete({
        where: {
          pricebookId,
          userId
        }
      });

      return { success: true };
    } catch (error: any) {
      console.error('Error deleting pricebook:', error);
      if (error.code === 'P2025') {
        throw new Error('Pricebook not found');
      }
      throw new Error('Failed to delete pricebook');
    }
  }

  // ===== SHIPPING TIERS MANAGEMENT =====

  static async addShippingTier(userId: string, pricebookId: string, data: CreateShippingTierRequest) {
    try {
      // Verify pricebook belongs to user
      const pricebook = await prisma.pricebook.findFirst({
        where: { pricebookId, userId }
      });

      if (!pricebook) {
        throw new Error('Pricebook not found');
      }

      const tier = await prisma.pricebookShippingTier.create({
        data: {
          pricebookId,
          minItems: data.min_items,
          maxItems: data.max_items,
          shippingCost: data.shipping_cost
        }
      });

      return {
        min_items: tier.minItems,
        max_items: tier.maxItems,
        shipping_cost: Number(tier.shippingCost)
      };
    } catch (error: any) {
      console.error('Error adding shipping tier:', error);
      if (error.code === 'P2002') {
        throw new Error('Shipping tier already exists for this item range');
      }
      throw new Error('Failed to add shipping tier');
    }
  }

  static async getShippingTiers(userId: string, pricebookId: string) {
    try {
      // Verify pricebook belongs to user
      const pricebook = await prisma.pricebook.findFirst({
        where: { pricebookId, userId }
      });

      if (!pricebook) {
        throw new Error('Pricebook not found');
      }

      const tiers = await prisma.pricebookShippingTier.findMany({
        where: { pricebookId },
        orderBy: { minItems: 'asc' }
      });

      return tiers.map(tier => ({
        min_items: tier.minItems,
        max_items: tier.maxItems,
        shipping_cost: Number(tier.shippingCost)
      }));
    } catch (error) {
      console.error('Error fetching shipping tiers:', error);
      throw new Error('Failed to fetch shipping tiers');
    }
  }

  static async updateShippingTiers(userId: string, pricebookId: string, tiers: CreateShippingTierRequest[]) {
    try {
      // Verify pricebook belongs to user
      const pricebook = await prisma.pricebook.findFirst({
        where: { pricebookId, userId }
      });

      if (!pricebook) {
        throw new Error('Pricebook not found');
      }

      // Delete existing tiers
      await prisma.pricebookShippingTier.deleteMany({
        where: { pricebookId }
      });

      // Create new tiers
      const newTiers = await prisma.pricebookShippingTier.createMany({
        data: tiers.map(tier => ({
          pricebookId,
          minItems: tier.min_items,
          maxItems: tier.max_items,
          shippingCost: tier.shipping_cost
        }))
      });

      return { success: true, tiers_created: newTiers.count };
    } catch (error) {
      console.error('Error updating shipping tiers:', error);
      throw new Error('Failed to update shipping tiers');
    }
  }

  static async deleteShippingTier(userId: string, pricebookId: string, minItems: number, maxItems: number) {
    try {
      // Verify pricebook belongs to user
      const pricebook = await prisma.pricebook.findFirst({
        where: { pricebookId, userId }
      });

      if (!pricebook) {
        throw new Error('Pricebook not found');
      }

      await prisma.pricebookShippingTier.delete({
        where: {
          pricebookId_minItems_maxItems: {
            pricebookId,
            minItems,
            maxItems
          }
        }
      });

      return { success: true };
    } catch (error: any) {
      console.error('Error deleting shipping tier:', error);
      if (error.code === 'P2025') {
        throw new Error('Shipping tier not found');
      }
      throw new Error('Failed to delete shipping tier');
    }
  }

  // ===== VARIANT COST OVERRIDES =====

  static async addVariantCostOverride(userId: string, pricebookId: string, data: CreateVariantCostOverrideRequest) {
    try {
      // Verify pricebook belongs to user
      const pricebook = await prisma.pricebook.findFirst({
        where: { pricebookId, userId }
      });

      if (!pricebook) {
        throw new Error('Pricebook not found');
      }

      const override = await prisma.pricebookVariantCostOverride.create({
        data: {
          pricebookId,
          variantId: BigInt(data.variant_id),
          overrideCost: data.override_cost
        }
      });

      return {
        variant_id: Number(override.variantId),
        override_cost: Number(override.overrideCost)
      };
    } catch (error: any) {
      console.error('Error adding variant cost override:', error);
      if (error.code === 'P2002') {
        throw new Error('Variant cost override already exists');
      }
      throw new Error('Failed to add variant cost override');
    }
  }

  static async getVariantCostOverrides(userId: string, pricebookId: string) {
    try {
      // Verify pricebook belongs to user
      const pricebook = await prisma.pricebook.findFirst({
        where: { pricebookId, userId }
      });

      if (!pricebook) {
        throw new Error('Pricebook not found');
      }

      const overrides = await prisma.pricebookVariantCostOverride.findMany({
        where: { pricebookId }
      });

      return overrides.map(override => ({
        variant_id: Number(override.variantId),
        override_cost: Number(override.overrideCost)
      }));
    } catch (error) {
      console.error('Error fetching variant cost overrides:', error);
      throw new Error('Failed to fetch variant cost overrides');
    }
  }

  static async deleteVariantCostOverride(userId: string, pricebookId: string, variantId: number) {
    try {
      // Verify pricebook belongs to user
      const pricebook = await prisma.pricebook.findFirst({
        where: { pricebookId, userId }
      });

      if (!pricebook) {
        throw new Error('Pricebook not found');
      }

      await prisma.pricebookVariantCostOverride.delete({
        where: {
          pricebookId_variantId: {
            pricebookId,
            variantId: BigInt(variantId)
          }
        }
      });

      return { success: true };
    } catch (error: any) {
      console.error('Error deleting variant cost override:', error);
      if (error.code === 'P2025') {
        throw new Error('Variant cost override not found');
      }
      throw new Error('Failed to delete variant cost override');
    }
  }

  // ===== COMBO MANAGEMENT =====

  static async createCombo(userId: string, storeId: string, data: CreateComboRequest) {
    try {
      const combo = await prisma.combo.create({
        data: {
          userId,
          storeId,
          name: data.name,
          comboItems: {
            create: data.items.map((item: any) => ({
              variantId: BigInt(item.variant_id),
              qty: item.qty
            }))
          }
        },
        include: {
          comboItems: true
        }
      });

      return {
        combo_id: combo.comboId,
        name: combo.name,
        items: combo.comboItems.map(item => ({
          variant_id: Number(item.variantId),
          qty: item.qty
        }))
      };
    } catch (error: any) {
      console.error('Error creating combo:', error);
      if (error.code === 'P2002') {
        throw new Error('Combo with this name already exists');
      }
      throw new Error('Failed to create combo');
    }
  }

  static async getCombo(userId: string, comboId: string) {
    try {
      const combo = await prisma.combo.findFirst({
        where: {
          comboId,
          userId
        },
        include: {
          comboItems: true
        }
      });

      if (!combo) {
        throw new Error('Combo not found');
      }

      return {
        combo_id: combo.comboId,
        name: combo.name,
        is_active: combo.isActive,
        items: combo.comboItems.map(item => ({
          variant_id: Number(item.variantId),
          qty: item.qty
        }))
      };
    } catch (error) {
      console.error('Error fetching combo:', error);
      throw new Error('Failed to fetch combo');
    }
  }

  static async updateCombo(userId: string, comboId: string, data: Partial<CreateComboRequest & { is_active?: boolean }>) {
    try {
      const combo = await prisma.combo.update({
        where: {
          comboId,
          userId
        },
        data: {
          ...(data.name && { name: data.name }),
          ...(data.is_active !== undefined && { isActive: data.is_active }),
          ...(data.items && {
            comboItems: {
              deleteMany: {},
              create: data.items.map((item: any) => ({
                variantId: BigInt(item.variant_id),
                qty: item.qty
              }))
            }
          })
        },
        include: {
          comboItems: true
        }
      });

      return {
        combo_id: combo.comboId,
        name: combo.name,
        is_active: combo.isActive,
        items: combo.comboItems.map(item => ({
          variant_id: Number(item.variantId),
          qty: item.qty
        }))
      };
    } catch (error: any) {
      console.error('Error updating combo:', error);
      if (error.code === 'P2025') {
        throw new Error('Combo not found');
      }
      throw new Error('Failed to update combo');
    }
  }

  static async deleteCombo(userId: string, comboId: string) {
    try {
      await prisma.combo.delete({
        where: {
          comboId,
          userId
        }
      });

      return { success: true };
    } catch (error: any) {
      console.error('Error deleting combo:', error);
      if (error.code === 'P2025') {
        throw new Error('Combo not found');
      }
      throw new Error('Failed to delete combo');
    }
  }

  // ===== COMBO OVERRIDES =====

  static async addComboOverride(userId: string, pricebookId: string, data: CreateComboOverrideRequest) {
    try {
      // Verify pricebook belongs to user
      const pricebook = await prisma.pricebook.findFirst({
        where: { pricebookId, userId }
      });

      if (!pricebook) {
        throw new Error('Pricebook not found');
      }

      const override = await prisma.pricebookComboOverride.create({
        data: {
          pricebookId,
          comboId: data.combo_id,
          overrideProductCost: data.override_product_cost,
          overrideShippingCost: data.override_shipping_cost
        }
      });

      return {
        combo_id: override.comboId,
        override_product_cost: override.overrideProductCost ? Number(override.overrideProductCost) : null,
        override_shipping_cost: override.overrideShippingCost ? Number(override.overrideShippingCost) : null
      };
    } catch (error: any) {
      console.error('Error adding combo override:', error);
      if (error.code === 'P2002') {
        throw new Error('Combo override already exists');
      }
      throw new Error('Failed to add combo override');
    }
  }

  static async getComboOverrides(userId: string, pricebookId: string) {
    try {
      // Verify pricebook belongs to user
      const pricebook = await prisma.pricebook.findFirst({
        where: { pricebookId, userId }
      });

      if (!pricebook) {
        throw new Error('Pricebook not found');
      }

      const overrides = await prisma.pricebookComboOverride.findMany({
        where: { pricebookId }
      });

      return overrides.map(override => ({
        combo_id: override.comboId,
        override_product_cost: override.overrideProductCost ? Number(override.overrideProductCost) : null,
        override_shipping_cost: override.overrideShippingCost ? Number(override.overrideShippingCost) : null
      }));
    } catch (error) {
      console.error('Error fetching combo overrides:', error);
      throw new Error('Failed to fetch combo overrides');
    }
  }

  static async deleteComboOverride(userId: string, pricebookId: string, comboId: string) {
    try {
      // Verify pricebook belongs to user
      const pricebook = await prisma.pricebook.findFirst({
        where: { pricebookId, userId }
      });

      if (!pricebook) {
        throw new Error('Pricebook not found');
      }

      await prisma.pricebookComboOverride.delete({
        where: {
          pricebookId_comboId: {
            pricebookId,
            comboId
          }
        }
      });

      return { success: true };
    } catch (error: any) {
      console.error('Error deleting combo override:', error);
      if (error.code === 'P2025') {
        throw new Error('Combo override not found');
      }
      throw new Error('Failed to delete combo override');
    }
  }

  // ===== IMPORT/EXPORT =====

  static async importPricebook(userId: string, storeId: string, config: PricebookImportConfig) {
    try {
      // Create pricebook
      const pricebook = await prisma.pricebook.create({
        data: {
          userId,
          storeId,
          countryCode: config.country_code,
          shippingCompany: config.shipping_company,
          currency: config.currency
        }
      });

      // Create shipping tiers
      if (config.shipping_tiers.length > 0) {
        await prisma.pricebookShippingTier.createMany({
          data: config.shipping_tiers.map((tier: any) => ({
            pricebookId: pricebook.pricebookId,
            minItems: tier.min_items,
            maxItems: tier.max_items,
            shippingCost: tier.shipping_cost
          }))
        });
      }

      // Create variant cost overrides
      if (config.variant_cost_overrides.length > 0) {
        await prisma.pricebookVariantCostOverride.createMany({
          data: config.variant_cost_overrides.map((override: any) => ({
            pricebookId: pricebook.pricebookId,
            variantId: BigInt(override.variant_id),
            overrideCost: override.override_cost
          }))
        });
      }

      // Create combo overrides
      if (config.combo_overrides.length > 0) {
        await prisma.pricebookComboOverride.createMany({
          data: config.combo_overrides.map((override: any) => ({
            pricebookId: pricebook.pricebookId,
            comboId: override.combo_id,
            overrideProductCost: override.override_product_cost,
            overrideShippingCost: override.override_shipping_cost
          }))
        });
      }

      return {
        pricebook_id: pricebook.pricebookId,
        success: true
      };
    } catch (error: any) {
      console.error('Error importing pricebook:', error);
      if (error.code === 'P2002') {
        throw new Error('Pricebook already exists for this country and shipping company');
      }
      throw new Error('Failed to import pricebook');
    }
  }

  // ===== COST CALCULATION =====

  static async calculateCost(userId: string, request: QuoteRequest): Promise<CostCalculationResult> {
    try {
      // Find pricebook
      const pricebook = await prisma.pricebook.findFirst({
        where: {
          userId,
          countryCode: request.country_code,
          shippingCompany: request.shipping_company
        },
        include: {
          shippingTiers: {
            orderBy: { minItems: 'asc' }
          },
          variantCostOverrides: true,
          comboOverrides: true
        }
      });

      if (!pricebook) {
        throw new Error(`Pricebook not found for ${request.country_code} - ${request.shipping_company}`);
      }

      let productCost = 0;
      let shippingCost = 0;
      const lines: Array<{ variant_id: number; qty: number; unit_cost: number; total_cost: number }> = [];
      const variantOverrides: Array<{ variant_id: number; original_cost: number; override_cost: number }> = [];

      // Calculate product cost
      if (request.combo_id) {
        // Combo-based calculation
        const combo = await prisma.combo.findFirst({
          where: {
            comboId: request.combo_id,
            userId
          },
          include: {
            comboItems: true
          }
        });

        if (!combo) {
          throw new Error('Combo not found');
        }

        // Check for combo override
        const comboOverride = pricebook.comboOverrides.find(co => co.comboId === request.combo_id);
        
        if (comboOverride && comboOverride.overrideProductCost !== null) {
          productCost = Number(comboOverride.overrideProductCost);
        } else {
          // Calculate from combo items
          for (const item of combo.comboItems) {
            const variant = await prisma.productVariant.findFirst({
              where: {
                variantId: item.variantId,
                userId
              }
            });

            if (!variant) {
              throw new Error(`Variant ${item.variantId} not found`);
            }

            // Check for variant cost override
            const variantOverride = pricebook.variantCostOverrides.find(vo => vo.variantId === item.variantId);
            const unitCost = variantOverride ? Number(variantOverride.overrideCost) : Number(variant.baseCost);
            
            if (variantOverride) {
              variantOverrides.push({
                variant_id: Number(item.variantId),
                original_cost: Number(variant.baseCost),
                override_cost: Number(variantOverride.overrideCost)
              });
            }

            const totalCost = unitCost * item.qty;
            productCost += totalCost;

            lines.push({
              variant_id: Number(item.variantId),
              qty: item.qty,
              unit_cost: unitCost,
              total_cost: totalCost
            });
          }
        }

        // Calculate shipping cost for combo
        if (comboOverride && comboOverride.overrideShippingCost !== null) {
          shippingCost = Number(comboOverride.overrideShippingCost);
        } else {
          const totalItems = combo.comboItems.reduce((sum, item) => sum + item.qty, 0);
          const tier = this.findShippingTier(pricebook.shippingTiers, totalItems);
          if (tier) {
            shippingCost = Number(tier.shippingCost);
          }
        }
      } else if (request.lines) {
        // Line-based calculation
        const totalItems = request.lines.reduce((sum: number, line: any) => sum + line.qty, 0);

        for (const line of request.lines) {
          const variant = await prisma.productVariant.findFirst({
            where: {
              variantId: BigInt(line.variant_id),
              userId
            }
          });

          if (!variant) {
            throw new Error(`Variant ${line.variant_id} not found`);
          }

          // Check for variant cost override
          const variantOverride = pricebook.variantCostOverrides.find(vo => vo.variantId === BigInt(line.variant_id));
          const unitCost = variantOverride ? Number(variantOverride.overrideCost) : Number(variant.baseCost);
          
          if (variantOverride) {
            variantOverrides.push({
              variant_id: line.variant_id,
              original_cost: Number(variant.baseCost),
              override_cost: Number(variantOverride.overrideCost)
            });
          }

          const totalCost = unitCost * line.qty;
          productCost += totalCost;

          lines.push({
            variant_id: line.variant_id,
            qty: line.qty,
            unit_cost: unitCost,
            total_cost: totalCost
          });
        }

        // Calculate shipping cost
        const tier = this.findShippingTier(pricebook.shippingTiers, totalItems);
        if (tier) {
          shippingCost = Number(tier.shippingCost);
        }
      }

      const totalCost = productCost + shippingCost;

      return {
        product_cost: Math.round(productCost * 100) / 100,
        shipping_cost: Math.round(shippingCost * 100) / 100,
        total_cost: Math.round(totalCost * 100) / 100,
        breakdown: {
          lines,
          shipping_tier: this.findShippingTier(pricebook.shippingTiers, request.lines?.reduce((sum: number, line: any) => sum + line.qty, 0) || 0) || {
            min_items: 0,
            max_items: 0,
            shipping_cost: 0
          },
          overrides_applied: {
            variant_overrides: variantOverrides,
            combo_overrides: request.combo_id ? pricebook.comboOverrides.find(co => co.comboId === request.combo_id) ? {
              product_cost_override: pricebook.comboOverrides.find(co => co.comboId === request.combo_id)?.overrideProductCost ? Number(pricebook.comboOverrides.find(co => co.comboId === request.combo_id)?.overrideProductCost) : undefined,
              shipping_cost_override: pricebook.comboOverrides.find(co => co.comboId === request.combo_id)?.overrideShippingCost ? Number(pricebook.comboOverrides.find(co => co.comboId === request.combo_id)?.overrideShippingCost) : undefined
            } : undefined : undefined
          }
        }
      };
    } catch (error) {
      console.error('Error calculating cost:', error);
      throw new Error('Failed to calculate cost');
    }
  }

  private static findShippingTier(tiers: any[], totalItems: number) {
    return tiers.find(tier => totalItems >= tier.minItems && totalItems <= tier.maxItems);
  }
}
