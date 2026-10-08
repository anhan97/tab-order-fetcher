import { COGSConfig, ComboPricing, ComboPricingData, PricingTier, PricingTierData } from '@/types/order';
import { apiFetch } from '@/utils/apiClient';

const BASE_URL = '/api/cogs';

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

/**
 * Client for /api/cogs.
 *
 * Takes no identity arguments: it used to be constructed with a userId and
 * storeId that were sent as `X-User-Id` / `X-Store-Id`, which the backend
 * trusted verbatim. Identity now rides on the JWT and the active-store
 * header that apiFetch attaches, and the server resolves both itself.
 *
 * The base URL is relative too — it used to come from `config.cogsApiUrl`,
 * which falls back to a hardcoded `http://localhost:3001/api/cogs` whenever
 * VITE_COGS_API_URL is unset, i.e. in every production build.
 */
export class COGSApiClient {
  private async makeRequest(endpoint: string, options: RequestInit = {}) {
    return apiFetch<any>(`${BASE_URL}${endpoint}`, options);
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
    const response = await this.makeRequest(`/${configId}/combo-pricing`, {
      method: 'POST',
      body: JSON.stringify(comboData),
    });
    return response;
  }

  async updateComboPricing(comboId: string, comboData: Partial<ComboPricingData>): Promise<ComboPricing> {
    const response = await this.makeRequest(`/combo-pricing/${comboId}`, {
      method: 'PUT',
      body: JSON.stringify(comboData),
    });
    return response;
  }

  async deleteComboPricing(comboId: string): Promise<void> {
    await this.makeRequest(`/combo-pricing/${comboId}`, {
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
    const response = await this.makeRequest(`/pricing-tiers/${tierId}`, {
      method: 'PUT',
      body: JSON.stringify(tierData),
    });
    return response;
  }

  async deletePricingTier(tierId: string): Promise<void> {
    await this.makeRequest(`/pricing-tiers/${tierId}`, {
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
    const response = await this.makeRequest(`/pricing/${variantId}/${country}/${quantity}`);
    return response;
  }

  /**
   * Evict the retired `user_id` / `store_id` pair. These held the literal
   * string 'default-user' plus a store slug, and the matching
   * from/saveToLocalStorage helpers meant every merchant shared one COGS
   * bucket. Identity comes from the JWT now; this only cleans up old browsers.
   */
  static clearLocalStorage(): void {
    localStorage.removeItem('user_id');
    localStorage.removeItem('store_id');
  }
}
