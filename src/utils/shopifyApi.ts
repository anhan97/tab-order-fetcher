
import { Order } from '@/types/order';
import { format } from 'date-fns';
import config from '@/config/app';

export interface ShopifyConfig {
  storeUrl: string;
  accessToken: string;
}

export interface OrderFilters {
  status?: 'any' | string;
  created_at_min?: string;
  created_at_max?: string;
  updated_at_min?: string;
  updated_at_max?: string;
  processed_at_min?: string;
  processed_at_max?: string;
  limit?: number;
  page_info?: string;
}

export interface OrdersResponse {
  orders: Order[];
  pageInfo?: string;
}

function formatStoreDomain(domain: string): string {
  // Remove protocol if present
  domain = domain.replace(/^https?:\/\//, '');
  // Remove trailing slash if present
  domain = domain.replace(/\/$/, '');
  // Remove /admin if present
  domain = domain.replace(/\/admin$/, '');
  return domain;
}

export class ShopifyApiClient {
  private config: ShopifyConfig;
  private baseUrl: string;

  constructor(config: ShopifyConfig) {
    this.config = {
      ...config,
      storeUrl: formatStoreDomain(config.storeUrl)
    };
    
    // Determine the correct API base URL based on current environment
    this.baseUrl = this.getApiBaseUrl();
    
    // Save to localStorage
    localStorage.setItem('shopify_store_url', this.config.storeUrl);
    localStorage.setItem('shopify_access_token', this.config.accessToken);
  }

  private getApiBaseUrl(): string {
    // If running on ngrok, use localhost for API calls
    if (window.location.origin.includes('ngrok')) {
      return 'http://localhost:3001/api/shopify';
    }
    // Otherwise use the configured URL
    return config.shopifyApiUrl;
  }

  static fromLocalStorage(): ShopifyApiClient | null {
    const storeUrl = localStorage.getItem('shopify_store_url');
    const accessToken = localStorage.getItem('shopify_access_token');
    
    if (storeUrl && accessToken) {
      return new ShopifyApiClient({ storeUrl, accessToken });
    }
    
    return null;
  }

  static clearLocalStorage(): void {
    localStorage.removeItem('shopify_store_url');
    localStorage.removeItem('shopify_access_token');
  }

  private getHeaders() {
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Shopify-Store-Domain': this.config.storeUrl,
      'X-Shopify-Access-Token': this.config.accessToken
    };
  }

  private async makeRequest(endpoint: string, options: RequestInit = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    console.log('Making request to backend:', url);
    console.log('Request headers:', {
      ...this.getHeaders(),
      'X-Shopify-Access-Token': '***hidden***' // Hide sensitive data in logs
    });
    
    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.getHeaders(),
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('API Error Response:', {
        status: response.status,
        statusText: response.statusText,
        body: errorText
      });
      throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
    }

    return await response.json();
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await this.makeRequest('/stores/verify', {
        method: 'POST',
        body: JSON.stringify({
          storeDomain: this.config.storeUrl,
          accessToken: this.config.accessToken
        })
      });
      
      return response.valid;
    } catch (error) {
      console.error('Connection test failed:', error);
      return false;
    }
  }

  async getOrders(filters: OrderFilters = {}): Promise<OrdersResponse> {
    try {
      let allOrders: any[] = [];
      let hasMore = true;
      let pageInfo: string | undefined;
      
      while (hasMore) {
        const queryParams = new URLSearchParams();
        if (filters.status) {
          queryParams.append('status', filters.status);
        }
        // Add base parameters
        queryParams.append('limit', '250'); // Maximum allowed by Shopify
        
        // Add pagination token if we have one
        if (pageInfo) {
          queryParams.append('page_info', pageInfo);
        } else {
          // Only add filters on first request
          if (filters.created_at_min) {
            queryParams.append('created_at_min', filters.created_at_min);
          }
          if (filters.created_at_max) {
            queryParams.append('created_at_max', filters.created_at_max);
          }
        }

        // Log the actual parameters that will be sent
        const params = Object.fromEntries(queryParams.entries());
        console.log('Sending parameters to API:', params);

        const response = await fetch(
          `${this.baseUrl}/stores/orders?${queryParams.toString()}`,
          {
            headers: this.getHeaders()
          }
        );

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        const { orders, pageInfo: nextPageInfo } = data;
        
        if (!orders || orders.length === 0) {
          hasMore = false;
        } else {
          allOrders = [...allOrders, ...orders];
          
          // Continue if we have a next page
          pageInfo = nextPageInfo;
          hasMore = !!pageInfo;
        }
      }

      // Convert orders to our format
      const convertedOrders = allOrders.flatMap(order => {
        const converted = this.convertShopifyOrderToOrder(order);
        return converted.map(convertedOrder => ({
          ...convertedOrder,
          // Format in local time with standard format
          orderDate: format(new Date(order.created_at), 'yyyy-MM-dd HH:mm:ss')
        }));
      });

      return {
        orders: convertedOrders,
        pageInfo
      };
    } catch (error) {
      console.error('Error fetching orders:', error);
      throw error;
    }
  }

  async updateOrderTracking(
    orderNumber: string,
    trackingNumber: string,
    trackingCompany: string,
    trackingUrl?: string
  ): Promise<void> {
    try {
      const response = await this.makeRequest('/orders/tracking', {
        method: 'PUT',
        body: JSON.stringify({
          orderNumber,
          trackingNumber,
          trackingCompany,
          trackingUrl,
          notifyCustomer: true, // Send notification to customer
          fulfillItems: true,   // Fulfill all items in the order
          fulfillShippingNotRequired: true // Also fulfill items that don't require shipping
        })
      });
      
      return response;
    } catch (error) {
      console.error('Error updating order tracking:', error);
      throw error;
    }
  }

  async batchUpdateOrderTracking(
    trackingUpdates: Array<{
      orderNumber: string;
      trackingNumber: string;
      trackingCompany: string;
      trackingUrl?: string;
    }>
  ): Promise<{
    summary: { total: number; successful: number; failed: number };
    successful: Array<{ orderNumber: string; fulfillment: any }>;
    failed: Array<{ orderNumber: string; error: string }>;
  }> {
    try {
      const response = await this.makeRequest('/orders/tracking/batch', {
        method: 'PUT',
        body: JSON.stringify({
          trackingUpdates,
          notifyCustomer: true,
          fulfillItems: true,
          fulfillShippingNotRequired: true
        })
      });
      
      return response;
    } catch (error) {
      console.error('Error batch updating order tracking:', error);
      throw error;
    }
  }

  async getProducts(filters: {
    limit?: number;
    page_info?: string;
    status?: 'active' | 'archived' | 'draft';
  } = {}): Promise<{ products: any[]; pageInfo?: string }> {
    try {
      const queryParams = new URLSearchParams();
      queryParams.append('limit', String(filters.limit || 50));
      queryParams.append('status', filters.status || 'active');
      
      if (filters.page_info) {
        queryParams.append('page_info', filters.page_info);
      }

      const response = await this.makeRequest(`/products?${queryParams.toString()}`);
      return response;
    } catch (error) {
      console.error('Error fetching products:', error);
      throw error;
    }
  }

  private extractUtmParameter(shopifyOrder: any, paramName: string): string | undefined {
    // Try to extract from note_attributes first
    const noteAttributes = shopifyOrder.note_attributes || [];
    for (const attr of noteAttributes) {
      if (attr.name && attr.name.toLowerCase() === paramName.toLowerCase()) {
        return attr.value;
      }
    }
    
    // Try to extract from tags
    const tags = shopifyOrder.tags ? shopifyOrder.tags.split(',').map((t: string) => t.trim()) : [];
    for (const tag of tags) {
      const prefix = `${paramName.toLowerCase()}:`;
      if (tag.toLowerCase().startsWith(prefix)) {
        return tag.split(':').slice(1).join(':'); // Handle colons in values
      }
    }
    
    return undefined;
  }


  convertShopifyOrderToOrder(shopifyOrder: any): Order[] {
    // Create a single order with all line items
    const order: Order = {
      id: shopifyOrder.id.toString(),
      orderNumber: shopifyOrder.order_number,
      // Convert to local time with standard format
      orderDate: format(new Date(shopifyOrder.created_at), 'yyyy-MM-dd HH:mm:ss'),
      customerEmail: shopifyOrder.customer?.email || '',
      customerName: [
        shopifyOrder.customer?.first_name || '',
        shopifyOrder.customer?.last_name || ''
      ].filter(Boolean).join(' '),
      totalPrice: parseFloat(shopifyOrder.total_price),
      currency: shopifyOrder.currency || 'USD',
      fulfillmentStatus: shopifyOrder.fulfillment_status || 'unfulfilled',
      financialStatus: shopifyOrder.financial_status || 'pending',
      shippingAddress: shopifyOrder.shipping_address ? {
        address1: shopifyOrder.shipping_address.address1 || '',
        address2: shopifyOrder.shipping_address.address2,
        city: shopifyOrder.shipping_address.city || '',
        province: shopifyOrder.shipping_address.province || '',
        zip: shopifyOrder.shipping_address.zip || '',
        country: shopifyOrder.shipping_address.country || '',
        phone: shopifyOrder.shipping_address.phone
      } : null,
      lineItems: shopifyOrder.line_items.map((item: any) => ({
        id: (item.id || '').toString(),
        productId: (item.product_id || '').toString(),
        variantId: (item.variant_id || '').toString(),
        title: item.title || '',
        quantity: item.quantity || 0,
        price: parseFloat(item.price || '0'),
        sku: item.sku || ''
      })),
      shippingCost: parseFloat(shopifyOrder.shipping_lines?.[0]?.price || '0'),
      tags: shopifyOrder.tags ? shopifyOrder.tags.split(',').map((t: string) => t.trim()) : [],
      note: shopifyOrder.note || '',
      // For backward compatibility with existing code
      productSKU: shopifyOrder.line_items[0]?.sku || '',
      productName: shopifyOrder.line_items[0]?.title || '',
      style: shopifyOrder.line_items[0]?.variant_title || '',
      quantity: shopifyOrder.line_items.reduce((total: number, item: any) => total + item.quantity, 0),
      email: shopifyOrder.customer?.email || '',
      phoneNumber: shopifyOrder.shipping_address?.phone || '',
      variantId: shopifyOrder.line_items[0]?.variant_id?.toString() || '', // Add variantId for COGS calculations
      // Extract UTM parameters from note_attributes
      utmSource: this.extractUtmParameter(shopifyOrder, 'utm_source'),
      utmMedium: this.extractUtmParameter(shopifyOrder, 'utm_medium'),
      utmCampaign: this.extractUtmParameter(shopifyOrder, 'utm_campaign'),
      utmContent: this.extractUtmParameter(shopifyOrder, 'utm_content'),
      fbAdId: this.extractUtmParameter(shopifyOrder, 'fb_ad_id') || this.extractUtmParameter(shopifyOrder, 'fbadid'),
      fbAdsetId: this.extractUtmParameter(shopifyOrder, 'fb_adset_id') || this.extractUtmParameter(shopifyOrder, 'fbadsetid'),
      fbCampaignId: this.extractUtmParameter(shopifyOrder, 'fb_campaign_id') || this.extractUtmParameter(shopifyOrder, 'fbcampaignid')
    };

    return [order];
  }
}
