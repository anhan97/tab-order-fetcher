import { COGSConfig, ComboPricing, ComboPricingData, PricingTier, PricingTierData } from '@/types/order';
import config from '@/config/app';

const BASE_URL = config.cogsApiUrl;

export interface COGSConfigData {
  productSKU: string;
  variantId: string | number; // Can be string or number (Shopify returns numbers)
  productId: string | number; // Can be string or number (Shopify returns numbers)
  productTitle: string;
  variantTitle: string;
  baseCost: number;
  handlingFee: number;
  description?: string;
  comboPricing?: ComboPricingData[];
}

export class COGSApiClient {
  private userId: string;
  private storeId: string;

  constructor(userId: string, storeId: string) {
    this.userId = userId;
    this.storeId = storeId;
  }

  private async makeRequest(endpoint: string, options: RequestInit = {}) {
    const url = `${BASE_URL}${endpoint}`;
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': this.userId,
        'X-Store-Id': this.storeId,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.details || `HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  // Get all COGS configurations
  async getCOGSConfigs(): Promise<COGSConfig[]> {
    try {
      const response = await this.makeRequest('/configs');
      return response.configs || [];
    } catch (error: any) {
      // If it's a 404 or empty result, return empty array instead of throwing
      if (error.message && (error.message.includes('404') || error.message.includes('No COGS configurations found'))) {
        return [];
      }
      throw error;
    }
  }

  // Create a new COGS configuration
  async createCOGSConfig(data: COGSConfigData): Promise<COGSConfig> {
    const response = await this.makeRequest('/configs', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return response.config;
  }

  // Update an existing COGS configuration
  async updateCOGSConfig(configId: string, data: Partial<COGSConfigData>): Promise<COGSConfig> {
    const response = await this.makeRequest(`/configs/${configId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return response.config;
  }

  // Delete a COGS configuration
  async deleteCOGSConfig(configId: string): Promise<void> {
    await this.makeRequest(`/configs/${configId}`, {
      method: 'DELETE',
    });
  }

  // Bulk create COGS configurations
  async bulkCreateCOGSConfigs(configs: COGSConfigData[]): Promise<{
    successful: COGSConfig[];
    failed: any[];
    totalCreated: number;
    totalFailed: number;
  }> {
    const response = await this.makeRequest('/configs/bulk', {
      method: 'POST',
      body: JSON.stringify({ configs }),
    });
    return response;
  }

  // Combo Pricing methods
  async addComboPricing(configId: string, comboData: ComboPricingData): Promise<ComboPricing> {
    const response = await this.makeRequest(`/configs/${configId}/combo-pricing`, {
      method: 'POST',
      body: JSON.stringify(comboData),
    });
    return response;
  }

  async updateComboPricing(comboId: string, comboData: Partial<ComboPricingData>): Promise<ComboPricing> {
    const response = await this.makeRequest(`/configs/combo-pricing/${comboId}`, {
      method: 'PUT',
      body: JSON.stringify(comboData),
    });
    return response;
  }

  async deleteComboPricing(comboId: string): Promise<void> {
    await this.makeRequest(`/configs/combo-pricing/${comboId}`, {
      method: 'DELETE',
    });
  }

  // Legacy Pricing Tier methods for backward compatibility
  async addPricingTier(configId: string, tierData: PricingTierData): Promise<PricingTier> {
    const response = await this.makeRequest(`/configs/${configId}/pricing-tiers`, {
      method: 'POST',
      body: JSON.stringify(tierData),
    });
    return response;
  }

  async updatePricingTier(tierId: string, tierData: Partial<PricingTierData>): Promise<PricingTier> {
    const response = await this.makeRequest(`/configs/pricing-tiers/${tierId}`, {
      method: 'PUT',
      body: JSON.stringify(tierData),
    });
    return response;
  }

  async deletePricingTier(tierId: string): Promise<void> {
    await this.makeRequest(`/configs/pricing-tiers/${tierId}`, {
      method: 'DELETE',
    });
  }

  async getPricingForOrder(variantId: string, country: string, quantity: number): Promise<{
    tier: PricingTier;
    calculatedCost: {
      baseProductCost: number;
      discountedProductCost: number;
      shippingCost: number;
      totalCost: number;
      discount: number;
      discountAmount: number;
    };
  } | null> {
    const response = await this.makeRequest(`/configs/pricing/${variantId}/${country}/${quantity}`);
    return response;
  }

  // Create from localStorage (for migration)
  static fromLocalStorage(): COGSApiClient | null {
    const userId = localStorage.getItem('user_id');
    const storeId = localStorage.getItem('store_id');
    
    if (!userId || !storeId) {
      return null;
    }
    
    return new COGSApiClient(userId, storeId);
  }

  // Save to localStorage (for migration)
  static saveToLocalStorage(userId: string, storeId: string): void {
    localStorage.setItem('user_id', userId);
    localStorage.setItem('store_id', storeId);
  }
}
