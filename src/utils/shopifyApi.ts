
import { Order } from '@/types/order';

export interface ShopifyConfig {
  storeUrl: string;
  accessToken: string;
}

export interface ShopifyOrder {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
  processed_at: string;
  total_price: string;
  subtotal_price: string;
  total_tax: string;
  financial_status: string;
  fulfillment_status: string;
  order_status_url: string;
  cancelled_at?: string;
  cancel_reason?: string;
  tags: string;
  gateway: string;
  landing_site?: string;
  referring_site?: string;
  source_name?: string;
  customer?: {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
    phone?: string;
    created_at: string;
    orders_count: number;
    total_spent: string;
  };
  billing_address?: {
    first_name: string;
    last_name: string;
    address1: string;
    address2?: string;
    city: string;
    province: string;
    zip: string;
    country: string;
    phone: string;
  };
  shipping_address?: {
    first_name: string;
    last_name: string;
    address1: string;
    address2?: string;
    city: string;
    province: string;
    zip: string;
    country: string;
    phone: string;
  };
  line_items: {
    id: number;
    variant_id: number;
    title: string;
    quantity: number;
    sku: string;
    variant_title: string;
    price: string;
    product_id: number;
  }[];
  fulfillments?: {
    id: number;
    tracking_number: string;
    tracking_company: string;
    tracking_url?: string;
    status: string;
    created_at: string;
  }[];
  note_attributes?: {
    name: string;
    value: string;
  }[];
}

export interface OrderFilters {
  status?: 'open' | 'closed' | 'cancelled' | 'any';
  financial_status?: 'authorized' | 'pending' | 'paid' | 'partially_paid' | 'refunded' | 'voided' | 'partially_refunded' | 'unpaid';
  fulfillment_status?: 'shipped' | 'partial' | 'unshipped' | 'any' | 'unfulfilled';
  created_at_min?: string;
  created_at_max?: string;
  updated_at_min?: string;
  updated_at_max?: string;
  processed_at_min?: string;
  processed_at_max?: string;
  limit?: number;
  since_id?: number;
  fields?: string;
}

export class ShopifyApiClient {
  private config: ShopifyConfig;

  constructor(config: ShopifyConfig) {
    this.config = config;
    // Save to localStorage
    localStorage.setItem('shopify_store_url', config.storeUrl);
    localStorage.setItem('shopify_access_token', config.accessToken);
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
      'X-Shopify-Access-Token': this.config.accessToken,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
  }

  private getBaseUrl() {
    const storeUrl = this.config.storeUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    return `https://${storeUrl}/admin/api/2024-04`;
  }

