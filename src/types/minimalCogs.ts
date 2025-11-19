// Minimal COGS System Types
// Based on the simplified JSON structure

export type ProductOverride = {
  country: string;             // "US"
  shipping_company: string;    // "YunTu"
  cost: number;                // override COGS for this variant in this context
};

export type ProductCog = {
  variant_id: number;          // Shopify variant ID
  sku?: string;
  base_cost: number;
  overrides?: ProductOverride[];
};

export type ComboItem = { 
  variant_id: number; 
  qty: number; 
};

export type ComboOverride = {
  country: string;
  shipping_company: string;
  override_cost: number;
};

export type ComboCogsRule =
  | { mode: "sum"; discount_type?: "percent" | "fixed" | null; discount_value?: number }
  | { mode: "override" };      // use overrides only

export type ComboCog = {
  combo_id: string;
  name: string;
  items: ComboItem[];
  cogs_rule: ComboCogsRule;
  trigger_quantity: number; // Number of products needed to trigger the combo
  overrides?: ComboOverride[];
};

export type CogsConfig = {
  version: string;
  currency: string;
  products: ProductCog[];
  combos?: ComboCog[];
};

// COGS calculation result
export type CogsResult = {
  variant_id?: number;
  combo_id?: string;
  country: string;
  shipping_company: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  calculation_method: 'base_cost' | 'override' | 'combo_sum' | 'combo_override';
  applied_discount?: {
    type: 'percent' | 'fixed';
    value: number;
    amount: number;
  };
};

// Order line item for COGS calculation
export type OrderLineItem = {
  variant_id: number;
  quantity: number;
  country: string;
  shipping_company: string;
};

// Bulk COGS calculation request
export type BulkCogsRequest = {
  country: string;
  shipping_company: string;
  items: OrderLineItem[];
};
