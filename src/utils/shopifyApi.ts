
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

  private async makeProxiedRequest(url: string, options: RequestInit = {}) {
    const proxyUrl = createProxyUrl(url);
    
    // Merge headers with the request
    const headers = {
      ...this.getHeaders(),
      ...options.headers,
    };

    const response = await fetch(proxyUrl, {
      method: options.method || 'GET',
      headers: {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        // Pass Shopify headers as custom headers
        'X-Shopify-Headers': JSON.stringify(headers),
      },
      body: options.body,
    });

    return handleProxyResponse(response);
  }

  async testConnection(): Promise<boolean> {
    try {
      const url = `${this.getBaseUrl()}/shop.json`;
      console.log('Testing connection to:', url);
      
      await this.makeProxiedRequest(url);
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
      
      const data = await this.makeProxiedRequest(url);
      return data.orders || [];
    } catch (error) {
      console.error('Failed to fetch orders:', error);
      throw error;
    }
  }

  async getOrderById(orderId: string): Promise<ShopifyOrder | null> {
    try {
      const url = `${this.getBaseUrl()}/orders/${orderId}.json`;
      
      const data = await this.makeProxiedRequest(url);
      return data.order || null;
    } catch (error) {
      console.error('Failed to fetch order:', error);
      return null;
    }
  }

  async updateOrderTracking(orderId: string, trackingNumber: string, trackingCompany: string = 'Other'): Promise<boolean> {
    try {
      const url = `${this.getBaseUrl()}/orders/${orderId}/fulfillments.json`;
      
      const fulfillmentData = {
        fulfillment: {
          location_id: null,
          tracking_number: trackingNumber,
          tracking_company: trackingCompany,
          notify_customer: true
        }
      };

      await this.makeProxiedRequest(url, {
        method: 'POST',
        body: JSON.stringify(fulfillmentData)
      });

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
