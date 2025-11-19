// TypeScript types for the comprehensive COGS system

export type Line = { 
  variant_id: number; 
  qty: number; 
};

export type PricebookTier = { 
  min_items: number; 
  max_items: number; 
  shipping_cost: number; 
};

export type Pricebook = {
  pricebook_id: string;
  country_code: string;
  shipping_company: string;
  currency: string;
  tiers: PricebookTier[];
  variant_overrides: Record<string, number>; // variant_id -> override_cost
  combo_overrides: Record<string, { 
    override_product_cost?: number | null; 
    override_shipping_cost?: number | null; 
  }>;
};

export type QuoteRequest = {
  country_code: string;
  shipping_company: string;
  currency: string;
  lines?: Line[];
  combo_id?: string | null;
};

export type QuoteResponse = {
  product_cost: number;
  shipping_cost: number;
  total_cost: number;
};

// Database entity types
export interface ProductVariant {
  variantId: bigint;
  userId: string;
  storeId: string;
  sku?: string;
  title: string;
  productId: bigint;
  inventoryItemId?: bigint;
  baseCost: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Combo {
  comboId: string;
  userId: string;
  storeId: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  comboItems: ComboItem[];
}

export interface ComboItem {
  comboId: string;
  variantId: bigint;
  qty: number;
}

export interface PricebookEntity {
  pricebookId: string;
  userId: string;
  storeId: string;
  countryCode: string;
  shippingCompany: string;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
  shippingTiers: PricebookShippingTier[];
  variantCostOverrides: PricebookVariantCostOverride[];
  comboOverrides: PricebookComboOverride[];
}

export interface PricebookShippingTier {
  pricebookId: string;
  minItems: number;
  maxItems: number;
  shippingCost: number;
}

export interface PricebookVariantCostOverride {
  pricebookId: string;
  variantId: bigint;
  overrideCost: number;
}

export interface PricebookComboOverride {
  pricebookId: string;
  comboId: string;
  overrideProductCost?: number | null;
  overrideShippingCost?: number | null;
}

// API request/response types
export interface CreatePricebookRequest {
  country_code: string;
  shipping_company: string;
  currency: string;
}

export interface CreatePricebookResponse {
  pricebook_id: string;
}

export interface CreateShippingTierRequest {
  min_items: number;
  max_items: number;
  shipping_cost: number;
}

export interface CreateVariantCostOverrideRequest {
  variant_id: number;
  override_cost: number;
}

export interface CreateComboRequest {
  name: string;
  items: Array<{
    variant_id: number;
    qty: number;
  }>;
}

export interface CreateComboResponse {
  combo_id: string;
}

export interface CreateComboOverrideRequest {
  combo_id: string;
  override_product_cost?: number | null;
  override_shipping_cost?: number | null;
}

// Import/Export types
export interface PricebookImportConfig {
  country_code: string;
  shipping_company: string;
  currency: string;
  shipping_tiers: Array<{
    min_items: number;
    max_items: number;
    shipping_cost: number;
  }>;
  variant_cost_overrides: Array<{
    variant_id: number;
    override_cost: number;
  }>;
  combo_overrides: Array<{
    combo_id: string;
    override_product_cost?: number | null;
    override_shipping_cost?: number | null;
  }>;
}

// Cost calculation types
export interface CostCalculationResult {
  product_cost: number;
  shipping_cost: number;
  total_cost: number;
  breakdown: {
    lines: Array<{
      variant_id: number;
      qty: number;
      unit_cost: number;
      total_cost: number;
    }>;
    shipping_tier: {
      min_items: number;
      max_items: number;
      shipping_cost: number;
    };
    overrides_applied: {
      variant_overrides: Array<{
        variant_id: number;
        original_cost: number;
        override_cost: number;
      }>;
      combo_overrides?: {
        product_cost_override?: number;
        shipping_cost_override?: number;
      };
    };
  };
}

// Shopify sync types
export interface ShopifyVariantData {
  id: number;
  sku?: string;
  title: string;
  product_id: number;
  inventory_item_id: number;
  cost?: number;
}

export interface ShopifyInventoryItem {
  id: number;
  cost: number;
  country_code_of_origin?: string;
}
