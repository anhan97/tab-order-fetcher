import { CogsConfig } from '../types/cogs';

export interface OrderLine {
  variant_id: number;
  quantity: number;
}

export interface COGSCalculationResult {
  total_cogs: number;
  line_details: Array<{
    variant_id: number;
    quantity: number;
    unit_cost: number;
    total_cost: number;
  }>;
}

/**
 * Calculate COGS for a single order using frontend-only calculation
 * This is much faster than API calls and works offline
 */
export function calculateOrderCOGS(
  orderLines: OrderLine[],
  countryCode: string,
  shippingCompany: string,
  cogsConfig: CogsConfig
): COGSCalculationResult {
  let totalCogs = 0;
  const lineDetails: COGSCalculationResult['line_details'] = [];

  for (const line of orderLines) {
    // Find product in COGS config
    const product = cogsConfig.products.find(p => p.variant_id === line.variant_id);
    
    if (product) {
      // Check for country/shipping override
      const override = product.overrides?.find(o => 
        o.country === countryCode && o.shipping_company === shippingCompany
      );
      
      const unitCost = override ? override.cost : product.base_cost;
      const lineCost = unitCost * line.quantity;
      totalCogs += lineCost;
      
      lineDetails.push({
        variant_id: line.variant_id,
        quantity: line.quantity,
        unit_cost: unitCost,
        total_cost: lineCost,
      });
    }
  }

  return {
    total_cogs: totalCogs,
    line_details: lineDetails,
  };
}

/**
 * Calculate COGS for multiple orders in bulk (frontend-only)
 * This replaces the need for bulk API calls
 */
export function calculateBulkCOGS(
  orders: Array<{
    order_id: string;
    order_lines: OrderLine[];
    country_code: string;
    shipping_company: string;
  }>,
  cogsConfig: CogsConfig
): Array<{
  order_id: string;
  total_cogs: number;
  line_details: COGSCalculationResult['line_details'];
  country: string;
  shipping_company: string;
}> {
  return orders.map(orderData => {
    const result = calculateOrderCOGS(
      orderData.order_lines,
      orderData.country_code,
      orderData.shipping_company,
      cogsConfig
    );

    return {
      order_id: orderData.order_id,
      total_cogs: result.total_cogs,
      line_details: result.line_details,
      country: orderData.country_code,
      shipping_company: orderData.shipping_company,
    };
  });
}

/**
 * Get country code from country name (helper function)
 */
export function getCountryCode(countryName: string | undefined): string {
  if (!countryName) return 'US';
  
  const countryMap: Record<string, string> = {
    'United States': 'US',
    'Canada': 'CA', 
    'Australia': 'AU',
    'United Kingdom': 'UK',
    'Germany': 'DE',
    'France': 'FR',
    'Italy': 'IT',
    'Spain': 'ES'
  };
  
  return countryMap[countryName] || countryName.substring(0, 2).toUpperCase();
}


