import { CogsConfig, CogsResult, OrderLineItem, BulkCogsRequest } from '@/types/minimalCogs';

/**
 * Calculate COGS for a single product variant
 */
export function productCogs(
  cfg: CogsConfig, 
  variantId: number, 
  country: string, 
  shipper: string
): number {
  const p = cfg.products.find(v => v.variant_id === variantId);
  if (!p) {
    console.warn(`Variant ${variantId} not found in COGS config, using 0 cost`);
    return 0;
  }
  
  const o = p.overrides?.find(x => x.country === country && x.shipping_company === shipper);
  return o ? o.cost : p.base_cost;
}

/**
 * Calculate COGS for a combo
 */
export function comboCogs(
  cfg: CogsConfig, 
  comboId: string, 
  country: string, 
  shipper: string
): number {
  const c = cfg.combos?.find(x => x.combo_id === comboId);
  if (!c) {
    throw new Error(`Combo ${comboId} not found in COGS config`);
  }

  const direct = c.overrides?.find(x => x.country === country && x.shipping_company === shipper);
  if (c.cogs_rule.mode === "override") {
    if (!direct) {
      throw new Error(`Combo ${comboId} requires override in ${country}/${shipper}`);
    }
    return direct.override_cost;
  }

  // mode === "sum"
  const sum = c.items.reduce((acc, it) =>
    acc + it.qty * productCogs(cfg, it.variant_id, country, shipper), 0);

  if (c.cogs_rule.discount_type === "percent" && c.cogs_rule.discount_value) {
    return +(sum * (1 - c.cogs_rule.discount_value / 100)).toFixed(2);
  }
  if (c.cogs_rule.discount_type === "fixed" && c.cogs_rule.discount_value) {
    return +(Math.max(0, sum - c.cogs_rule.discount_value)).toFixed(2);
  }
  return +sum.toFixed(2);
}

/**
 * Calculate detailed COGS result for a product
 */
export function calculateProductCogs(
  cfg: CogsConfig,
  variantId: number,
  country: string,
  shipper: string,
  quantity: number = 1
): CogsResult {
  const p = cfg.products.find(v => v.variant_id === variantId);
  if (!p) {
    return {
      variant_id: variantId,
      country,
      shipping_company: shipper,
      quantity,
      unit_cost: 0,
      total_cost: 0,
      calculation_method: 'base_cost'
    };
  }

  const override = p.overrides?.find(x => x.country === country && x.shipping_company === shipper);
  const unitCost = override ? override.cost : p.base_cost;
  const totalCost = unitCost * quantity;

  return {
    variant_id: variantId,
    country,
    shipping_company: shipper,
    quantity,
    unit_cost: unitCost,
    total_cost: totalCost,
    calculation_method: override ? 'override' : 'base_cost'
  };
}

/**
 * Calculate detailed COGS result for a combo
 */
export function calculateComboCogs(
  cfg: CogsConfig,
  comboId: string,
  country: string,
  shipper: string,
  quantity: number = 1
): CogsResult {
  const c = cfg.combos?.find(x => x.combo_id === comboId);
  if (!c) {
    throw new Error(`Combo ${comboId} not found in COGS config`);
  }

  const direct = c.overrides?.find(x => x.country === country && x.shipping_company === shipper);
  
  if (c.cogs_rule.mode === "override") {
    if (!direct) {
      throw new Error(`Combo ${comboId} requires override in ${country}/${shipper}`);
    }
    return {
      combo_id: comboId,
      country,
      shipping_company: shipper,
      quantity,
      unit_cost: direct.override_cost,
      total_cost: direct.override_cost * quantity,
      calculation_method: 'combo_override'
    };
  }

  // mode === "sum"
  const sum = c.items.reduce((acc, it) =>
    acc + it.qty * productCogs(cfg, it.variant_id, country, shipper), 0);

  let finalCost = sum;
  let appliedDiscount = undefined;

  if (c.cogs_rule.discount_type === "percent" && c.cogs_rule.discount_value) {
    const discountAmount = sum * (c.cogs_rule.discount_value / 100);
    finalCost = sum - discountAmount;
    appliedDiscount = {
      type: 'percent' as const,
      value: c.cogs_rule.discount_value,
      amount: discountAmount
    };
  } else if (c.cogs_rule.discount_type === "fixed" && c.cogs_rule.discount_value) {
    const discountAmount = c.cogs_rule.discount_value;
    finalCost = Math.max(0, sum - discountAmount);
    appliedDiscount = {
      type: 'fixed' as const,
      value: c.cogs_rule.discount_value,
      amount: discountAmount
    };
  }

  return {
    combo_id: comboId,
    country,
    shipping_company: shipper,
    quantity,
    unit_cost: +finalCost.toFixed(2),
    total_cost: +(finalCost * quantity).toFixed(2),
    calculation_method: 'combo_sum',
    applied_discount: appliedDiscount
  };
}

/**
 * Calculate COGS for multiple order line items
 */
