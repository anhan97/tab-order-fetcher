
export interface FacebookAdAccount {
  id: string;
  name: string;
  currency: string;
}

export interface FacebookCampaign {
  id: string;
  name: string;
  status: string;
  objective: string;
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  purchase_value: number;
  cost_per_purchase: number;
  roas: number;
  date_start: string;
  date_stop: string;
}

export interface FacebookAdSet {
  id: string;
  name: string;
  campaign_id: string;
  status: string;
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  purchase_value: number;
  cost_per_purchase: number;
  roas: number;
}

export interface FacebookAd {
  id: string;
  name: string;
  adset_id: string;
  campaign_id: string;
  status: string;
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  purchase_value: number;
  cost_per_purchase: number;
  roas: number;
  creative?: {
    title: string;
    body: string;
    image_url?: string;
    video_url?: string;
  };
}

export interface FacebookAdsConfig {
  accessToken: string;
  adAccountId: string;
}

export class FacebookAdsApiClient {
  private config: FacebookAdsConfig;
  private baseUrl = 'https://graph.facebook.com/v18.0';

  constructor(config: FacebookAdsConfig) {
    this.config = config;
    // Save to localStorage
    localStorage.setItem('facebook_access_token', config.accessToken);
    localStorage.setItem('facebook_ad_account_id', config.adAccountId);
  }

  static fromLocalStorage(): FacebookAdsApiClient | null {
    const accessToken = localStorage.getItem('facebook_access_token');
    const adAccountId = localStorage.getItem('facebook_ad_account_id');
    
    if (accessToken && adAccountId) {
      return new FacebookAdsApiClient({ accessToken, adAccountId });
    }
    
    return null;
  }

  static clearLocalStorage(): void {
    localStorage.removeItem('facebook_access_token');
    localStorage.removeItem('facebook_ad_account_id');
  }

