// Test script for frontend COGS calculation
const { calculateOrderCOGS, calculateBulkCOGS, getCountryCode } = require('./src/utils/cogsCalculator.ts');

// Sample COGS config
const sampleCogsConfig = {
  version: "1.0",
  currency: "USD",
  products: [
    {
      variant_id: 47597332136187,
      sku: "TEST-PRODUCT",
      base_cost: 8.43,
      overrides: [
        { country: "US", shipping_company: "YunTu", cost: 8.43 },
        { country: "CA", shipping_company: "YunTu", cost: 9.50 },
        { country: "AU", shipping_company: "YunTu", cost: 12.00 }
      ]
    }
  ],
  combos: []
};

// Test single order calculation
console.log('Testing single order COGS calculation...');
const orderLines = [
  { variant_id: 47597332136187, quantity: 2 }
];

const result = calculateOrderCOGS(orderLines, 'US', 'YunTu', sampleCogsConfig);
console.log('Single order result:', result);
console.log('Expected: 16.86 (2 × 8.43)');
console.log('Match:', result.total_cogs === 16.86);

// Test country code mapping
console.log('\nTesting country code mapping...');
console.log('United States ->', getCountryCode('United States'));
console.log('Canada ->', getCountryCode('Canada'));
console.log('Australia ->', getCountryCode('Australia'));
console.log('Unknown ->', getCountryCode('Unknown Country'));

// Test bulk calculation
console.log('\nTesting bulk COGS calculation...');
const bulkOrders = [
  {
    order_id: 'order1',
    order_lines: [{ variant_id: 47597332136187, quantity: 1 }],
    country_code: 'US',
    shipping_company: 'YunTu'
  },
  {
    order_id: 'order2', 
    order_lines: [{ variant_id: 47597332136187, quantity: 3 }],
    country_code: 'CA',
    shipping_company: 'YunTu'
  }
];

const bulkResult = calculateBulkCOGS(bulkOrders, sampleCogsConfig);
console.log('Bulk calculation result:', bulkResult);
console.log('Expected: order1=8.43, order2=28.50 (3 × 9.50)');

console.log('\n✅ Frontend COGS calculation test completed!');


