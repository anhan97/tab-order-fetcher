
import { Order } from '@/types/order';
import { createProxyUrl, handleProxyResponse } from './corsProxy';

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
  }[];
}

export class ShopifyApiClient {
  private config: ShopifyConfig;

  constructor(config: ShopifyConfig) {
    this.config = config;
  }

  private getBaseUrl() {
    const storeUrl = this.config.storeUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    return `https://${storeUrl}/admin/api/2023-10`;
  }

  private async makeProxiedRequest(endpoint: string, options: RequestInit = {}) {
    const baseUrl = `${this.getBaseUrl()}${endpoint}`;
    const proxyUrl = createProxyUrl(baseUrl);
    
    console.log('Making proxied request to:', proxyUrl);
    
    const response = await fetch(proxyUrl, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': this.config.accessToken,
        ...options.headers,
      },
    });

    return handleProxyResponse(response);
  }

  async testConnection(): Promise<boolean> {
    try {
      console.log('Testing connection...');
      
      // Just try to get orders directly without checking permissions
      await this.makeProxiedRequest('/orders.json?limit=1');
      return true;
    } catch (error) {
      console.error('Connection test failed:', error);
      return false;
    }
  }

  async getOrders(limit = 250): Promise<ShopifyOrder[]> {
    try {
      console.log('Fetching orders...');
      
      const data = await this.makeProxiedRequest(`/orders.json?limit=${limit}&status=any`);
      return data.orders || [];
    } catch (error) {
      console.error('Failed to fetch orders:', error);
      throw error;
    }
  }

  async getOrderById(orderId: string): Promise<ShopifyOrder | null> {
    try {
      const data = await this.makeProxiedRequest(`/orders/${orderId}.json`);
      return data.order || null;
    } catch (error) {
      console.error('Failed to fetch order:', error);
      return null;
    }
  }

  async updateOrderTracking(orderId: string, trackingNumber: string, trackingCompany: string = 'Other'): Promise<boolean> {
    try {
      // Update order fulfillment with tracking info
      const fulfillmentData = {
        fulfillment: {
          location_id: null,
          tracking_number: trackingNumber,
          tracking_company: trackingCompany,
          notify_customer: true,
          line_items: []
        }
      };

      await this.makeProxiedRequest(`/orders/${orderId}/fulfillments.json`, {
        method: 'POST',
        body: JSON.stringify(fulfillmentData)
      });

      console.log(`Updated order ${orderId} with tracking ${trackingNumber}`);
      return true;
    } catch (error) {
      console.error('Failed to update tracking:', error);
      return false;
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
