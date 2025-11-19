import { PricingTierData } from '@/types/order';

// Sample pricing data based on your example
export const generateSamplePricingTiers = (): PricingTierData[] => {
  return [
    // YunTu pricing
    {
      supplier: 'YunTu',
      country: 'US',
      minQuantity: 1,
      maxQuantity: 1,
      productCost: 8.43,
      shippingCost: 16.37,
      discount: 0,
      isActive: true
    },
    {
      supplier: 'YunTu',
      country: 'US',
      minQuantity: 2,
      maxQuantity: 2,
      productCost: 8.43,
      shippingCost: 31.24,
      discount: 5, // 5% discount for combo orders
      isActive: true
    },
    {
      supplier: 'YunTu',
      country: 'US',
      minQuantity: 3,
      maxQuantity: undefined, // No limit
      productCost: 8.43,
      shippingCost: 46.11,
      discount: 10, // 10% discount for 3+ items
      isActive: true
    },
    
    // Shengtu Logistics pricing
    {
      supplier: 'Shengtu Logistics',
      country: 'US',
      minQuantity: 1,
      maxQuantity: 1,
      productCost: 8.43,
      shippingCost: 13.67,
      discount: 0,
      isActive: true
    },
    {
      supplier: 'Shengtu Logistics',
      country: 'US',
      minQuantity: 2,
      maxQuantity: 2,
      productCost: 8.43,
      shippingCost: 25.54,
      discount: 5,
      isActive: true
    },
    {
      supplier: 'Shengtu Logistics',
      country: 'US',
      minQuantity: 3,
      maxQuantity: undefined,
      productCost: 8.43,
      shippingCost: 37.01,
      discount: 10,
      isActive: true
    },
    
    // Yuanpeng Logistics pricing
    {
      supplier: 'Yuanpeng Logistics',
      country: 'US',
      minQuantity: 1,
      maxQuantity: 1,
      productCost: 8.43,
      shippingCost: 15.77,
      discount: 0,
      isActive: true
    },
    {
      supplier: 'Yuanpeng Logistics',
      country: 'US',
      minQuantity: 2,
      maxQuantity: 2,
      productCost: 8.43,
      shippingCost: 25.74,
      discount: 5,
      isActive: true
    },
    {
      supplier: 'Yuanpeng Logistics',
      country: 'US',
      minQuantity: 3,
      maxQuantity: undefined,
      productCost: 8.43,
      shippingCost: 37.51,
      discount: 10,
      isActive: true
    },
    
    // UK pricing examples
    {
      supplier: 'YunTu',
      country: 'UK',
      minQuantity: 1,
      maxQuantity: 1,
      productCost: 8.43,
      shippingCost: 18.50,
      discount: 0,
      isActive: true
    },
    {
      supplier: 'Shengtu Logistics',
      country: 'UK',
      minQuantity: 1,
      maxQuantity: 1,
      productCost: 8.43,
      shippingCost: 15.20,
      discount: 0,
      isActive: true
    },
    
    // Canada pricing examples
    {
      supplier: 'YunTu',
      country: 'CA',
      minQuantity: 1,
      maxQuantity: 1,
      productCost: 8.43,
      shippingCost: 17.80,
      discount: 0,
      isActive: true
    },
    {
      supplier: 'Shengtu Logistics',
      country: 'CA',
      minQuantity: 1,
      maxQuantity: 1,
      productCost: 8.43,
      shippingCost: 14.90,
      discount: 0,
      isActive: true
    }
  ];
};

// Helper function to calculate total cost for a given tier and quantity
export const calculateTotalCost = (tier: PricingTierData, quantity: number): number => {
  const baseProductCost = tier.productCost * quantity;
  const discountedProductCost = baseProductCost * (1 - tier.discount / 100);
  return discountedProductCost + tier.shippingCost;
};

// Helper function to find the best pricing tier for a given order
export const findBestPricingTier = (
  tiers: PricingTierData[],
  country: string,
  quantity: number
): PricingTierData | null => {
  const applicableTiers = tiers.filter(tier => 
    tier.country === country &&
    tier.minQuantity <= quantity &&
    (tier.maxQuantity === undefined || tier.maxQuantity >= quantity) &&
    tier.isActive
  );

  if (applicableTiers.length === 0) {
    return null;
  }

  // Sort by total cost (ascending) to find the cheapest option
  return applicableTiers.sort((a, b) => {
    const costA = calculateTotalCost(a, quantity);
    const costB = calculateTotalCost(b, quantity);
    return costA - costB;
  })[0];
};

// Example usage and testing
export const testPricingCalculation = () => {
  const sampleTiers = generateSamplePricingTiers();
  
  console.log('=== Pricing Calculation Examples ===');
  
  // Test US orders
  console.log('\n--- US Orders ---');
  console.log('1 item, YunTu:', calculateTotalCost(
    sampleTiers.find(t => t.supplier === 'YunTu' && t.country === 'US' && t.minQuantity === 1)!, 1
  ));
  console.log('2 items, YunTu:', calculateTotalCost(
    sampleTiers.find(t => t.supplier === 'YunTu' && t.country === 'US' && t.minQuantity === 2)!, 2
  ));
  console.log('3 items, YunTu:', calculateTotalCost(
    sampleTiers.find(t => t.supplier === 'YunTu' && t.country === 'US' && t.minQuantity === 3)!, 3
  ));
  
  // Test best pricing
  console.log('\n--- Best Pricing for US Orders ---');
  console.log('1 item:', findBestPricingTier(sampleTiers, 'US', 1));
  console.log('2 items:', findBestPricingTier(sampleTiers, 'US', 2));
  console.log('3 items:', findBestPricingTier(sampleTiers, 'US', 3));
};


