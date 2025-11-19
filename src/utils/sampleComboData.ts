import { ComboPricingData } from '@/types/order';

// Sample combo pricing data based on your requirements
export const generateSampleComboPricing = (): ComboPricingData[] => {
  return [
    // YunTu US pricing
    {
      supplier: 'YunTu',
      country: 'US',
      comboType: 'single',
      quantity: 1,
      productCost: 8.43,
      shippingCost: 16.37,
      totalCost: 24.80,
      isActive: true
    },
    {
      supplier: 'YunTu',
      country: 'US',
      comboType: 'combo2',
      quantity: 2,
      productCost: 8.43,
      shippingCost: 31.24,
      totalCost: 48.10,
      isActive: true
    },
    {
      supplier: 'YunTu',
      country: 'US',
      comboType: 'combo3',
      quantity: 3,
      productCost: 8.43,
      shippingCost: 46.11,
      totalCost: 71.40,
      isActive: true
    },
    
    // Shengtu Logistics US pricing
    {
      supplier: 'Shengtu Logistics',
      country: 'US',
      comboType: 'single',
      quantity: 1,
      productCost: 8.43,
      shippingCost: 13.67,
      totalCost: 22.10,
      isActive: true
    },
    {
      supplier: 'Shengtu Logistics',
      country: 'US',
      comboType: 'combo2',
      quantity: 2,
      productCost: 8.43,
      shippingCost: 25.54,
      totalCost: 42.40,
      isActive: true
    },
    {
      supplier: 'Shengtu Logistics',
      country: 'US',
      comboType: 'combo3',
      quantity: 3,
      productCost: 8.43,
      shippingCost: 37.01,
      totalCost: 62.30,
      isActive: true
    },
    
    // Yuanpeng Logistics US pricing
    {
      supplier: 'Yuanpeng Logistics',
      country: 'US',
      comboType: 'single',
      quantity: 1,
      productCost: 8.43,
      shippingCost: 15.77,
      totalCost: 24.20,
      isActive: true
    },
    {
      supplier: 'Yuanpeng Logistics',
      country: 'US',
      comboType: 'combo2',
      quantity: 2,
      productCost: 8.43,
      shippingCost: 25.74,
      totalCost: 42.60,
      isActive: true
    },
    {
      supplier: 'Yuanpeng Logistics',
      country: 'US',
      comboType: 'combo3',
      quantity: 3,
      productCost: 8.43,
      shippingCost: 37.51,
      totalCost: 62.80,
      isActive: true
    },
    
    // UK pricing examples
    {
      supplier: 'YunTu',
      country: 'UK',
      comboType: 'single',
      quantity: 1,
      productCost: 8.43,
      shippingCost: 18.50,
      totalCost: 26.93,
      isActive: true
    },
    {
      supplier: 'Shengtu Logistics',
      country: 'UK',
      comboType: 'single',
      quantity: 1,
      productCost: 8.43,
      shippingCost: 15.20,
      totalCost: 23.63,
      isActive: true
    },
    
    // Canada pricing examples
    {
      supplier: 'YunTu',
      country: 'CA',
      comboType: 'single',
      quantity: 1,
      productCost: 8.43,
      shippingCost: 17.80,
      totalCost: 26.23,
      isActive: true
    },
    {
      supplier: 'Shengtu Logistics',
      country: 'CA',
      comboType: 'single',
      quantity: 1,
      productCost: 8.43,
      shippingCost: 14.90,
      totalCost: 23.33,
      isActive: true
    },
    
    // Combo 4 and 5+ examples
    {
      supplier: 'YunTu',
      country: 'US',
      comboType: 'combo4',
      quantity: 4,
      productCost: 8.43,
      shippingCost: 60.00,
      totalCost: 93.72,
      isActive: true
    },
    {
      supplier: 'YunTu',
      country: 'US',
      comboType: 'combo5+',
      quantity: 5,
      productCost: 8.43,
      shippingCost: 75.00,
      totalCost: 117.15,
      isActive: true
    }
  ];
};

