import { PricebookImportConfig } from '@/types/cogs';

// Sample pricebook configurations based on your specification
export const yunTuUSConfig: PricebookImportConfig = {
  country_code: "US",
  shipping_company: "YunTu",
  currency: "USD",
  shipping_tiers: [
    { min_items: 1, max_items: 1, shipping_cost: 16.37 },
    { min_items: 2, max_items: 2, shipping_cost: 31.24 },
    { min_items: 3, max_items: 3, shipping_cost: 46.11 },
    { min_items: 4, max_items: 4, shipping_cost: 60.00 },
    { min_items: 5, max_items: 999999, shipping_cost: 75.00 }
  ],
  variant_cost_overrides: [
    { variant_id: 47258708443387, override_cost: 8.43 }
  ],
  combo_overrides: []
};

export const shengtuUSConfig: PricebookImportConfig = {
  country_code: "US",
  shipping_company: "Shengtu Logistics",
  currency: "USD",
  shipping_tiers: [
    { min_items: 1, max_items: 1, shipping_cost: 13.67 },
    { min_items: 2, max_items: 2, shipping_cost: 25.54 },
    { min_items: 3, max_items: 3, shipping_cost: 37.01 },
    { min_items: 4, max_items: 4, shipping_cost: 48.00 },
    { min_items: 5, max_items: 999999, shipping_cost: 60.00 }
  ],
  variant_cost_overrides: [
    { variant_id: 47258708443387, override_cost: 8.43 }
  ],
  combo_overrides: []
};

export const yuanpengUSConfig: PricebookImportConfig = {
  country_code: "US",
  shipping_company: "Yuanpeng Logistics",
  currency: "USD",
  shipping_tiers: [
    { min_items: 1, max_items: 1, shipping_cost: 15.77 },
    { min_items: 2, max_items: 2, shipping_cost: 25.74 },
    { min_items: 3, max_items: 3, shipping_cost: 37.51 },
    { min_items: 4, max_items: 4, shipping_cost: 50.00 },
    { min_items: 5, max_items: 999999, shipping_cost: 65.00 }
  ],
  variant_cost_overrides: [
    { variant_id: 47258708443387, override_cost: 8.43 }
  ],
  combo_overrides: []
};

// UK configurations
export const yunTuUKConfig: PricebookImportConfig = {
  country_code: "UK",
  shipping_company: "YunTu",
  currency: "GBP",
  shipping_tiers: [
    { min_items: 1, max_items: 1, shipping_cost: 18.50 },
    { min_items: 2, max_items: 2, shipping_cost: 35.00 },
    { min_items: 3, max_items: 3, shipping_cost: 52.00 },
    { min_items: 4, max_items: 4, shipping_cost: 68.00 },
    { min_items: 5, max_items: 999999, shipping_cost: 85.00 }
  ],
  variant_cost_overrides: [
    { variant_id: 47258708443387, override_cost: 8.43 }
  ],
  combo_overrides: []
};

export const shengtuUKConfig: PricebookImportConfig = {
  country_code: "UK",
  shipping_company: "Shengtu Logistics",
  currency: "GBP",
  shipping_tiers: [
    { min_items: 1, max_items: 1, shipping_cost: 15.20 },
    { min_items: 2, max_items: 2, shipping_cost: 28.50 },
    { min_items: 3, max_items: 3, shipping_cost: 42.00 },
    { min_items: 4, max_items: 4, shipping_cost: 55.00 },
    { min_items: 5, max_items: 999999, shipping_cost: 70.00 }
  ],
  variant_cost_overrides: [
    { variant_id: 47258708443387, override_cost: 8.43 }
  ],
  combo_overrides: []
};

// Canada configurations
export const yunTuCAConfig: PricebookImportConfig = {
  country_code: "CA",
  shipping_company: "YunTu",
  currency: "CAD",
  shipping_tiers: [
    { min_items: 1, max_items: 1, shipping_cost: 17.80 },
    { min_items: 2, max_items: 2, shipping_cost: 33.50 },
    { min_items: 3, max_items: 3, shipping_cost: 50.00 },
    { min_items: 4, max_items: 4, shipping_cost: 65.00 },
    { min_items: 5, max_items: 999999, shipping_cost: 80.00 }
  ],
  variant_cost_overrides: [
    { variant_id: 47258708443387, override_cost: 8.43 }
  ],
  combo_overrides: []
};

export const shengtuCAConfig: PricebookImportConfig = {
  country_code: "CA",
  shipping_company: "Shengtu Logistics",
  currency: "CAD",
  shipping_tiers: [
    { min_items: 1, max_items: 1, shipping_cost: 14.90 },
    { min_items: 2, max_items: 2, shipping_cost: 27.50 },
    { min_items: 3, max_items: 3, shipping_cost: 40.00 },
    { min_items: 4, max_items: 4, shipping_cost: 52.00 },
    { min_items: 5, max_items: 999999, shipping_cost: 65.00 }
  ],
  variant_cost_overrides: [
    { variant_id: 47258708443387, override_cost: 8.43 }
  ],
  combo_overrides: []
};

// All configurations
export const allPricebookConfigs = [
  yunTuUSConfig,
  shengtuUSConfig,
  yuanpengUSConfig,
  yunTuUKConfig,
  shengtuUKConfig,
  yunTuCAConfig,
  shengtuCAConfig
];

// Helper function to get config by country and shipping company
export const getPricebookConfig = (countryCode: string, shippingCompany: string): PricebookImportConfig | null => {
  return allPricebookConfigs.find(config => 
    config.country_code === countryCode && 
    config.shipping_company === shippingCompany
  ) || null;
};

// Helper function to seed all configurations
export const seedAllPricebooks = async (userId: string, storeId: string, apiClient: any) => {
  const results = [];
  
  for (const config of allPricebookConfigs) {
    try {
      const result = await apiClient.importPricebook(config);
      results.push({ config, result, success: true });
      console.log(`✅ Seeded ${config.country_code} - ${config.shipping_company}`);
    } catch (error) {
      results.push({ config, error, success: false });
      console.error(`❌ Failed to seed ${config.country_code} - ${config.shipping_company}:`, error);
    }
  }
  
  return results;
};

// Example cost calculations based on your data
export const exampleCalculations = {
  "YunTu US - 1 item": {
    product_cost: 8.43,
    shipping_cost: 16.37,
    total_cost: 24.80
  },
  "YunTu US - 2 items": {
    product_cost: 16.86,
    shipping_cost: 31.24,
    total_cost: 48.10
  },
  "YunTu US - 3 items": {
    product_cost: 25.29,
    shipping_cost: 46.11,
    total_cost: 71.40
  },
  "Shengtu US - 1 item": {
    product_cost: 8.43,
    shipping_cost: 13.67,
    total_cost: 22.10
  },
  "Shengtu US - 2 items": {
    product_cost: 16.86,
    shipping_cost: 25.54,
    total_cost: 42.40
  },
  "Shengtu US - 3 items": {
    product_cost: 25.29,
    shipping_cost: 37.01,
    total_cost: 62.30
  },
  "Yuanpeng US - 1 item": {
    product_cost: 8.43,
    shipping_cost: 15.77,
    total_cost: 24.20
  },
  "Yuanpeng US - 2 items": {
    product_cost: 16.86,
    shipping_cost: 25.74,
    total_cost: 42.60
  },
  "Yuanpeng US - 3 items": {
    product_cost: 25.29,
    shipping_cost: 37.51,
    total_cost: 62.80
  }
};