export function calculateBulkCogs(
  cfg: CogsConfig,
  request: BulkCogsRequest
): CogsResult[] {
  return request.items.map(item => 
    calculateProductCogs(
      cfg,
      item.variant_id,
      request.country,
      request.shipping_company,
      item.quantity
    )
  );
}

/**
 * Calculate total COGS for an order
 */
export function calculateOrderCogs(
  cfg: CogsConfig,
  request: BulkCogsRequest
): {
  total_cogs: number;
  items: CogsResult[];
  breakdown: {
    by_variant: Record<number, number>;
    by_calculation_method: Record<string, number>;
  };
} {
  const items = calculateBulkCogs(cfg, request);
  const totalCogs = items.reduce((sum, item) => sum + item.total_cost, 0);
  
  const byVariant = items.reduce((acc, item) => {
    if (item.variant_id) {
      acc[item.variant_id] = (acc[item.variant_id] || 0) + item.total_cost;
    }
    return acc;
  }, {} as Record<number, number>);

  const byMethod = items.reduce((acc, item) => {
    acc[item.calculation_method] = (acc[item.calculation_method] || 0) + item.total_cost;
    return acc;
  }, {} as Record<string, number>);

  return {
    total_cogs: +totalCogs.toFixed(2),
    items,
    breakdown: {
      by_variant: byVariant,
      by_calculation_method: byMethod
    }
  };
}

// Helper function to find matching combos based on trigger quantity
export function findMatchingCombos(cfg: CogsConfig, orderLines: OrderLineItem[]): Array<{combo_id: string, quantity: number}> {
  const matchedCombos: Array<{combo_id: string, quantity: number}> = [];
  
  if (!cfg.combos) return matchedCombos;
  
  cfg.combos.forEach(combo => {
    // Get the trigger quantity from the combo items
    const triggerQuantity = combo.items.reduce((sum, item) => sum + item.qty, 0);
    
    // Count how many items from this combo are in the order
    let matchedCount = 0;
    combo.items.forEach(comboItem => {
      const orderLine = orderLines.find(line => line.variant_id === comboItem.variant_id);
      if (orderLine) {
        matchedCount += Math.min(orderLine.qty, comboItem.qty);
      }
    });
    
    // If we have enough items to trigger the combo
    if (matchedCount >= triggerQuantity) {
      const comboQuantity = Math.floor(matchedCount / triggerQuantity);
      matchedCombos.push({
        combo_id: combo.combo_id,
        quantity: comboQuantity
      });
    }
  });
  
  return matchedCombos;
}

// Helper function to get remaining lines after combo matching
export function getRemainingLines(orderLines: OrderLineItem[], matchedCombos: Array<{combo_id: string, quantity: number}>): OrderLineItem[] {
  // This is a simplified implementation - in practice, you'd need more complex logic
  // to handle partial combo matches and remaining quantities
  return orderLines;
}

/**
 * Validate COGS configuration
 */
export function validateCogsConfig(cfg: CogsConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!cfg.version) errors.push('Missing version');
  if (!cfg.currency) errors.push('Missing currency');
  if (!cfg.products || cfg.products.length === 0) errors.push('No products defined');

  // Validate products
  cfg.products?.forEach((product, index) => {
    if (!product.variant_id) errors.push(`Product ${index}: Missing variant_id`);
    if (product.base_cost < 0) errors.push(`Product ${index}: base_cost cannot be negative`);
    
    product.overrides?.forEach((override, overrideIndex) => {
      if (!override.country) errors.push(`Product ${index}, Override ${overrideIndex}: Missing country`);
      if (!override.shipping_company) errors.push(`Product ${index}, Override ${overrideIndex}: Missing shipping_company`);
      if (override.cost < 0) errors.push(`Product ${index}, Override ${overrideIndex}: cost cannot be negative`);
    });
  });

  // Validate combos
  cfg.combos?.forEach((combo, index) => {
    if (!combo.combo_id) errors.push(`Combo ${index}: Missing combo_id`);
    if (!combo.name) errors.push(`Combo ${index}: Missing name`);
    if (!combo.items || combo.items.length === 0) errors.push(`Combo ${index}: No items defined`);
    
    combo.items?.forEach((item, itemIndex) => {
      if (!item.variant_id) errors.push(`Combo ${index}, Item ${itemIndex}: Missing variant_id`);
      if (item.qty <= 0) errors.push(`Combo ${index}, Item ${itemIndex}: qty must be positive`);
    });

    if (combo.cogs_rule.mode === "sum") {
      if (combo.cogs_rule.discount_type === "percent" && 
          (combo.cogs_rule.discount_value < 0 || combo.cogs_rule.discount_value > 100)) {
        errors.push(`Combo ${index}: Invalid percent discount value`);
      }
      if (combo.cogs_rule.discount_type === "fixed" && combo.cogs_rule.discount_value < 0) {
        errors.push(`Combo ${index}: Invalid fixed discount value`);
      }
    }
  });

  return {
    valid: errors.length === 0,
    errors
  };
}