// Helper function to find the best combo pricing for a given order
export const findBestComboPricing = (
  combos: ComboPricingData[],
  country: string,
  quantity: number
): ComboPricingData | null => {
  // First try to find exact quantity match
  let exactMatch = combos.find(combo => 
    combo.country === country &&
    combo.quantity === quantity &&
    combo.isActive
  );

  if (exactMatch) {
    return exactMatch;
  }

  // If no exact match and quantity >= 5, find combo5+ pricing
  if (quantity >= 5) {
    const combo5Plus = combos.find(combo => 
      combo.country === country &&
      combo.comboType === 'combo5+' &&
      combo.isActive
    );
    
    if (combo5Plus) {
      return combo5Plus;
    }
  }

  // Find the closest lower quantity combo
  const applicableCombos = combos.filter(combo => 
    combo.country === country &&
    combo.quantity <= quantity &&
    combo.isActive
  );

  if (applicableCombos.length === 0) {
    return null;
  }

  // Sort by quantity descending to get the highest applicable combo
  return applicableCombos.sort((a, b) => b.quantity - a.quantity)[0];
};

// Helper function to calculate exact COGS for an order
export const calculateExactCOGS = (
  combos: ComboPricingData[],
  country: string,
  quantity: number
): {
  combo: ComboPricingData;
  calculatedCost: {
    productCostPerUnit: number;
    totalProductCost: number;
    shippingCost: number;
    totalCost: number;
    comboType: string;
    quantity: number;
  };
} | null => {
  const bestCombo = findBestComboPricing(combos, country, quantity);
  
  if (!bestCombo) {
    return null;
  }

  // Calculate total cost for the actual quantity
  const totalCost = bestCombo.productCost * quantity + bestCombo.shippingCost;

  return {
    combo: bestCombo,
    calculatedCost: {
      productCostPerUnit: bestCombo.productCost,
      totalProductCost: bestCombo.productCost * quantity,
      shippingCost: bestCombo.shippingCost,
      totalCost,
      comboType: bestCombo.comboType,
      quantity: quantity
    }
  };
};

// Example usage and testing
export const testComboCalculation = () => {
  const sampleCombos = generateSampleComboPricing();
  
  console.log('=== Combo COGS Calculation Examples ===');
  
  // Test US orders
  console.log('\n--- US Orders ---');
  console.log('1 item, YunTu:', calculateExactCOGS(sampleCombos, 'US', 1));
  console.log('2 items, YunTu:', calculateExactCOGS(sampleCombos, 'US', 2));
  console.log('3 items, YunTu:', calculateExactCOGS(sampleCombos, 'US', 3));
  console.log('4 items, YunTu:', calculateExactCOGS(sampleCombos, 'US', 4));
  console.log('5 items, YunTu:', calculateExactCOGS(sampleCombos, 'US', 5));
  console.log('10 items, YunTu:', calculateExactCOGS(sampleCombos, 'US', 10));
  
  // Test best pricing
  console.log('\n--- Best Pricing for US Orders ---');
  console.log('1 item:', findBestComboPricing(sampleCombos, 'US', 1));
  console.log('2 items:', findBestComboPricing(sampleCombos, 'US', 2));
  console.log('3 items:', findBestComboPricing(sampleCombos, 'US', 3));
  console.log('5 items:', findBestComboPricing(sampleCombos, 'US', 5));
  console.log('10 items:', findBestComboPricing(sampleCombos, 'US', 10));
  
  // Test different countries
  console.log('\n--- UK Orders ---');
  console.log('1 item, YunTu:', calculateExactCOGS(sampleCombos, 'UK', 1));
  console.log('1 item, Shengtu:', calculateExactCOGS(sampleCombos, 'UK', 1));
};


