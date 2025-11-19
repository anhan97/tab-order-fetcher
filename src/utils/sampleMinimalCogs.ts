import { CogsConfig } from '@/types/minimalCogs';

// Empty minimal COGS configuration - will be populated with real products
export const sampleCogsConfig: CogsConfig = {
  version: "1.0",
  currency: "USD",
  products: [],
  combos: []
};

// Example calculations using the sample config
export const exampleCalculations = {
  // Single product examples
  singleProduct_US_YunTu: {
    variant_id: 1111111111,
    country: "US",
    shipping_company: "YunTu",
    quantity: 1,
    expected_cost: 8.43
  },
  
  singleProduct_US_Shengtu: {
    variant_id: 1111111111,
    country: "US", 
    shipping_company: "Shengtu Logistics",
    quantity: 2,
    expected_cost: 16.86
  },
  
  // Combo examples
  bundle2_US_YunTu: {
    combo_id: "BUNDLE-2",
    country: "US",
    shipping_company: "YunTu", 
    quantity: 1,
    expected_cost: 16.01  // 2 * 8.43 * 0.95 (5% discount)
  },
  
  bundle3_US_YunTu: {
    combo_id: "BUNDLE-3",
    country: "US",
    shipping_company: "YunTu",
    quantity: 1, 
    expected_cost: 22.76  // 3 * 8.43 * 0.90 (10% discount)
  },
  
  mixedBundle_US_YunTu: {
    combo_id: "MIXED-BUNDLE",
    country: "US",
    shipping_company: "YunTu",
    quantity: 1,
    expected_cost: 27.36  // (2 * 8.43 + 1 * 12.50) - 2.00
  },
  
  specialBundle_US_YunTu: {
    combo_id: "SPECIAL-US-YUNTU",
    country: "US",
    shipping_company: "YunTu",
    quantity: 1,
    expected_cost: 15.00  // Override cost
  }
};