  private async makeRequest(endpoint: string, params: Record<string, any> = {}) {
    const url = new URL(`${this.baseUrl}/${endpoint}`);
    url.searchParams.append('access_token', this.config.accessToken);
    
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, value.toString());
      }
    });

    try {
      // Try direct request first
      const response = await fetch(url.toString());
      
      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      console.log('Direct request failed, trying with proxy...');
    }

    // Fallback to proxy
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url.toString())}`;
    
    const response = await fetch(proxyUrl);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    
    if (result.contents) {
      try {
        return JSON.parse(result.contents);
      } catch {
        throw new Error('Invalid response format');
      }
    }
    
    throw new Error('No data received');
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.makeRequest(`act_${this.config.adAccountId}`, {
        fields: 'name,currency'
      });
      return true;
    } catch (error) {
      console.error('Facebook Ads connection test failed:', error);
      return false;
    }
  }

  async getAdAccount(): Promise<FacebookAdAccount> {
    const data = await this.makeRequest(`act_${this.config.adAccountId}`, {
      fields: 'name,currency'
    });
    
    return {
      id: data.id,
      name: data.name,
      currency: data.currency
    };
  }

  async getCampaigns(dateStart?: string, dateStop?: string): Promise<FacebookCampaign[]> {
    const params: Record<string, any> = {
      fields: 'name,status,objective,insights{spend,impressions,clicks,actions,action_values,cost_per_action_type}',
      limit: 100
    };

    if (dateStart && dateStop) {
      params['time_range'] = JSON.stringify({
        since: dateStart,
        until: dateStop
      });
    }

    const data = await this.makeRequest(`act_${this.config.adAccountId}/campaigns`, params);
    
    return data.data.map((campaign: any) => {
      const insights = campaign.insights?.data?.[0] || {};
      const purchases = this.getActionValue(insights.actions, 'purchase') || 0;
      const purchaseValue = this.getActionValue(insights.action_values, 'purchase') || 0;
      const spend = parseFloat(insights.spend || '0');
      
      return {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        objective: campaign.objective,
        spend,
        impressions: parseInt(insights.impressions || '0'),
        clicks: parseInt(insights.clicks || '0'),
        purchases,
        purchase_value: purchaseValue,
        cost_per_purchase: purchases > 0 ? spend / purchases : 0,
        roas: spend > 0 ? purchaseValue / spend : 0,
        date_start: dateStart || '',
        date_stop: dateStop || ''
      };
    });
  }

  async getAdSets(campaignId?: string, dateStart?: string, dateStop?: string): Promise<FacebookAdSet[]> {
    const endpoint = campaignId 
      ? `${campaignId}/adsets`
      : `act_${this.config.adAccountId}/adsets`;

    const params: Record<string, any> = {
      fields: 'name,campaign_id,status,insights{spend,impressions,clicks,actions,action_values}',
      limit: 100
    };

    if (dateStart && dateStop) {
      params['time_range'] = JSON.stringify({
        since: dateStart,
        until: dateStop
      });
    }

    const data = await this.makeRequest(endpoint, params);
    
    return data.data.map((adset: any) => {
      const insights = adset.insights?.data?.[0] || {};
      const purchases = this.getActionValue(insights.actions, 'purchase') || 0;
      const purchaseValue = this.getActionValue(insights.action_values, 'purchase') || 0;
      const spend = parseFloat(insights.spend || '0');
      
      return {
        id: adset.id,
        name: adset.name,
        campaign_id: adset.campaign_id,
        status: adset.status,
        spend,
        impressions: parseInt(insights.impressions || '0'),
        clicks: parseInt(insights.clicks || '0'),
        purchases,
        purchase_value: purchaseValue,
        cost_per_purchase: purchases > 0 ? spend / purchases : 0,
        roas: spend > 0 ? purchaseValue / spend : 0
      };
    });
  }

  async getAds(adsetId?: string, dateStart?: string, dateStop?: string): Promise<FacebookAd[]> {
    const endpoint = adsetId 
      ? `${adsetId}/ads`
      : `act_${this.config.adAccountId}/ads`;

    const params: Record<string, any> = {
      fields: 'name,adset_id,campaign_id,status,creative{title,body,image_url,video_url},insights{spend,impressions,clicks,actions,action_values}',
      limit: 100
    };

    if (dateStart && dateStop) {
      params['time_range'] = JSON.stringify({
        since: dateStart,
        until: dateStop
      });
    }

    const data = await this.makeRequest(endpoint, params);
    
    return data.data.map((ad: any) => {
      const insights = ad.insights?.data?.[0] || {};
      const purchases = this.getActionValue(insights.actions, 'purchase') || 0;
      const purchaseValue = this.getActionValue(insights.action_values, 'purchase') || 0;
      const spend = parseFloat(insights.spend || '0');
      
      return {
        id: ad.id,
        name: ad.name,
        adset_id: ad.adset_id,
        campaign_id: ad.campaign_id,
        status: ad.status,
        spend,
        impressions: parseInt(insights.impressions || '0'),
        clicks: parseInt(insights.clicks || '0'),
        purchases,
        purchase_value: purchaseValue,
        cost_per_purchase: purchases > 0 ? spend / purchases : 0,
        roas: spend > 0 ? purchaseValue / spend : 0,
        creative: ad.creative ? {
          title: ad.creative.title || '',
          body: ad.creative.body || '',
          image_url: ad.creative.image_url,
          video_url: ad.creative.video_url
        } : undefined
      };
    });
  }

  private getActionValue(actions: any[], actionType: string): number {
    if (!actions) return 0;
    const action = actions.find(a => a.action_type === actionType);
    return action ? parseInt(action.value) : 0;
  }

  // Calculate ROAS and metrics for orders matched with Facebook campaigns
  async calculateOrderROAS(orders: any[], campaigns: FacebookCampaign[]): Promise<any[]> {
    return orders.map(order => {
      // Try to match order with campaign based on referrer, UTM params, etc.
      const matchedCampaign = this.matchOrderToCampaign(order, campaigns);
      
      if (matchedCampaign) {
        return {
          ...order,
          facebookCampaignId: matchedCampaign.id,
          facebookCampaignName: matchedCampaign.name,
          campaignSpend: matchedCampaign.spend,
          campaignROAS: matchedCampaign.roas,
          campaignCostPerPurchase: matchedCampaign.cost_per_purchase
        };
      }
      
      return order;
    });
  }

  private matchOrderToCampaign(order: any, campaigns: FacebookCampaign[]): FacebookCampaign | null {
    // Simple matching logic - can be enhanced based on UTM parameters, referrer data, etc.
    if (order.referringSite?.includes('facebook.com') || order.referringSite?.includes('instagram.com')) {
      // Return the campaign with best ROAS for Facebook/Instagram traffic
      return campaigns.reduce((best, current) => 
        current.roas > (best?.roas || 0) ? current : best, null);
    }
    
    // Could also match based on:
    // - UTM parameters in landing_site
    // - Custom order attributes
    // - Time-based matching
    // - Customer behavior patterns
    
    return null;
  }
}