  private async makeRequest(url: string, options: RequestInit = {}) {
    console.log('Making direct request to:', url);
    
    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.getHeaders(),
        ...options.headers,
      },
      mode: 'cors',
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('API Error Response:', errorText);
      throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
    }

    return await response.json();
  }

  async testConnection(): Promise<boolean> {
    try {
      const url = `${this.getBaseUrl()}/shop.json`;
      console.log('Testing connection to:', url);
      
      await this.makeRequest(url);
      console.log('Connection test successful');
      return true;
    } catch (error) {
      console.error('Connection test failed:', error);
      return false;
    }
  }

  async getOrders(filters: OrderFilters = {}): Promise<ShopifyOrder[]> {
    try {
      const params = new URLSearchParams();
      
      // Default filters
      params.append('limit', (filters.limit || 250).toString());
      if (filters.status && filters.status !== 'any') {
        params.append('status', filters.status);
      }
      
      // Add all filter parameters
      if (filters.financial_status) params.append('financial_status', filters.financial_status);
      if (filters.fulfillment_status && filters.fulfillment_status !== 'any') {
        params.append('fulfillment_status', filters.fulfillment_status);
      }
      if (filters.created_at_min) params.append('created_at_min', filters.created_at_min);
      if (filters.created_at_max) params.append('created_at_max', filters.created_at_max);
      if (filters.updated_at_min) params.append('updated_at_min', filters.updated_at_min);
      if (filters.updated_at_max) params.append('updated_at_max', filters.updated_at_max);
      if (filters.processed_at_min) params.append('processed_at_min', filters.processed_at_min);
      if (filters.processed_at_max) params.append('processed_at_max', filters.processed_at_max);
      if (filters.since_id) params.append('since_id', filters.since_id.toString());
      if (filters.fields) params.append('fields', filters.fields);
      
      const url = `${this.getBaseUrl()}/orders.json?${params.toString()}`;
      console.log('Fetching orders from:', url);
      
      const data = await this.makeRequest(url);
      console.log('Orders fetched successfully:', data.orders?.length || 0);
      return data.orders || [];
    } catch (error) {
      console.error('Failed to fetch orders:', error);
      throw error;
    }
  }

  async getOrderById(orderId: string): Promise<ShopifyOrder | null> {
    try {
      const url = `${this.getBaseUrl()}/orders/${orderId}.json`;
      const data = await this.makeRequest(url);
      return data.order || null;
    } catch (error) {
      console.error('Failed to fetch order:', error);
      return null;
    }
  }

  async updateOrderTracking(
    orderNumber: string, 
    trackingNumber: string, 
    trackingCompany: string,
    trackingUrl?: string
  ): Promise<boolean> {
    try {
      // Get order info first
      const orders = await this.getOrders({ limit: 250 });
      const order = orders.find(o => o.name.replace('#', '') === orderNumber);
      
      if (!order) {
        throw new Error(`Không tìm thấy đơn hàng #${orderNumber}`);
      }
      
      // Create fulfillment for the order
      const fulfillmentData = {
        fulfillment: {
          location_id: null,
          tracking_number: trackingNumber,
          tracking_company: trackingCompany,
          tracking_urls: trackingUrl ? [trackingUrl] : [],
          notify_customer: true,
          line_items: order.line_items.map(item => ({
            id: item.id,
            quantity: item.quantity
          }))
        }
      };
      
      const url = `${this.getBaseUrl()}/orders/${order.id}/fulfillments.json`;
      console.log('Creating fulfillment for order:', order.id, fulfillmentData);
      
      await this.makeRequest(url, {
        method: 'POST',
        body: JSON.stringify(fulfillmentData)
      });
      
      console.log('Fulfillment created successfully');
      return true;
      
    } catch (error) {
      console.error('Error updating order tracking:', error);
      throw error;
    }
  }

  convertShopifyOrderToOrder(shopifyOrder: ShopifyOrder): Order[] {
    // Convert each line item to a separate order record
    return shopifyOrder.line_items.map((item, index) => {
      const billingAddress = shopifyOrder.billing_address;
      const shippingAddress = shopifyOrder.shipping_address || billingAddress;
      const customer = shopifyOrder.customer;
      
      return {
        id: `${shopifyOrder.id}-${index}`,
        orderNumber: shopifyOrder.name.replace('#', ''),
        orderDate: shopifyOrder.created_at.split('T')[0],
        productSKU: item.sku || '',
        productName: item.title,
        style: item.variant_title || '',
        quantity: item.quantity,
        email: customer?.email || '',
        customerName: customer 
          ? `${customer.first_name} ${customer.last_name}`.trim()
          : (billingAddress ? `${billingAddress.first_name} ${billingAddress.last_name}`.trim() : ''),
        address: shippingAddress?.address1 || '',
        city: shippingAddress?.city || '',
        state: shippingAddress?.province || '',
        postalCode: shippingAddress?.zip || '',
        countryCode: shippingAddress?.country || '',
        phoneNumber: shippingAddress?.phone || billingAddress?.phone || '',
        totalAmount: parseFloat(item.price) * item.quantity,
        shippingMethod: shopifyOrder.fulfillments?.[0]?.tracking_company || '',
        trackingNumber: shopifyOrder.fulfillments?.[0]?.tracking_number || '',
        financialStatus: shopifyOrder.financial_status,
        fulfillmentStatus: shopifyOrder.fulfillment_status || 'unfulfilled',
        tags: shopifyOrder.tags,
        landingSite: shopifyOrder.landing_site,
        referringSite: shopifyOrder.referring_site,
        sourceName: shopifyOrder.source_name,
        gateway: shopifyOrder.gateway
      };
    });
  }
}
