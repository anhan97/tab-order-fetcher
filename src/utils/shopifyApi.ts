
import { Order } from '@/types/order';

export interface ShopifyConfig {
  storeUrl: string;
  accessToken: string;
}

export interface ShopifyOrder {
  id: number;
  name: string;
  created_at: string;
  total_price: string;
  financial_status: string;
  fulfillment_status: string;
  customer?: {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
  };
  billing_address?: {
    first_name: string;
    last_name: string;
    address1: string;
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
  }[];
  fulfillments?: {
    tracking_number: string;
    tracking_company: string;
    tracking_url?: string;
  }[];
}

export class ShopifyApiClient {
  private config: ShopifyConfig;

  constructor(config: ShopifyConfig) {
    this.config = config;
  }

  private getHeaders() {
    return {
      'X-Shopify-Access-Token': this.config.accessToken,
      'Content-Type': 'application/json',
    };
  }

  private getBaseUrl() {
    const storeUrl = this.config.storeUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    return `https://${storeUrl}/admin/api/2023-10`;
  }

  private async makeRequest(url: string, options: RequestInit = {}) {
    try {
      // Try direct request first
      const response = await fetch(url, {
        ...options,
        headers: {
          ...this.getHeaders(),
          ...options.headers,
        },
      });

      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      console.log('Direct request failed, trying with proxy...');
    }

    // Fallback to proxy with proper header encoding
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
    
    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        method: options.method || 'GET',
        headers: this.getHeaders(),
        body: options.body,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    
    if (result.contents) {
      try {
        return JSON.parse(result.contents);
      } catch {
        return result.contents;
      }
    }
    
    return result;
  }

  async testConnection(): Promise<boolean> {
    try {
      const url = `${this.getBaseUrl()}/shop.json`;
      console.log('Testing connection to:', url);
      
      await this.makeRequest(url);
      return true;
    } catch (error) {
      console.error('Connection test failed:', error);
      return false;
    }
  }

  async getOrders(limit = 250): Promise<ShopifyOrder[]> {
    try {
      const url = `${this.getBaseUrl()}/orders.json?limit=${limit}&status=any`;
      console.log('Fetching orders from:', url);
      
      const data = await this.makeRequest(url);
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
      const orders = await this.getOrders(250);
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
        trackingNumber: shopifyOrder.fulfillments?.[0]?.tracking_number || ''
      };
    });
  }
}
